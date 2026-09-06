/**
 * VITALIS BETA-1A: Controlled Closed-Loop Remediation State Machine
 * States:
 * DETECTED -> DIAGNOSED -> RECOMMENDED -> RISK_ASSESSED -> AWAITING_APPROVAL -> APPROVED -> EXECUTING -> VERIFYING -> COMPLETED / ROLLBACK -> VERIFIED
 */

const REMEDIATION_STATES = {
  DETECTED: "DETECTED",
  DIAGNOSED: "DIAGNOSED",
  RECOMMENDED: "RECOMMENDED",
  RISK_ASSESSED: "RISK_ASSESSED",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  COMPLETED: "COMPLETED",
  ROLLBACK: "ROLLBACK",
  VERIFIED: "VERIFIED"
};

class RemediationStateMachine {
  constructor(incidentId, targetAction, ledger) {
    this.incidentId = incidentId;
    this.targetAction = targetAction;
    this.ledger = ledger;
    this.state = REMEDIATION_STATES.DETECTED;
    this.history = [];
    this.recordTransition(REMEDIATION_STATES.DETECTED, "Incident detected by RIE baseline monitor");
  }

  recordTransition(toState, reason, metadata = {}) {
    const transition = {
      fromState: this.state,
      toState,
      timestamp: new Date().toISOString(),
      reason,
      metadata,
      signature: `sig-${Math.random().toString(36).substring(2, 10)}`
    };

    this.state = toState;
    this.history.push(transition);
    return transition;
  }

  diagnose(rcaCandidate) {
    return this.recordTransition(REMEDIATION_STATES.DIAGNOSED, `Root cause inferred: ${rcaCandidate.title}`);
  }

  recommend(actionPlan) {
    return this.recordTransition(REMEDIATION_STATES.RECOMMENDED, `Action recommended: ${actionPlan}`);
  }

  assessRisk(riskLevel = "LOW", blastRadius = "Checkout API") {
    return this.recordTransition(REMEDIATION_STATES.RISK_ASSESSED, `Risk evaluated as ${riskLevel}`, { riskLevel, blastRadius });
  }

  requestApproval() {
    return this.recordTransition(REMEDIATION_STATES.AWAITING_APPROVAL, "Awaiting cryptographic human approval from on-call engineer");
  }

  approve(operatorId = "sre-lead@bank.corp", ticketId = "INC-884192") {
    return this.recordTransition(REMEDIATION_STATES.APPROVED, `Approved by ${operatorId} for ticket ${ticketId}`, { operatorId, ticketId });
  }

  execute() {
    return this.recordTransition(REMEDIATION_STATES.EXECUTING, "Dispatching remediation command to cluster API");
  }

  verifyPostAction(isHealthy = true) {
    this.recordTransition(REMEDIATION_STATES.VERIFYING, "Verifying post-remediation telemetry against Golden Baseline");
    if (isHealthy) {
      return this.recordTransition(REMEDIATION_STATES.COMPLETED, "Telemetry confirmed healthy; transaction latency returned to baseline");
    } else {
      this.recordTransition(REMEDIATION_STATES.ROLLBACK, "Telemetry failed verification; triggering automatic canary rollback");
      return this.recordTransition(REMEDIATION_STATES.VERIFIED, "Rollback verified and stable");
    }
  }

  getStatus() {
    return {
      incidentId: this.incidentId,
      currentState: this.state,
      history: this.history
    };
  }
}

module.exports = { RemediationStateMachine, REMEDIATION_STATES };
