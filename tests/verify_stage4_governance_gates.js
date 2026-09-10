/**
 * VITALIS STAGE 4 — Governed Remediation Verification
 *
 * Remediation is the only part of VITALIS that could ever call a real
 * control-plane API, so it gets the harshest tests in the project. This suite
 * first PROVES the defects in the old module by exploiting them, then proves
 * each one is closed in the new one.
 *
 *  D0  The old engine/remediation_state_machine.js is genuinely unsafe:
 *      execute() reachable straight from DETECTED with no approval, a
 *      Math.random() "signature", an unused audit ledger, and a
 *      verifyPostAction() that defaults to success.
 *
 *  G1  Real Ed25519 approval verifies, and a real audit trail is written.
 *  G2  A TAMPERED approval is rejected — changing the target after signing
 *      breaks the signature, so an approval for one pool cannot execute
 *      against another.
 *  G3  A FORGED approval (attacker's own keypair) is rejected.
 *  G4  RBAC: a real, correctly signed approval from someone lacking the
 *      required role is rejected.
 *  G5  REPLAY: a valid approval used a second time is rejected; an EXPIRED
 *      approval is rejected.
 *  G6  An action outside the allowlist cannot be constructed at all, and a
 *      HIGH-risk / irreversible action is refused before approval is sought.
 *  G7  Execution is OFF by default: even a fully valid approval only dry-runs,
 *      and no control-plane function is called.
 *  G8  Illegal transitions are refused: execute() cannot be reached without a
 *      verified approval.
 *  G9  Outcomes are measured, not assumed: verifyPostAction() requires a real
 *      health check, and a failing one triggers rollback.
 *
 * Outputs: artifacts/stage4-governance-gate-report.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ApprovalAuthority } = require('../engine/approval_authority');
const { GovernedRemediation, GovernanceError, STATES } = require('../engine/governed_remediation');
const { EvidenceTruthLedger } = require('../engine/evidence_ledger');

const INCIDENT = 'INC-STAGE4-001';
const ACTION = 'connection-pool.restart';
const TARGET = 'pool:checkout-db-pool';

function freshApproval(overrides = {}) {
  return {
    incidentId: INCIDENT,
    actionId: ACTION,
    target: TARGET,
    ticketId: 'CHG-4471',
    approverId: 'sre-lead@bank.corp',
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 5 * 60000,
    ...overrides
  };
}

/** Build a machine wired to a real ledger and a real authority. */
function newMachine(authority, opts = {}) {
  return new GovernedRemediation({
    incidentId: INCIDENT,
    actionId: opts.actionId || ACTION,
    target: opts.target || TARGET,
    ledger: opts.ledger || new EvidenceTruthLedger(),
    authority,
    executor: opts.executor || null,
    executionEnabled: opts.executionEnabled
  });
}

/** Walk a machine to AWAITING_APPROVAL. */
function driveToApproval(m) {
  m.diagnose({ title: 'Database Lock Contention & Connection Pool Saturation', confidence: 70, provenance: 'INFERRED' });
  m.recommend();
  const risk = m.assessRisk();
  if (risk.refused) return false;
  m.requestApproval();
  return true;
}

