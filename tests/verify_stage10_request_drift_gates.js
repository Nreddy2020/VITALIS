/**
 * VITALIS STAGE 10 — Compatibility drift ON A REQUEST PATH
 *
 * Stage 9 answered "are this repository's declared versions compatible?" — a
 * useful question that many tools already ask. This stage answers the charter's
 * question, which nothing on the market does:
 *
 *   "Are the versions of the components THIS REQUEST actually touched mutually
 *    compatible — and which of them can we not see at all?"
 *
 * The gates concentrate on the ways this join can lie:
 *
 *  R1  A violation in a bound component appears on the request path.
 *  R2  A hop with NO binding is UNKNOWN, is counted, and the request summary
 *      states the request has NOT been shown free of drift.
 *  R3  A component whose DEPLOYED version disagrees with the bound manifest is
 *      flagged — its findings describe a different build.
 *  R4  Scoping is real: a broken repository that is NOT on this path does not
 *      appear in this request's report.
 *  R5  Ambiguous or unattributable bindings are refused at load.
 *  R6  **LIVE**: real OTLP spans carrying `service.version` are posted to the
 *      real server, read back through the real API, and joined — proving the
 *      deployed version survives ingest rather than being discarded.
 *  R7  A component reporting two different versions within one request is
 *      recorded as a conflict, not silently collapsed to one.
 *
 * Outputs: artifacts/stage10-request-drift-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TEST_API_KEY = 'stage10-request-drift-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage10-'));

const { readRepo } = require('../engine/drift/manifest_reader');
const { checkDrift } = require('../engine/drift/drift_checker');
const { loadBindings } = require('../engine/drift/component_bindings');
const { analyseRequest, summariseRequest } = require('../engine/drift/request_drift');
const { startServer, stopServer } = require('../server');

const TEST_PORT = 4339;
const report = { suite: 'stage10-request-drift', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;

function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}

/** A real repo on disk: real package.json, real lockfile. */
function repo(name, deps, selfVersion = '1.0.0') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vitalis-s10-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name, version: selfVersion, dependencies: deps }, null, 2));
  const packages = { '': { name, version: selfVersion } };
  for (const [n, v] of Object.entries(deps)) packages[`node_modules/${n}`] = { version: v };
  fs.writeFileSync(path.join(dir, 'package-lock.json'),
    JSON.stringify({ name, lockfileVersion: 3, packages }, null, 2));
  return dir;
}

const analyse = (p) => { const reading = readRepo(p); return { reading, result: checkDrift(reading) }; };

// Two real repositories: one broken, one clean.
const BROKEN = repo('checkout-ui', { expo: '57.0.0', 'react-native': '0.85.0', react: '19.2.3' }, '3.2.0');
const CLEAN = repo('ledger-api', { expo: '54.0.35', 'react-native': '0.81.5', react: '19.1.0' }, '1.4.0');
const OFFPATH = repo('reporting', { expo: '57.0.0', 'react-native': '0.83.0' }, '9.9.9');

console.log('==================================================================');
console.log('VITALIS STAGE 10 — REQUEST-PATH DRIFT GATES');
console.log('==================================================================');

// ---------------------------------------------------------------- R1 + R4
{
  const bindings = loadBindings({ bindings: [
    { service: 'checkout-ui', manifestPath: BROKEN, declaredBy: 'test' },
    { service: 'ledger-api', manifestPath: CLEAN, declaredBy: 'test' },
    { service: 'reporting', manifestPath: OFFPATH, declaredBy: 'test' }
  ]});
  const trace = { traceId: 'TX-R1', hops: [
    { service: 'checkout-ui', serviceVersion: '3.2.0', durationMs: 20 },
    { service: 'ledger-api', serviceVersion: '1.4.0', durationMs: 40 }
  ]};
  const r = analyseRequest(trace, bindings, analyse);
  const broken = r.components.find(c => c.service === 'checkout-ui');
  const clean = r.components.find(c => c.service === 'ledger-api');
  const offPathAbsent = !r.components.some(c => c.service === 'reporting');

  const r1 = broken.status === 'VIOLATION'
    && broken.findings.some(f => f.status === 'VIOLATION' && f.ruleId === 'expo-sdk-57-react-native')
    && clean.status === 'CHECKED';
  report.evidence.R1 = { summary: r.summary, brokenStatus: broken.status, cleanStatus: clean.status };
  gate('R1_violationSurfacesOnPath', 'R1 Violation in a bound component appears on the path', r1, [
    `checkout-ui : ${broken.status} — ${broken.findings.filter(f => f.status === 'VIOLATION').map(f => f.detail).join('; ')}`,
    `ledger-api  : ${clean.status}`,
    `path totals : ${r.summary.violationsOnPath} violation(s) across ${r.summary.componentsOnPath} component(s)`
  ]);

  gate('R4_offPathRepoExcluded', 'R4 A broken repo NOT on this path is excluded', offPathAbsent, [
    `components in report : ${r.components.map(c => c.service).join(', ')}`,
    `'reporting' (bound, broken, not on path) present: ${!offPathAbsent}`
  ]);
}

