/**
 * VITALIS STAGE 1 — Evidence Honesty Verification
 * Proves the fix to a real bug found during the Stage 0 security review:
 * evaluateTrace() used to print the SAME hardcoded lock-wait/pool/PID numbers
 * for every DB deviation, regardless of what was actually ingested. Now it
 * must read real values from span attributes (the documented adapter
 * contract, engine/adapters/ADAPTER_CONTRACT.md) and say UNKNOWN — never a
 * fabricated specific number — when an adapter didn't report them.
 *
 * Outputs: artifacts/stage1-evidence-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_API_KEY = 'stage1-evidence-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage1-test-'));

const { startServer, stopServer } = require('../server');
const TEST_PORT = 4323;

function makeRequest(options, postData = null) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': TEST_API_KEY, ...(options.headers || {}) } };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

function postDbSpan(traceId, durationMs, attributes) {
  return makeRequest({
    hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'Postgres' } }] },
      scopeSpans: [{ spans: [{ traceId, spanId: 'sp-db', name: 'DB-Query', durationMs, attributes: attributes || [] }] }]
    }]
  });
}

async function run() {
  console.log("==================================================================");
  console.log("     VITALIS STAGE 1 — EVIDENCE HONESTY VERIFICATION HARNESS      ");
  console.log("==================================================================\n");
  const report = { version: "1.0", testRun: `VITALIS-STAGE1-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };
  await startServer(TEST_PORT);

  try {
    // -------------------------------------------------------------
    console.log("--- [GATE E1] Full evidence present -> real, non-fabricated numbers ---");
    const fullId = 'TX-EVIDENCE-FULL-001';
    await postDbSpan(fullId, 3982, [
      { key: 'db.lock_wait_ms', value: { intValue: 1500 } },
      { key: 'db.connection_pool.saturation_pct', value: { intValue: 95 } },
      { key: 'db.query.fingerprint', value: { stringValue: 'Q-CUSTOM-1' } },
      { key: 'db.cpu_utilization_pct', value: { intValue: 40 } },
      { key: 'db.holding_lock_pid', value: { intValue: 55555 } }
    ]);
    const fullResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${fullId}`, method: 'GET' });
    const fullCandidate = fullResp.data.candidates[0];
    const fullText = JSON.stringify(fullCandidate);

    const gateE1 = fullText.includes('1500ms') && fullText.includes('Q-CUSTOM-1') && fullText.includes('55555') && fullText.includes('95%') === false ? true : fullText.includes('55555');
    // (loose check: the specific numbers we posted must appear verbatim, proving they were
    // read from the request rather than being the old fixed demo values of 2100ms/98%/99142)
    const usesRealNumbers = fullText.includes('1500ms') && fullText.includes('Q-CUSTOM-1') && fullText.includes('#55555');
    const doesNotUseOldFakeNumbers = !fullText.includes('2,100ms') && !fullText.includes('#99142');
    report.gates.realEvidenceUsedWhenPresent = (usesRealNumbers && doesNotUseOldFakeNumbers) ? "PASS" : "FAIL";
    console.log(`> Candidate cites the numbers actually posted (1500ms, Q-CUSTOM-1, PID #55555): ${usesRealNumbers}`);
    console.log(`> Candidate does NOT cite the old fixed demo numbers (2,100ms, PID #99142): ${doesNotUseOldFakeNumbers}`);
    console.log(`RESULT GATE E1: [${report.gates.realEvidenceUsedWhenPresent}]\n`);

    // -------------------------------------------------------------
    console.log("--- [GATE E2] No evidence attributes -> honest UNKNOWN, not fabricated ---");
    const bareId = 'TX-EVIDENCE-BARE-001';
    await postDbSpan(bareId, 3982, []); // a DB hop that's slow, but the adapter reported nothing else
    const bareResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${bareId}`, method: 'GET' });
    const bareCandidate = bareResp.data.candidates[0];
    const bareText = JSON.stringify(bareCandidate);

    const saysUnknown = bareText.includes('UNKNOWN');
    const doesNotFabricate = !bareText.includes('2,100ms') && !bareText.includes('#99142') && !bareText.includes('98%') && !bareText.includes('Q-847');
    report.gates.honestWhenEvidenceMissing = (saysUnknown && doesNotFabricate) ? "PASS" : "FAIL";
    console.log(`> Response contains explicit UNKNOWN markers: ${saysUnknown}`);
    console.log(`> Response does NOT fabricate specific numbers with zero evidence: ${doesNotFabricate}`);
    console.log(`> recommendedAction: "${bareCandidate.recommendedAction}"`);
    console.log(`RESULT GATE E2: [${report.gates.honestWhenEvidenceMissing}]\n`);

  } finally {
    await stopServer();
    console.log("[CLEANUP] Test server stopped.\n");
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log("==================================================================");
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 1 EVIDENCE GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log("==================================================================");

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage1-evidence-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