async function run() {
  console.log('==================================================================');
  console.log('      VITALIS STAGE 4 — GOVERNED REMEDIATION VERIFICATION         ');
  console.log('==================================================================\n');
  const report = { version: '1.0', testRun: `VITALIS-STAGE4-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };

  // Real keypairs: one legitimate approver, one attacker, one under-privileged.
  const sreLead = ApprovalAuthority.generateKeyPair();
  const attacker = ApprovalAuthority.generateKeyPair();
  const junior = ApprovalAuthority.generateKeyPair();

  const authority = new ApprovalAuthority();
  authority.registerApprover('sre-lead@bank.corp', sreLead.publicKeyPem, ['sre-lead', 'sre']);
  authority.registerApprover('junior@bank.corp', junior.publicKeyPem, ['viewer']);

  // ================= D0: prove the old module is unsafe =================
  console.log('--- [GATE D0] The ORIGINAL module is provably unsafe ---');
  const legacyLedger = { entries: [] };
  // The preserved original. The path it used to occupy is now a stub that
  // throws, so nothing can load the unsafe version by accident — this copy
  // exists solely so the defects stay provable rather than merely asserted.
  const { RemediationStateMachine } = require('../engine/_deprecated/remediation_state_machine.legacy');
  const legacy = new RemediationStateMachine('INC-LEGACY', 'Terminate DB session', legacyLedger);
  const legacyJump = legacy.execute();                 // no approval, no diagnosis
  const legacySig = legacy.history[0].signature;
  const legacyVerified = legacy.verifyPostAction();    // no argument at all

  const noApprovalNeeded = legacyJump.fromState === 'DETECTED' && legacyJump.toState === 'EXECUTING';
  const randomSignature = /^sig-[a-z0-9]{1,8}$/.test(legacySig);
  const ledgerUnused = legacyLedger.entries.length === 0;
  const assumedSuccess = legacy.state === 'COMPLETED';
  report.gates.originalModuleProvenUnsafe =
    (noApprovalNeeded && randomSignature && ledgerUnused && assumedSuccess) ? 'PASS' : 'FAIL';
  console.log(`> execute() reachable straight from DETECTED, skipping approval: ${noApprovalNeeded}`);
  console.log(`> "signature" is a Math.random() string ("${legacySig}"): ${randomSignature}`);
  console.log(`> audit ledger received ZERO entries: ${ledgerUnused}`);
  console.log(`> verifyPostAction() with no arguments self-reported COMPLETED: ${assumedSuccess}`);
  console.log(`RESULT GATE D0: [${report.gates.originalModuleProvenUnsafe}] (defects confirmed present in the old module)\n`);

  // The unsafe module must no longer be loadable from its original path.
  console.log('--- [GATE D1] The original path is quarantined and throws ---');
  let quarantined = false, quarantineMsg = '';
  try {
    const { RemediationStateMachine: Q } = require('../engine/remediation_state_machine');
    new Q('INC-X', 'anything', legacyLedger);
  } catch (err) { quarantined = true; quarantineMsg = err.message; }
  report.gates.unsafeModuleQuarantined = quarantined ? 'PASS' : 'FAIL';
  console.log(`> require('engine/remediation_state_machine') then construct -> threw: ${quarantined}`);
  console.log(`> "${quarantineMsg}"`);
  console.log(`RESULT GATE D1: [${report.gates.unsafeModuleQuarantined}]\n`);

  // ================= G1: real approval works =================
  console.log('--- [GATE G1] Real Ed25519 approval verifies, real audit trail written ---');
  const ledger = new EvidenceTruthLedger();
  const m1 = newMachine(authority, { ledger });
  driveToApproval(m1);
  const a1 = freshApproval();
  a1.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, a1);
  const r1 = m1.approve(a1);
  const chainOk = ledger.verifyLedgerIntegrity();
  const chainIntact = chainOk === true || (chainOk && (chainOk.isValid === true || chainOk.valid === true));
  const g1 = r1.approved === true && m1.state === STATES.APPROVED && ledger.chain.length >= 5 && chainIntact;
  report.gates.realApprovalVerifies = g1 ? 'PASS' : 'FAIL';
  console.log(`> Approved by ${r1.approverId} under ticket ${r1.ticketId}; state=${m1.state}`);
  console.log(`> Tamper-evident ledger blocks written: ${ledger.chain.length} (integrity: ${JSON.stringify(chainOk)})`);
  console.log(`RESULT GATE G1: [${report.gates.realApprovalVerifies}]\n`);

  // ================= G2: tampered approval =================
  console.log('--- [GATE G2] Tampering with a signed approval is detected ---');
  const m2 = newMachine(authority);
  driveToApproval(m2);
  const a2 = freshApproval();
  a2.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, a2);
  a2.target = 'pool:payments-db-pool';        // swap the target AFTER signing
  const r2 = m2.approve(a2);
  report.gates.tamperedApprovalRejected = (r2.approved === false && m2.state === STATES.REFUSED) ? 'PASS' : 'FAIL';
  console.log(`> Approval for "${TARGET}" re-pointed at "pool:payments-db-pool" -> ${r2.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`> reason: ${r2.reason}`);
  console.log(`RESULT GATE G2: [${report.gates.tamperedApprovalRejected}]\n`);

  // ================= G3: forged signature =================
  console.log('--- [GATE G3] A forged approval is rejected ---');
  const m3 = newMachine(authority);
  driveToApproval(m3);
  const a3 = freshApproval();
  a3.signature = ApprovalAuthority.sign(attacker.privateKeyPem, a3);   // attacker's key, real signature
  const r3 = m3.approve(a3);
  report.gates.forgedApprovalRejected = (r3.approved === false && m3.state === STATES.REFUSED) ? 'PASS' : 'FAIL';
  console.log(`> Attacker signed a well-formed approval as sre-lead -> ${r3.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`> reason: ${r3.reason}`);
  console.log(`RESULT GATE G3: [${report.gates.forgedApprovalRejected}]\n`);

  // ================= G4: RBAC =================
  console.log('--- [GATE G4] RBAC: a valid signature without the required role is rejected ---');
  const m4 = newMachine(authority);
  driveToApproval(m4);
  const a4 = freshApproval({ approverId: 'junior@bank.corp' });
  a4.signature = ApprovalAuthority.sign(junior.privateKeyPem, a4);     // genuinely their own key
  const r4 = m4.approve(a4);
  report.gates.rbacEnforced = (r4.approved === false && /requires one of/.test(r4.reason || '')) ? 'PASS' : 'FAIL';
  console.log(`> junior@bank.corp (roles: viewer) correctly signed an approval -> ${r4.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`> reason: ${r4.reason}`);
  console.log(`RESULT GATE G4: [${report.gates.rbacEnforced}]\n`);

  // ================= G5: replay + expiry =================
  console.log('--- [GATE G5] Replay and expiry are refused ---');
  const a5 = freshApproval();
  a5.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, a5);
  const m5a = newMachine(authority); driveToApproval(m5a);
  const first = m5a.approve(a5);                       // legitimate first use
  const m5b = newMachine(authority); driveToApproval(m5b);
  const replay = m5b.approve(a5);                      // same approval, second use

  const expired = freshApproval({ expiresAt: Date.now() - 1000 });
  expired.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, expired);
  const m5c = newMachine(authority); driveToApproval(m5c);
  const expiredResult = m5c.approve(expired);

  report.gates.replayAndExpiryRefused =
    (first.approved === true && replay.approved === false && /replay/i.test(replay.reason || '')
      && expiredResult.approved === false && /expired/i.test(expiredResult.reason || '')) ? 'PASS' : 'FAIL';
  console.log(`> First use accepted: ${first.approved}; replayed use -> ${replay.approved ? 'ACCEPTED' : 'REJECTED'} (${replay.reason})`);
  console.log(`> Expired approval -> ${expiredResult.approved ? 'ACCEPTED' : 'REJECTED'} (${expiredResult.reason})`);
  console.log(`RESULT GATE G5: [${report.gates.replayAndExpiryRefused}]\n`);

  // ================= G6: allowlist + risk class =================
  console.log('--- [GATE G6] Allowlist and risk class are enforced ---');
  let unknownRefused = false, unknownMsg = '';
  try {
    newMachine(authority, { actionId: 'rm -rf /', target: 'pool:x' });
  } catch (err) { unknownRefused = err instanceof GovernanceError; unknownMsg = err.message; }

  let badTargetRefused = false;
  try {
    newMachine(authority, { target: 'session:99142' });   // wrong target shape for a pool restart
  } catch (err) { badTargetRefused = err instanceof GovernanceError; }

  const mHigh = newMachine(authority, { actionId: 'db.terminate-session', target: 'session:99142' });
  mHigh.diagnose({ title: 'Lock contention', confidence: 70 });
  mHigh.recommend();
  const highRisk = mHigh.assessRisk();

  report.gates.allowlistAndRiskEnforced =
    (unknownRefused && badTargetRefused && highRisk.refused === true && mHigh.state === STATES.REFUSED) ? 'PASS' : 'FAIL';
  console.log(`> Unknown action refused at construction: ${unknownRefused} ("${unknownMsg}")`);
  console.log(`> Mismatched target shape refused at construction: ${badTargetRefused}`);
  console.log(`> HIGH-risk irreversible action refused before approval was sought: ${highRisk.refused} (state=${mHigh.state})`);
  console.log(`RESULT GATE G6: [${report.gates.allowlistAndRiskEnforced}]\n`);

  // ================= G7: execution off by default =================
  console.log('--- [GATE G7] Execution is OFF by default — valid approval still only dry-runs ---');
  let controlPlaneCalled = false;
  const executor = async () => { controlPlaneCalled = true; return { ok: true }; };
  delete process.env.VITALIS_ALLOW_REMEDIATION;          // ensure no ambient opt-in

  const m7 = newMachine(authority, { executor });         // executor present, flag absent
  driveToApproval(m7);
  const a7 = freshApproval();
  a7.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, a7);
  m7.approve(a7);
  const exec7 = await m7.execute();
  report.gates.executionOffByDefault =
    (exec7.executed === false && exec7.dryRun === true && controlPlaneCalled === false) ? 'PASS' : 'FAIL';
  console.log(`> Fully valid approval, executor registered, flag NOT set -> executed=${exec7.executed}, dryRun=${exec7.dryRun}`);
  console.log(`> Control-plane function was actually called: ${controlPlaneCalled}`);
  console.log(`> reason: ${exec7.reason}`);
  console.log(`RESULT GATE G7: [${report.gates.executionOffByDefault}]\n`);

  // ================= G8: illegal transitions =================
  console.log('--- [GATE G8] execute() is unreachable without a verified approval ---');
  const m8 = newMachine(authority, { executor, executionEnabled: true });
  let blocked = false, blockedMsg = '';
  try {
    await m8.execute();                                   // straight from DETECTED — the old exploit
  } catch (err) { blocked = err instanceof GovernanceError; blockedMsg = err.message; }

  let illegalJump = false;
  try {
    m8.requestApproval();                                 // DETECTED -> AWAITING_APPROVAL, skipping stages
  } catch (err) { illegalJump = err instanceof GovernanceError; }

  report.gates.illegalTransitionsRefused = (blocked && illegalJump && !controlPlaneCalled) ? 'PASS' : 'FAIL';
  console.log(`> execute() from DETECTED refused: ${blocked} ("${blockedMsg}")`);
  console.log(`> Skipping straight to AWAITING_APPROVAL refused: ${illegalJump}`);
  console.log(`> Control plane still never called: ${!controlPlaneCalled}`);
  console.log(`RESULT GATE G8: [${report.gates.illegalTransitionsRefused}]\n`);

  // ================= G9: measured outcome + rollback =================
  console.log('--- [GATE G9] Success is measured, and a failed check rolls back ---');
  const m9 = newMachine(authority, { executor, executionEnabled: true });
  driveToApproval(m9);
  const a9 = freshApproval();
  a9.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, a9);
  m9.approve(a9);
  const exec9 = await m9.execute();

  let needsHealthCheck = false;
  try { await m9.verifyPostAction(); } catch (err) { needsHealthCheck = err instanceof GovernanceError; }

  const outcome = await m9.verifyPostAction(async () => false);   // a real check that reports unhealthy
  report.gates.outcomeMeasuredAndRolledBack =
    (exec9.executed === true && needsHealthCheck && outcome.rolledBack === true && m9.state === STATES.ROLLED_BACK) ? 'PASS' : 'FAIL';
  console.log(`> With the flag explicitly enabled, the executor really ran: ${exec9.executed}`);
  console.log(`> verifyPostAction() with no health check refused: ${needsHealthCheck}`);
  console.log(`> Failing health check triggered rollback: ${outcome.rolledBack} (state=${m9.state})`);
  console.log(`RESULT GATE G9: [${report.gates.outcomeMeasuredAndRolledBack}]\n`);

  // ================= T1-T4: two-person rule =================
  // A MEDIUM-risk action requires two DISTINCT humans to each sign independently.
  const MED_ACTION = 'readreplica.scale-out';
  const MED_TARGET = 'db:checkout-cluster';
  const dba = ApprovalAuthority.generateKeyPair();
  authority.registerApprover('dba@bank.corp', dba.publicKeyPem, ['dba']);

  function medApproval(approverId, overrides = {}) {
    return {
      incidentId: INCIDENT, actionId: MED_ACTION, target: MED_TARGET,
      ticketId: 'CHG-4471', approverId,
      nonce: crypto.randomUUID(), expiresAt: Date.now() + 5 * 60000, ...overrides
    };
  }
  function medMachine(opts = {}) {
    const m = newMachine(authority, { actionId: MED_ACTION, target: MED_TARGET, ...opts });
    m.diagnose({ title: 'Sustained read saturation', confidence: 80, provenance: 'INFERRED' });
    m.recommend();
    m.assessRisk();
    m.requestApproval();
    return m;
  }

  console.log('--- [GATE T1] One approval is not enough for a two-person action ---');
  const t1 = medMachine();
  const t1a = medApproval('sre-lead@bank.corp');
  t1a.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, t1a);
  const t1r = t1.approve(t1a);
  const t1Ok = t1r.approved === false && t1r.pending === true
    && t1r.collected === 1 && t1r.required === 2 && t1.state === STATES.AWAITING_APPROVAL;
  report.gates.singleApprovalInsufficient = t1Ok ? 'PASS' : 'FAIL';
  console.log(`> Valid approval 1 of 2 -> approved=${t1r.approved}, pending=${t1r.pending}, state=${t1.state}`);
  console.log(`> "${t1r.reason}"`);
  console.log(`RESULT GATE T1: [${report.gates.singleApprovalInsufficient}]\n`);

  console.log('--- [GATE T2] The SAME person cannot satisfy a two-person rule ---');
  const t2 = medMachine();
  const t2a = medApproval('sre-lead@bank.corp');
  t2a.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, t2a);
  t2.approve(t2a);
  const t2b = medApproval('sre-lead@bank.corp');            // same human, fresh nonce, valid signature
  t2b.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, t2b);
  const t2r = t2.approve(t2b);
  const t2Ok = t2r.approved === false && /distinct/i.test(t2r.reason || '') && t2.state === STATES.REFUSED;
  report.gates.sameApproverCannotSelfSatisfy = t2Ok ? 'PASS' : 'FAIL';
  console.log(`> Same approver signs a second, independently valid approval -> ${t2r.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`> reason: ${t2r.reason}`);
  console.log(`> state: ${t2.state}`);
  console.log(`RESULT GATE T2: [${report.gates.sameApproverCannotSelfSatisfy}]\n`);

  console.log('--- [GATE T3] Two distinct approvers satisfy the rule ---');
  const t3 = medMachine();
  const t3a = medApproval('sre-lead@bank.corp');
  t3a.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, t3a);
  const first3 = t3.approve(t3a);
  const t3b = medApproval('dba@bank.corp');
  t3b.signature = ApprovalAuthority.sign(dba.privateKeyPem, t3b);
  const second3 = t3.approve(t3b);
  const t3Ok = first3.approved === false && second3.approved === true
    && t3.state === STATES.APPROVED && (second3.approvers || []).length === 2;
  report.gates.twoDistinctApproversAccepted = t3Ok ? 'PASS' : 'FAIL';
  console.log(`> After approval 1: state=${STATES.AWAITING_APPROVAL === t3.history[t3.history.length - 2].toState ? 'AWAITING_APPROVAL' : '?'}`);
  console.log(`> After approval 2: approved=${second3.approved}, approvers=${JSON.stringify(second3.approvers)}, state=${t3.state}`);
  console.log(`RESULT GATE T3: [${report.gates.twoDistinctApproversAccepted}]\n`);

  console.log('--- [GATE T4] A second approver lacking the role does not complete the set ---');
  const t4 = medMachine();
  const t4a = medApproval('sre-lead@bank.corp');
  t4a.signature = ApprovalAuthority.sign(sreLead.privateKeyPem, t4a);
  t4.approve(t4a);
  const t4b = medApproval('junior@bank.corp');              // real key, real signature, wrong role
  t4b.signature = ApprovalAuthority.sign(junior.privateKeyPem, t4b);
  const t4r = t4.approve(t4b);
  const t4Ok = t4r.approved === false && /requires one of/.test(t4r.reason || '') && t4.state === STATES.REFUSED;
  report.gates.underprivilegedSecondApproverRejected = t4Ok ? 'PASS' : 'FAIL';
  console.log(`> Second approver junior@bank.corp (roles: viewer) -> ${t4r.approved ? 'ACCEPTED' : 'REJECTED'}`);
  console.log(`> reason: ${t4r.reason}`);
  console.log(`RESULT GATE T4: [${report.gates.underprivilegedSecondApproverRejected}]\n`);

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 4 GOVERNANCE GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log('==================================================================');

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage4-governance-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