// ---------------------------------------------------------------- R2
{
  const bindings = loadBindings({ bindings: [
    { service: 'ledger-api', manifestPath: CLEAN, declaredBy: 'test' }
  ]});
  const trace = { traceId: 'TX-R2', hops: [
    { service: 'ledger-api', serviceVersion: '1.4.0' },
    { service: 'mongo', durationMs: 90 },
    { service: 'third-party-kyc', durationMs: 300 }
  ]};
  const r = analyseRequest(trace, bindings, analyse);
  const summary = summariseRequest(r);
  const unbound = r.components.filter(c => !c.bound);
  const passed = unbound.length === 2
    && unbound.every(c => c.status === 'UNKNOWN')
    && r.summary.unbound === 2
    && /has NOT been shown to be free of drift/.test(summary);
  report.evidence.R2 = { summary, unbound: unbound.map(c => c.service) };
  gate('R2_unboundHopsAreUnknown', 'R2 Unbound hops are UNKNOWN and the summary says so', passed, [
    `unbound      : ${unbound.map(c => c.service).join(', ')}`,
    `summary      : ${summary}`
  ]);
}

// ---------------------------------------------------------------- R3
{
  const bindings = loadBindings({ bindings: [
    { service: 'ledger-api', manifestPath: CLEAN, declaredBy: 'test' }
  ]});
  // Deployed 1.4.0 in the manifest, but production is running 1.2.7.
  const trace = { traceId: 'TX-R3', hops: [{ service: 'ledger-api', serviceVersion: '1.2.7' }] };
  const r = analyseRequest(trace, bindings, analyse);
  const c = r.components[0];
  const summary = summariseRequest(r);
  const passed = c.versionAgreement.state === 'DISAGREES'
    && r.summary.analysedAgainstDifferentBuild === 1
    && /describe a different build/.test(summary);
  report.evidence.R3 = { versionAgreement: c.versionAgreement, summary };
  gate('R3_deployedVsDeclaredMismatch', 'R3 Deployed version disagreeing with source is flagged', passed, [
    `state   : ${c.versionAgreement.state}`,
    `detail  : ${c.versionAgreement.detail}`,
    `summary mentions a different build: ${/describe a different build/.test(summary)}`
  ]);
}

// ---------------------------------------------------------------- R5
{
  let dup = null, unattributed = null;
  try {
    loadBindings({ bindings: [
      { service: 'a', manifestPath: '/x', declaredBy: 'me' },
      { service: 'a', manifestPath: '/y', declaredBy: 'me' }
    ]});
  } catch (e) { dup = e.message; }
  try {
    loadBindings({ bindings: [{ service: 'b', manifestPath: '/x' }] });
  } catch (e) { unattributed = e.message; }
  const passed = dup !== null && /ambiguous/.test(dup) && unattributed !== null && /declaredBy/.test(unattributed);
  report.evidence.R5 = { dup, unattributed };
  gate('R5_ambiguousBindingRefused', 'R5 Ambiguous / unattributable bindings refused', passed, [
    `duplicate      : ${dup}`,
    `no declaredBy  : ${unattributed}`
  ]);
}

// ---------------------------------------------------------------- R7
{
  const bindings = loadBindings({ bindings: [{ service: 'ledger-api', manifestPath: CLEAN, declaredBy: 'test' }] });
  const trace = { traceId: 'TX-R7', hops: [
    { service: 'ledger-api', serviceVersion: '1.4.0' },
    { service: 'ledger-api', serviceVersion: '1.5.0' }   // rolling deploy mid-request
  ]};
  const r = analyseRequest(trace, bindings, analyse);
  const c = r.components[0];
  const passed = r.components.length === 1 && c.versionConflict === true && c.hopCount === 2;
  report.evidence.R7 = { versionConflict: c.versionConflict, hopCount: c.hopCount };
  gate('R7_versionConflictRecorded', 'R7 Two versions from one service in one request', passed, [
    `components  : ${r.components.length} (deduped)`,
    `hopCount    : ${c.hopCount}`,
    `conflict    : ${c.versionConflict} (must be true, not silently collapsed)`
  ]);
}

