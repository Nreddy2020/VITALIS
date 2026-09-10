/**
 * QUARANTINED — replaced in Stage 4 by engine/governed_remediation.js
 *
 * This module governed the only operation in VITALIS that can call a real
 * control-plane API, and it was unsafe. Six defects, each proven by running it
 * (tests/verify_stage4_governance_gates.js, gate D0, exploits them against the
 * preserved copy at engine/_deprecated/remediation_state_machine.legacy.js):
 *
 *   1. `signature: sig-${Math.random()...}` — the "cryptographic signature" was
 *      a random string, and nothing ever verified it.
 *   2. `approve(operatorId = "sre-lead@bank.corp", ticketId = "INC-884192")` —
 *      approval defaulted to the SRE lead's identity and checked nothing, so any
 *      caller could approve any action as anyone.
 *   3. No transition guards: `new RemediationStateMachine(...).execute()` moved
 *      DETECTED -> EXECUTING directly, skipping diagnosis, risk assessment and
 *      approval entirely.
 *   4. The tamper-evident ledger was taken in the constructor and never written
 *      to — zero audit entries for the highest-risk operation in the product.
 *   5. `verifyPostAction(isHealthy = true)` defaulted to success, so an
 *      unverified action self-reported COMPLETED.
 *   6. `assessRisk(riskLevel = "LOW")` defaulted to low risk.
 *
 * The replacement fails closed on every one of these: real Ed25519 approval
 * bound to a specific action/target/incident/ticket with nonce and expiry, RBAC,
 * a narrow action allowlist, enforced legal transitions, a real hash-chained
 * audit trail, measured (never assumed) verification with automatic rollback,
 * and execution disabled by default.
 */

class RemediationStateMachine {
  constructor() {
    throw new Error(
      'RemediationStateMachine is quarantined: it allowed unapproved execution and used a ' +
      'Math.random() value as a "cryptographic signature". Use { GovernedRemediation } from ' +
      'engine/governed_remediation.js instead.'
    );
  }
}

const REMEDIATION_STATES = Object.freeze({
  DETECTED: 'DETECTED', DIAGNOSED: 'DIAGNOSED', RECOMMENDED: 'RECOMMENDED',
  RISK_ASSESSED: 'RISK_ASSESSED', AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED', EXECUTING: 'EXECUTING', VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED', ROLLBACK: 'ROLLBACK', VERIFIED: 'VERIFIED'
});

module.exports = { RemediationStateMachine, REMEDIATION_STATES };
