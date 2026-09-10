/**
 * VITALIS STAGE 5 — Durability & Approver Enrolment
 *
 * Two gaps closed, both verified against real behaviour rather than asserted.
 *
 * DURABILITY. Traces have survived a restart since Stage 0, but change events,
 * component inventories and advisories did not. That is worse than it sounds:
 * after a restart a changed, vulnerable system would report no correlated
 * changes and no exposure — absence of evidence rendered as evidence of
 * absence, which is the exact failure this project exists to prevent.
 *   P1  Change events survive a REAL process kill (SIGKILL, not a clean exit).
 *   P2  Component inventories and advisories survive the same kill, and the
 *       exposure answer after restart is the same as before it.
 *
 * ENROLMENT. Approver keys previously had to be registered in-process by hand.
 *   E1  A real enrolment round-trip: keypair generated on the approver's side,
 *       only the PUBLIC half enrolled, persisted, and an authority built from
 *       the registry verifies a real signature from that approver.
 *   E2  Enrolment refuses a private key, an unparseable key, a roleless
 *       approver, and an unattributable enrolment.
 *   E3  Revocation is honoured (the revoked approver's signature stops working)
 *       and the record is RETAINED with its reason for audit.
 *   E4  The pluggable verifier is genuinely used — an external verifier is
 *       substituted and observed to be called, proving an HSM/SSO signer can
 *       replace local crypto without touching any governance rule.
 *
 * Outputs: artifacts/stage5-durability-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const { ApproverRegistry, ExternalVerifier } = require('../engine/approver_enrolment');
const { ApprovalAuthority } = require('../engine/approval_authority');
const { GovernedRemediation, STATES } = require('../engine/governed_remediation');
const { EvidenceTruthLedger } = require('../engine/evidence_ledger');

const API_KEY = 'stage5-durability-key';
const PORT = 4331;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage5-'));
const SERVER = path.join(__dirname, '..', 'server.js');

function request(options, postData = null) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': API_KEY, ...(options.headers || {}) } };
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Boot a REAL server process (not in-process) so it can be genuinely SIGKILLed. */
async function bootServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, VITALIS_API_KEY: API_KEY, VITALIS_DATA_DIR: DATA_DIR, PORT: String(PORT) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    try {
      const r = await request({ hostname: 'localhost', port: PORT, path: '/health', method: 'GET' });
      if (r.status === 200) return child;
    } catch (e) { /* not up yet */ }
  }
  throw new Error('server did not come up');
}

async function killHard(child) {
  child.kill('SIGKILL');                 // no graceful shutdown, no flush-on-exit
  await new Promise(r => child.on('exit', r));
  await sleep(300);
}