// ---------------------------------------------------------------- R6 (LIVE)
function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: TEST_PORT, path: pathname, method: 'POST',
      agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-vitalis-api-key': TEST_API_KEY }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: TEST_PORT, path: pathname, method: 'GET',
      agent: false, headers: { 'x-vitalis-api-key': TEST_API_KEY }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.end();
  });
}

async function live() {
  await startServer(TEST_PORT);
  const traceId = 'aa'.repeat(16);
  const now = Date.now() * 1e6;

  const resourceSpans = [
    {
      resource: { attributes: [
        { key: 'service.name', value: { stringValue: 'ledger-api' } },
        { key: 'service.version', value: { stringValue: '1.2.7' } },
        { key: 'deployment.environment', value: { stringValue: 'production' } }
      ]},
      scopeSpans: [{ spans: [{ traceId, spanId: '01'.repeat(8), name: 'POST /ledger', startTimeUnixNano: now, endTimeUnixNano: now + 40e6 }] }]
    },
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'mongo' } }] },
      scopeSpans: [{ spans: [{ traceId, spanId: '02'.repeat(8), name: 'find accounts', startTimeUnixNano: now + 10e6, endTimeUnixNano: now + 35e6 }] }]
    }
  ];

  const ingest = await post('/v1/traces', { resourceSpans });
  const fetched = await get(`/api/traces/${traceId}`);
  const parsed = JSON.parse(fetched.body);
  const hops = (parsed.hops || (parsed.dna && parsed.dna.hops) || []);

  const ledgerHop = hops.find(h => h.service === 'ledger-api');
  const mongoHop = hops.find(h => h.service === 'mongo');

  const bindings = loadBindings({ bindings: [{ service: 'ledger-api', manifestPath: CLEAN, declaredBy: 'nagarjuna' }] });
  const r = analyseRequest({ traceId, hops }, bindings, analyse);
  const ledger = r.components.find(c => c.service === 'ledger-api');
  const mongo = r.components.find(c => c.service === 'mongo');
  const summary = summariseRequest(r);

  const passed = ingest.status === 200
    && !!ledgerHop && ledgerHop.serviceVersion === '1.2.7'
    && ledgerHop.deploymentEnvironment === 'production'
    && !!mongoHop && mongoHop.serviceVersion === undefined   // never defaulted
    && !!ledger && ledger.versionAgreement.state === 'DISAGREES'
    && !!mongo && mongo.status === 'UNKNOWN'
    && r.summary.unbound === 1;

  report.evidence.R6 = { ingestStatus: ingest.status, ledgerHop, mongoHop, summary };
  gate('R6_liveOtlpVersionSurvivesIngest', 'R6 LIVE: service.version survives real OTLP ingest and joins', passed, [
    `ingest status            : ${ingest.status}`,
    `hops read back           : ${hops.length}`,
    `ledger-api serviceVersion: ${ledgerHop && ledgerHop.serviceVersion} (from the wire, not defaulted)`,
    `ledger-api environment   : ${ledgerHop && ledgerHop.deploymentEnvironment}`,
    `mongo serviceVersion     : ${mongoHop && mongoHop.serviceVersion} (must be undefined — absent stays absent)`,
    `deployed vs source       : ${ledger && ledger.versionAgreement.state}`,
    `mongo binding            : ${mongo && mongo.status}`,
    `summary                  : ${summary}`
  ]);

  await stopServer();
}

live().catch(err => { console.error('[FATAL]', err); failures++; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    const allPassed = failures === 0;
    console.log('\n==================================================================');
    console.log(`OVERALL: ${allPassed ? 'ALL STAGE 10 REQUEST-DRIFT GATES PASSED' : `${failures} GATE(S) FAILED`}`);
    console.log('==================================================================');
    const dir = path.join(__dirname, '..', 'artifacts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stage10-request-drift-gate-report.json'), JSON.stringify(report, null, 2));
    process.exit(allPassed ? 0 : 1);
  });
