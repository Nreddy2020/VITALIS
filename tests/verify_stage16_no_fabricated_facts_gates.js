/**
 * VITALIS STAGE 16 — No fabricated facts in the request model
 *
 * `RequestDNA.create` had a fabricated fallback for every optional argument,
 * and `evaluateTrace` never passed those arguments — so the fallbacks were what
 * EVERY real request got. For a real Python FastAPI trace, VITALIS reported:
 *
 *   dependencies  : ["DB2-Cluster-01", "Stripe-Gateway-US"]
 *   environment   : { runtime: "WebSphere-9.0.5", jdk: "IBM Semeru 17", host: "app-node-04" }
 *   changeContext : { lastDeploy: "app-v2.4.1 (14m ago)", configHash: "cfg-8841" }
 *   semantics     : { status: 504, headersValid: true, authScopePresent: true }
 *
 * None of it was observed. It told an operator their Python service runs on
 * WebSphere with an IBM JDK and deployed fourteen minutes ago. The 504 was
 * derived from latency alone — no HTTP status was ever seen. Specific,
 * plausible, actionable, and false.
 *
 *  F1  No IBM/demo string appears anywhere in a real request's model.
 *  F2  Dependencies are the services actually observed on the request.
 *  F3  Environment carries only what the OTel resource declared; runtime and
 *      host are absent, not invented.
 *  F4  An HTTP status is reported only when one was ingested — never derived
 *      from latency.
 *  F5  changeContext is absent rather than invented; real correlation lives in
 *      the separately evidenced `changeCorrelation`.
 *  F6  The hardcoded 180ms budget and the WebSphere/DB2 "isStandard" flag are
 *      gone from the model entirely.
 *
 * Outputs: artifacts/stage16-no-fabrication-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.VITALIS_API_KEY = 'stage16-key';
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage16-'));

const { VitalisIngestEngine } = require('../server');

const report = { suite: 'stage16-no-fabricated-facts', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}

const TRACE = 'cc'.repeat(16);
const engine = new VitalisIngestEngine();
engine.ingestOtelSpans([{
  resource: { attributes: [
    { key: 'service.name', value: { stringValue: 'finlife-api' } },
    { key: 'service.version', value: { stringValue: '1.0.1' } },
    { key: 'deployment.environment', value: { stringValue: 'dev' } }
  ]},
  scopeSpans: [{ spans: [{ traceId: TRACE, spanId: '01'.repeat(8), name: 'GET /accounts',
    startTimeUnixNano: 1e18, endTimeUnixNano: 1e18 + 3e9,
    attributes: [{ key: 'http.status_code', value: { intValue: 200 } }] }] }]
}]);
const result = engine.evaluateTrace(TRACE);
const dna = result.dna;

console.log('==================================================================');
console.log('VITALIS STAGE 16 — NO FABRICATED FACTS');
console.log('==================================================================');

// ---------------------------------------------------------------- F1
{
  const serialised = JSON.stringify(dna);
  const banned = ['DB2-Cluster-01', 'Stripe-Gateway-US', 'WebSphere-9.0.5', 'IBM Semeru', 'app-node-04', 'app-v2.4.1', 'cfg-8841'];
  const found = banned.filter(b => serialised.includes(b));
  const passed = found.length === 0;
  report.evidence.F1 = { found, dna };
  gate('F1_noDemoStringsInRealRequest', 'F1 No IBM/demo strings in a real request model', passed, [
    `checked for : ${banned.join(', ')}`,
    `found       : ${found.length === 0 ? 'none' : found.join(', ')}`
  ]);
}

// ---------------------------------------------------------------- F2
{
  const passed = Array.isArray(dna.dependencies)
    && dna.dependencies.length === 1 && dna.dependencies[0] === 'finlife-api'
    && /OBSERVED/.test(dna.dependenciesProvenance);
  report.evidence.F2 = { dependencies: dna.dependencies, provenance: dna.dependenciesProvenance };
  gate('F2_dependenciesAreObserved', 'F2 Dependencies are the services actually seen', passed, [
    `dependencies : ${JSON.stringify(dna.dependencies)}`,
    `provenance   : ${dna.dependenciesProvenance}`
  ]);
}

// ---------------------------------------------------------------- F3
{
  const env = dna.environment;
  const passed = env.serviceVersions && env.serviceVersions['finlife-api'] === '1.0.1'
    && env.deploymentEnvironment === 'dev'
    && env.runtime === undefined && env.host === undefined
    && /runtime and host are not ingested/.test(dna.environmentProvenance);
  report.evidence.F3 = { environment: env, provenance: dna.environmentProvenance };
  gate('F3_environmentOnlyFromResource', 'F3 Environment carries only declared resource attributes', passed, [
    `serviceVersions : ${JSON.stringify(env.serviceVersions)}`,
    `environment     : ${env.deploymentEnvironment}`,
    `runtime / host  : ${env.runtime} / ${env.host} (absent, not invented)`
  ]);
}

// ---------------------------------------------------------------- F4
{
  // Observed status is reported...
  const withStatus = dna.semantics.status === 200 && dna.semantics.statusProvenance === 'OBSERVED';

  // ...and a slow request with NO status attribute must not manufacture a 504.
  const t2 = 'dd'.repeat(16);
  engine.ingestOtelSpans([{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'slow-api' } }] },
    scopeSpans: [{ spans: [{ traceId: t2, spanId: '02'.repeat(8), name: 'GET /slow',
      startTimeUnixNano: 1e18, endTimeUnixNano: 1e18 + 9e9 }] }]
  }]);
  const slow = engine.evaluateTrace(t2).dna;
  const noInvention = slow.semantics.status === undefined && /UNKNOWN/.test(slow.semantics.statusProvenance);

  const passed = withStatus && noInvention;
  report.evidence.F4 = { observed: dna.semantics, slow: slow.semantics, slowMs: slow.performance.totalDurationMs };
  gate('F4_statusOnlyWhenObserved', 'F4 HTTP status is never derived from latency', passed, [
    `status reported when ingested : ${dna.semantics.status} (${dna.semantics.statusProvenance})`,
    `9,000ms request with no status: ${slow.semantics.status} — ${slow.semantics.statusProvenance}`,
    `(previously this invented HTTP 504 from duration alone)`
  ]);
}

// ---------------------------------------------------------------- F5
{
  const passed = dna.changeContext === undefined && result.changeCorrelation !== undefined;
  report.evidence.F5 = { changeContext: dna.changeContext, hasRealCorrelation: result.changeCorrelation !== undefined };
  gate('F5_noInventedChangeContext', 'F5 changeContext absent; real correlation is separate', passed, [
    `dna.changeContext        : ${dna.changeContext}`,
    `evidenced changeCorrelation present : ${result.changeCorrelation !== undefined}`
  ]);
}

// ---------------------------------------------------------------- F6
{
  const passed = !('isWithinBudget' in dna.performance) && !('isStandard' in dna.structure);
  report.evidence.F6 = { performanceKeys: Object.keys(dna.performance), structureKeys: Object.keys(dna.structure) };
  gate('F6_noHardcodedBudgetOrStandardFlag', 'F6 The 180ms budget and WebSphere/DB2 flag are gone', passed, [
    `performance keys : ${Object.keys(dna.performance).join(', ')}`,
    `structure keys   : ${Object.keys(dna.structure).join(', ')}`
  ]);
}

report.finishedAt = new Date().toISOString();
const allPassed = failures === 0;
console.log('\n==================================================================');
console.log(`OVERALL: ${allPassed ? 'ALL STAGE 16 NO-FABRICATION GATES PASSED' : `${failures} GATE(S) FAILED`}`);
console.log('==================================================================');
const dir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'stage16-no-fabrication-gate-report.json'), JSON.stringify(report, null, 2));
process.exit(allPassed ? 0 : 1);
