/**
 * VITALIS Beta-3.0 Gate 5: Recovery State Machine & Multi-Signal Proof
 * Validates the full remediation state machine lifecycle, human approval gate,
 * multi-signal verification, and cryptographic ledger sealing.
 */

const { RecoveryStateMachine, RECOVERY_STATES } = require('../../engine/verification/recovery_state_machine');
const { MultiSignalReplayComparator } = require('../../engine/verification/replay_comparator');
const { VerificationClaimBuilder } = require('../../engine/verification/verification_claims');
const { EvidenceTruthLedger } = require('../../engine/evidence_ledger');
const { EvidenceEnvelope } = require('../../engine/evidence/evidence_envelope');

console.log("================================================================================");
console.log(" VITALIS BETA-3.0 [GATE 5]: RECOVERY STATE MACHINE & MULTI-SIGNAL AUDIT SUITE");
console.log("================================================================================\n");

let passed = 0;
let total = 0;

function assert(condition, testName, details = "") {
  total++;
  if (condition) {
    passed++;
    console.log(` \x1b[32m✔\x1b[0m [PASS] ${testName}`);
    if (details) console.log(`   \x1b[90m↳ ${details}\x1b[0m`);
  } else {
    console.error(` \x1b[31m✖\x1b[0m [FAIL] ${testName}`);
    if (details) console.error(`   \x1b[31m↳ Details: ${details}\x1b[0m`);
  }
}

const traceId = "RECOVERY-SM-90210";

// 1. Initialize State Machine
const sm = new RecoveryStateMachine(traceId);
assert(sm.currentState === RECOVERY_STATES.INCIDENT_DETECTED, "State Machine initialized at INCIDENT_DETECTED");

// 2. Recommend Remediation Action
sm.recommendAction({
  actionId: "ACT-01",
  actionName: "KILL_LOCK_PID_99142",
  targetHost: "db2-luw-primary.corp",
  riskLevel: "LOW_BOUNDED"
});
assert(sm.currentState === RECOVERY_STATES.APPROVAL_REQUIRED, "State Machine transitioned to APPROVAL_REQUIRED");

// 3. Human Approval Gate
sm.approve({ userId: "LEAD_SRE_ANALYST", safetyToken: "TOKEN-AUTH-8823" });
assert(sm.currentState === RECOVERY_STATES.APPROVED, "State Machine transitioned to APPROVED");

// 4. Execution & Observation
sm.recordExecution({ status: "EXECUTED_SUCCESS", pidTerminated: 99142 });
assert(sm.currentState === RECOVERY_STATES.OBSERVING, "State Machine transitioned to OBSERVING");

// 5. Multi-Signal Verification
const preFix = [
  EvidenceEnvelope.create({
    traceId,
    component: { name: "WebSphere-Cell-01", type: "WEBSPHERE" },
    event: { type: "SERVLET", durationMs: 3890, status: "FAILED" },
    measurements: { observedDurationMs: 3890 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "DB2-LUW-PRIMARY", type: "DB2" },
    event: { type: "SQL", durationMs: 3850, status: "FAILED" },
    measurements: { observedDurationMs: 3850 }
  })
];

const postFix = [
  EvidenceEnvelope.create({
    traceId: `${traceId}-POST`,
    component: { name: "WebSphere-Cell-01", type: "WEBSPHERE" },
    event: { type: "SERVLET", durationMs: 42, status: "SUCCESS" },
    measurements: { observedDurationMs: 42 }
  }),
  EvidenceEnvelope.create({
    traceId: `${traceId}-POST`,
    component: { name: "DB2-LUW-PRIMARY", type: "DB2" },
    event: { type: "SQL", durationMs: 14, status: "SUCCESS" },
    measurements: { observedDurationMs: 14 }
  })
];

const comparatorResult = MultiSignalReplayComparator.compareAndVerify({
  preFixEnvelopes: preFix,
  postFixEnvelopes: postFix,
  goldenBaselineBudgetMs: 180
});

assert(comparatorResult.isRecoveryVerified === true, "Multi-Signal Comparator verified all 6 signals");
assert(comparatorResult.latencyReductionPct > 95, `Latency reduced by ${comparatorResult.latencyReductionPct}%`);

sm.evaluateRecovery(comparatorResult);
assert(sm.currentState === RECOVERY_STATES.VERIFIED, "State Machine successfully reached terminal VERIFIED state");

// 6. Build Cryptographic Claim and Record in Ledger
const claim = VerificationClaimBuilder.buildRecoveryClaim({
  traceId,
  remediationAction: "KILL_LOCK_PID_99142",
  comparatorResult,
  approver: "LEAD_SRE_ANALYST"
});

const ledger = new EvidenceTruthLedger();
ledger.recordConclusion({
  traceId,
  primaryHypothesis: claim.statement,
  confidence: claim.confidence,
  supportingEvidence: claim.supportingEvidence,
  provenance: claim.classification,
  sourceTelemetry: comparatorResult
});

const ledgerVerify = ledger.verifyLedgerIntegrity();
assert(ledgerVerify.isValid === true, "Recovery Claim permanently and cryptographically sealed into SHA-256 Ledger");

console.log("\n================================================================================");
console.log(` GATE 5 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) process.exit(0); else process.exit(1);
