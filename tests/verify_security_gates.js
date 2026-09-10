/**
 * VITALIS STAGE 0 — Security Hardening Verification Suite
 * Proves the four Stage 0 exit criteria from
 * docs/VITALIS_Security_Implementation_Assessment.md and
 * docs/VITALIS_Implementation_Roadmap.md:
 *
 * Gate S1: every ingestion/API endpoint requires the x-vitalis-api-key header.
 * Gate S2: oversized ingestion payloads are rejected (413), not buffered forever.
 * Gate S3: PII/secrets in ingested spans are redacted before storage — this is
 *          the previously-existing gap where PrivacySanitizer was written but
 *          never actually called from the ingestion path.
 * Gate S4: killing and restarting the VITALIS process does not lose ingested
 *          evidence — tested as a REAL process restart (child_process spawn/
 *          kill/respawn), not just an in-process object surviving, since that's
 *          the actual claim being verified.
 *
 * Outputs: artifacts/security-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TEST_API_KEY = 'security-gate-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-security-test-'));

const { startServer, stopServer } = require('../server');
const TEST_PORT = 4321;

function makeRequest(options, postData = null) {
  // Fresh connection per request — this suite deliberately exercises abnormal
  // paths (oversized payloads that get the socket destroyed server-side), so
  // don't let a keep-alive agent try to reuse a socket that may no longer be good.
  options = { agent: false, ...options };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}'), raw: body }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });
}

function waitForHealth(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ hostname: 'localhost', port, path: '/health' }, res => {
        res.resume();
        if (res.statusCode === 200) resolve(); else retry();
      });
      req.on('error', retry);
      function retry() {
        if (Date.now() > deadline) reject(new Error('server did not become healthy in time'));
        else setTimeout(attempt, 150);
      }
    };
    attempt();
  });
}

async function run() {
  console.log("==================================================================");
  console.log("       VITALIS STAGE 0 — SECURITY GATE VERIFICATION HARNESS       ");
  console.log("==================================================================\n");

  const report = { version: "1.0", testRun: `VITALIS-SECURITY-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };

  await startServer(TEST_PORT);
  console.log(`[INIT] Vitalis Test Ingest Server running on port ${TEST_PORT}\n`);

  try {
    // -----------------------------------------------------------------
    // GATE S1: Authentication required on every ingestion/API endpoint
    // -----------------------------------------------------------------
    console.log("--- [GATE S1] Authentication required on ingestion & API endpoints ---");
    const noKeyResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { resourceSpans: [] });

    const wrongKeyResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: '/api/traces/anything', method: 'GET',
      headers: { 'x-vitalis-api-key': 'not-the-right-key' }
    });

    const rightKeyResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vitalis-api-key': TEST_API_KEY }
    }, { resourceSpans: [] });

    const healthResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: '/health', method: 'GET' });

    const gateS1 = noKeyResp.status === 401 && wrongKeyResp.status === 401 && rightKeyResp.status === 200 && healthResp.status === 200;
    report.gates.authenticationRequired = gateS1 ? "PASS" : "FAIL";
    console.log(`> No key:      HTTP ${noKeyResp.status} (expected 401)`);
    console.log(`> Wrong key:   HTTP ${wrongKeyResp.status} (expected 401)`);
    console.log(`> Correct key: HTTP ${rightKeyResp.status} (expected 200)`);
    console.log(`> /health (public by design): HTTP ${healthResp.status} (expected 200)`);
    console.log(`RESULT GATE S1: [${report.gates.authenticationRequired}]\n`);

    // -----------------------------------------------------------------
    // GATE S2: Oversized ingestion payloads are rejected
    // -----------------------------------------------------------------
    console.log("--- [GATE S2] Oversized payload rejection ---");
    const oversizedBody = JSON.stringify({ resourceSpans: [{ padding: 'X'.repeat(3 * 1024 * 1024) }] }); // 3MB > 2MB default cap
    const oversizedResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vitalis-api-key': TEST_API_KEY, 'Content-Length': Buffer.byteLength(oversizedBody) }
    }, oversizedBody).catch(err => ({ status: 'CONN_ERROR', error: err.message }));

    const gateS2 = oversizedResp.status === 413;
    report.gates.oversizedPayloadRejected = gateS2 ? "PASS" : "FAIL";
    console.log(`> 3MB payload (cap is 2MB): HTTP ${oversizedResp.status} (expected 413)`);
    console.log(`RESULT GATE S2: [${report.gates.oversizedPayloadRejected}]\n`);

    // -----------------------------------------------------------------
    // GATE S3: PII/secrets are redacted before storage
    // -----------------------------------------------------------------
    console.log("--- [GATE S3] PII/secret redaction on the real ingestion path ---");
    const traceId = 'TX-SECURITY-TEST-001';
    await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vitalis-api-key': TEST_API_KEY }
    }, {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "PaymentService" } }] },
        scopeSpans: [{ spans: [{
          traceId, spanId: 'sp-1', name: 'process-payment (card 4111 1111 1111 1111)', durationMs: 20,
          attributes: [
            { key: 'user.password', value: { stringValue: 'hunter2' } },
            { key: 'http.request.header.authorization', value: { stringValue: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def' } },
            { key: 'customer.note', value: { stringValue: 'ssn on file: 123-45-6789' } }
          ]
        }] }]
      }]
    });

    const evalResp = await makeRequest({
      hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${traceId}`, method: 'GET',
      headers: { 'x-vitalis-api-key': TEST_API_KEY }
    });
    const storedSpan = evalResp.data.hops[0];
    const rawStoredJson = JSON.stringify(storedSpan);

    const passwordRedacted = storedSpan.attributes.find(a => a.key === 'user.password').value.stringValue === '[REDACTED_FIELD]';
    const bearerRedacted = !rawStoredJson.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    const ssnRedacted = !rawStoredJson.includes('123-45-6789');
    const panRedacted = !rawStoredJson.includes('4111 1111 1111 1111') && !rawStoredJson.includes('4111111111111111');

    const gateS3 = passwordRedacted && bearerRedacted && ssnRedacted && panRedacted;
    report.gates.piiRedactedBeforeStorage = gateS3 ? "PASS" : "FAIL";
    console.log(`> password field masked by name:   ${passwordRedacted}`);
    console.log(`> bearer token masked by pattern:   ${bearerRedacted}`);
    console.log(`> SSN masked by pattern:            ${ssnRedacted}`);
    console.log(`> card PAN masked by pattern:        ${panRedacted}`);
    console.log(`RESULT GATE S3: [${report.gates.piiRedactedBeforeStorage}]\n`);

  } finally {
    await stopServer();
    console.log("[CLEANUP] In-process test server stopped.\n");
  }

  // -----------------------------------------------------------------
  // GATE S4: a REAL process restart does not lose ingested evidence
  // -----------------------------------------------------------------
  console.log("--- [GATE S4] Evidence survives a real process kill + restart ---");
  const restartPort = 4322;
  const restartDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-restart-test-'));
  const serverPath = path.join(__dirname, '..', 'server.js');
  const spawnOpts = { env: { ...process.env, PORT: String(restartPort), VITALIS_API_KEY: TEST_API_KEY, VITALIS_DATA_DIR: restartDataDir }, stdio: 'ignore' };

  let gateS4 = false;
  let child = spawn(process.execPath, [serverPath], spawnOpts);
  try {
    await waitForHealth(restartPort);
    const persistTraceId = 'TX-RESTART-SURVIVES-001';
    await makeRequest({
      hostname: 'localhost', port: restartPort, path: '/v1/traces', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vitalis-api-key': TEST_API_KEY }
    }, {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "RestartTestService" } }] },
        scopeSpans: [{ spans: [{ traceId: persistTraceId, spanId: 'sp-restart-1', name: 'pre-restart-span', durationMs: 33 }] }]
      }]
    });

    // Give the debounced disk flush a moment, then hard-kill (not a graceful stop)
    // to prove this isn't relying on a clean shutdown hook alone.
    await new Promise(r => setTimeout(r, 800));
    child.kill('SIGKILL');
    await new Promise(r => { child.on('exit', r); });

    child = spawn(process.execPath, [serverPath], spawnOpts);
    await waitForHealth(restartPort);

    const postRestartResp = await makeRequest({
      hostname: 'localhost', port: restartPort, path: `/api/traces/${persistTraceId}`, method: 'GET',
      headers: { 'x-vitalis-api-key': TEST_API_KEY }
    });

    gateS4 = postRestartResp.status === 200 && postRestartResp.data.hops.length === 1 && postRestartResp.data.hops[0].name === 'pre-restart-span';
    console.log(`> Ingested pre-restart, killed process (SIGKILL, not graceful), respawned`);
    console.log(`> Hop recovered after restart: ${gateS4} (${postRestartResp.data.hops.length} hop(s) found)`);
  } finally {
    try { child.kill('SIGKILL'); } catch (e) { /* already dead */ }
  }
  report.gates.evidenceSurvivesRestart = gateS4 ? "PASS" : "FAIL";
  console.log(`RESULT GATE S4: [${report.gates.evidenceSurvivesRestart}]\n`);

  // -----------------------------------------------------------------
  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log("==================================================================");
  console.log(`OVERALL: ${allPassed ? 'ALL SECURITY GATES PASSED' : 'ONE OR MORE SECURITY GATES FAILED'}`);
  console.log("==================================================================");

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'security-gate-report.json'), JSON.stringify(report, null, 2));

  process.exit(allPassed ? 0 : 1);
}

run().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