async function run() {
  console.log('==================================================================');
  console.log('    VITALIS STAGE 5 — DURABILITY & APPROVER ENROLMENT             ');
  console.log('==================================================================\n');
  const report = { version: '1.0', testRun: `VITALIS-STAGE5-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };

  // ===================== DURABILITY =====================
  console.log('--- [GATE P1] Change events survive a real SIGKILL ---');
  let child = await bootServer();

  const commitSha = crypto.randomBytes(20).toString('hex');
  await request({ hostname: 'localhost', port: PORT, path: '/v1/changes', method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    changeEvents: [{
      id: 'CHG-DURABILITY-1', timestamp: new Date().toISOString(), type: 'CODE_COMMIT',
      service: 'CheckoutService', version: commitSha.slice(0, 7), commit: commitSha,
      author: 'durability@test', description: 'Change that must survive a crash'
    }]
  });

  await request({ hostname: 'localhost', port: PORT, path: '/v1/traces', method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'CheckoutService' } }] },
      scopeSpans: [{ spans: [{ traceId: 'TX-DURABILITY', spanId: 's1', name: 'Checkout', durationMs: 2500, startTimeUnixNano: Date.now() * 1e6 }] }]
    }]
  });

  const before = await request({ hostname: 'localhost', port: PORT, path: '/api/traces/TX-DURABILITY', method: 'GET' });
  const beforeCorrelated = ((before.data.changeCorrelation || {}).correlations || []).length;

  console.log(`> Before kill: ${beforeCorrelated} correlated change(s)`);
  await killHard(child);
  console.log('> Process SIGKILLed (no graceful shutdown, no flush-on-exit)');
  child = await bootServer();

  const after = await request({ hostname: 'localhost', port: PORT, path: '/api/traces/TX-DURABILITY', method: 'GET' });
  const cc = after.data.changeCorrelation || {};
  const afterCorrelated = (cc.correlations || []).length;
  const sameCommit = (cc.correlations || []).some(c => c.commit === commitSha);
  report.gates.changeEventsSurviveCrash = (beforeCorrelated >= 1 && afterCorrelated === beforeCorrelated && sameCommit) ? 'PASS' : 'FAIL';
  console.log(`> After restart: ${afterCorrelated} correlated change(s); same real commit recovered: ${sameCommit}`);
  console.log(`RESULT GATE P1: [${report.gates.changeEventsSurviveCrash}]\n`);

  // -----------------------------------------------------
  console.log('--- [GATE P2] Inventories and advisories survive; exposure answer unchanged ---');
  await request({ hostname: 'localhost', port: PORT, path: '/v1/components', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { service: 'CheckoutService', components: [{ name: 'lodash', version: '4.17.15', ecosystem: 'npm' }] });
  await request({ hostname: 'localhost', port: PORT, path: '/v1/vulnerabilities', method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    advisories: [{
      id: 'GHSA-durability-test', package: 'lodash', ecosystem: 'npm', severity: 'high',
      title: 'Durability probe advisory', vulnerableRange: '<4.17.21'
    }]
  });

  const impactBefore = await request({ hostname: 'localhost', port: PORT, path: '/api/impact/GHSA-durability-test', method: 'GET' });
  const exposedBefore = impactBefore.data.impactedRequestCount;
  console.log(`> Before kill: ${exposedBefore} exposed request(s)`);

  await killHard(child);
  console.log('> Process SIGKILLed again');
  child = await bootServer();

  const impactAfter = await request({ hostname: 'localhost', port: PORT, path: '/api/impact/GHSA-durability-test', method: 'GET' });
  const exposedAfter = impactAfter.data.impactedRequestCount;
  const stillFound = impactAfter.data.found === true;
  report.gates.exposureStateSurvivesCrash =
    (stillFound && exposedBefore >= 1 && exposedAfter === exposedBefore) ? 'PASS' : 'FAIL';
  console.log(`> After restart: advisory still known: ${stillFound}, exposed request(s): ${exposedAfter}`);
  console.log(`> A restart no longer makes a vulnerable service look clean: ${exposedAfter === exposedBefore}`);
  console.log(`RESULT GATE P2: [${report.gates.exposureStateSurvivesCrash}]\n`);

  await killHard(child);

  // ===================== ENROLMENT =====================
  const storePath = path.join(DATA_DIR, 'approvers.json');

  console.log('--- [GATE E1] Real enrolment round-trip, persisted, signature verifies ---');
  const { privateKeyPem, request: enrolRequest } = ApproverRegistry.generateEnrolmentRequest('sre-lead@bank.corp', ['sre', 'sre-lead']);
  const privateNeverLeaves = !JSON.stringify(enrolRequest).includes('PRIVATE');
  let registry = new ApproverRegistry({ storePath });
  registry.enrol({
    approverId: enrolRequest.approverId, publicKeyPem: enrolRequest.publicKeyPem,
    roles: enrolRequest.roles, enrolledBy: 'security-admin@bank.corp'
  });

  // Reload from disk to prove persistence, then build an authority from it.
  registry = new ApproverRegistry({ storePath });
  const authority = registry.buildAuthority();
  const ledger = new EvidenceTruthLedger();
  const m = new GovernedRemediation({
    incidentId: 'INC-ENROL-1', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ledger, authority
  });
  m.diagnose({ title: 'Pool saturation', confidence: 70 });
  m.recommend(); m.assessRisk(); m.requestApproval();
  const approval = {
    incidentId: 'INC-ENROL-1', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ticketId: 'CHG-9001', approverId: 'sre-lead@bank.corp',
    nonce: crypto.randomUUID(), expiresAt: Date.now() + 300000
  };
  approval.signature = ApprovalAuthority.sign(privateKeyPem, approval);
  const approved = m.approve(approval);

  report.gates.enrolmentRoundTrip =
    (privateNeverLeaves && approved.approved === true && m.state === STATES.APPROVED && fs.existsSync(storePath)) ? 'PASS' : 'FAIL';
  console.log(`> Enrolment request contains no private key: ${privateNeverLeaves}`);
  console.log(`> Fingerprint for out-of-band check: ${enrolRequest.fingerprint}`);
  console.log(`> Registry reloaded from disk and approval verified: ${approved.approved} (state=${m.state})`);
  console.log(`RESULT GATE E1: [${report.gates.enrolmentRoundTrip}]\n`);

  // -----------------------------------------------------
  console.log('--- [GATE E2] Enrolment refuses unsafe or unattributable input ---');
  const refusals = {};
  const tryEnrol = (label, args) => {
    try { registry.enrol(args); refusals[label] = false; }
    catch (err) { refusals[label] = true; console.log(`> ${label}: refused — ${err.message}`); }
  };
  tryEnrol('private key submitted', { approverId: 'x@b.c', publicKeyPem: privateKeyPem, roles: ['sre'], enrolledBy: 'admin' });
  tryEnrol('unparseable key', { approverId: 'x@b.c', publicKeyPem: 'not-a-key', roles: ['sre'], enrolledBy: 'admin' });
  tryEnrol('no roles', { approverId: 'x@b.c', publicKeyPem: enrolRequest.publicKeyPem, roles: [], enrolledBy: 'admin' });
  tryEnrol('unattributable', { approverId: 'x@b.c', publicKeyPem: enrolRequest.publicKeyPem, roles: ['sre'] });
  report.gates.enrolmentRefusesUnsafeInput = Object.values(refusals).every(Boolean) ? 'PASS' : 'FAIL';
  console.log(`RESULT GATE E2: [${report.gates.enrolmentRefusesUnsafeInput}]\n`);

  // -----------------------------------------------------
  console.log('--- [GATE E3] Revocation takes effect and the record is retained ---');
  registry.revoke('sre-lead@bank.corp', { revokedBy: 'security-admin@bank.corp', reason: 'left the on-call rotation' });
  const afterRevoke = new ApproverRegistry({ storePath });
  const revokedRecord = afterRevoke.list().find(r => r.approverId === 'sre-lead@bank.corp');
  const authority2 = afterRevoke.buildAuthority();

  const m2 = new GovernedRemediation({
    incidentId: 'INC-ENROL-2', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ledger: new EvidenceTruthLedger(), authority: authority2
  });
  m2.diagnose({ title: 'Pool saturation', confidence: 70 });
  m2.recommend(); m2.assessRisk(); m2.requestApproval();
  const approval2 = { ...approval, incidentId: 'INC-ENROL-2', nonce: crypto.randomUUID(), expiresAt: Date.now() + 300000 };
  approval2.signature = ApprovalAuthority.sign(privateKeyPem, approval2);
  const revokedResult = m2.approve(approval2);

  const recordRetained = !!revokedRecord && revokedRecord.revoked === true
    && revokedRecord.revocationReason === 'left the on-call rotation' && !!revokedRecord.revokedBy;
  report.gates.revocationEnforcedAndAudited =
    (revokedResult.approved === false && recordRetained) ? 'PASS' : 'FAIL';
  console.log(`> Revoked approver's valid signature -> ${revokedResult.approved ? 'ACCEPTED' : 'REJECTED'} (${revokedResult.reason})`);
  console.log(`> Record retained for audit: revoked=${revokedRecord && revokedRecord.revoked}, by=${revokedRecord && revokedRecord.revokedBy}, reason="${revokedRecord && revokedRecord.revocationReason}"`);
  console.log(`RESULT GATE E3: [${report.gates.revocationEnforcedAndAudited}]\n`);

  // -----------------------------------------------------
  console.log('--- [GATE E4] A pluggable external verifier is genuinely used ---');
  let externalCalled = 0;
  const externalStore = path.join(DATA_DIR, 'approvers-external.json');
  const extRegistry = new ApproverRegistry({
    storePath: externalStore,
    verifier: new ExternalVerifier({
      name: 'pretend-hsm',
      verifyFn: (publicKeyRef, bytes, sig) => {
        externalCalled++;
        // Delegate to real crypto so this proves the WIRING, not a stubbed "true".
        try {
          return crypto.verify(null, bytes, crypto.createPublicKey(publicKeyRef), Buffer.from(String(sig), 'base64'));
        } catch (e) { return false; }
      }
    })
  });
  extRegistry.enrol({
    approverId: 'hsm-user@bank.corp', publicKeyPem: enrolRequest.publicKeyPem,
    roles: ['sre'], enrolledBy: 'security-admin@bank.corp'
  });
  const extAuthority = extRegistry.buildAuthority();
  const m3 = new GovernedRemediation({
    incidentId: 'INC-HSM-1', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ledger: new EvidenceTruthLedger(), authority: extAuthority
  });
  m3.diagnose({ title: 'Pool saturation', confidence: 70 });
  m3.recommend(); m3.assessRisk(); m3.requestApproval();
  const approval3 = {
    incidentId: 'INC-HSM-1', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ticketId: 'CHG-9002', approverId: 'hsm-user@bank.corp',
    nonce: crypto.randomUUID(), expiresAt: Date.now() + 300000
  };
  approval3.signature = ApprovalAuthority.sign(privateKeyPem, approval3);
  const extResult = m3.approve(approval3);

  // And prove it still fails closed: a bad signature through the same path.
  const m4 = new GovernedRemediation({
    incidentId: 'INC-HSM-2', actionId: 'connection-pool.restart', target: 'pool:checkout-db-pool',
    ledger: new EvidenceTruthLedger(), authority: extRegistry.buildAuthority()
  });
  m4.diagnose({ title: 'Pool saturation', confidence: 70 });
  m4.recommend(); m4.assessRisk(); m4.requestApproval();
  const bad = { ...approval3, incidentId: 'INC-HSM-2', nonce: crypto.randomUUID(), expiresAt: Date.now() + 300000, signature: Buffer.from('nonsense').toString('base64') };
  const badResult = m4.approve(bad);

  report.gates.pluggableVerifierUsed =
    (externalCalled >= 2 && extResult.approved === true && badResult.approved === false) ? 'PASS' : 'FAIL';
  console.log(`> External verifier invoked ${externalCalled} time(s) — local crypto was bypassed`);
  console.log(`> Valid signature through the external path: ${extResult.approved}`);
  console.log(`> Invalid signature through the external path: ${badResult.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`RESULT GATE E4: [${report.gates.pluggableVerifierUsed}]\n`);

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 5 DURABILITY GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log('==================================================================');

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage5-durability-gate-report.json'), JSON.stringify(report, null, 2));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
