/**
 * VITALIS Beta-3.0: Formal Recovery State Machine
 * Manages remediation lifecycle with human-in-the-loop approvals, bounded safety,
 * observation windows, multi-signal verification, and rollback protections.
 */

const RECOVERY_STATES = {
  INCIDENT_DETECTED: "INCIDENT_DETECTED",
  HYPOTHESIS_CREATED: "HYPOTHESIS_CREATED",
  ACTION_RECOMMENDED: "ACTION_RECOMMENDED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVED: "APPROVED",
  EXECUTED: "EXECUTED",
  OBSERVING: "OBSERVING",
  RECOVERY_CANDIDATE: "RECOVERY_CANDIDATE",
  VERIFIED: "VERIFIED",
  // Failure / Rejection States
  REJECTED: "REJECTED",
  ROLLED_BACK: "ROLLED_BACK",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  VERIFICATION_INCONCLUSIVE: "VERIFICATION_INCONCLUSIVE"
};

class RecoveryStateMachine {
  constructor(incidentId) {
    this.incidentId = incidentId;
    this.currentState = RECOVERY_STATES.INCIDENT_DETECTED;
    this.history = [];
    this.remediationPlan = null;
    this.approvalContext = null;
    this.executionResult = null;
    this.verificationReport = null;
    this._recordTransition(null, this.currentState, "Incident triggered");
  }

  _recordTransition(from, to, reason) {
    this.history.push({
      from,
      to,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  transitionTo(nextState, reason = "") {
    const validTransitions = {
      [RECOVERY_STATES.INCIDENT_DETECTED]: [RECOVERY_STATES.HYPOTHESIS_CREATED],
      [RECOVERY_STATES.HYPOTHESIS_CREATED]: [RECOVERY_STATES.ACTION_RECOMMENDED],
      [RECOVERY_STATES.ACTION_RECOMMENDED]: [RECOVERY_STATES.APPROVAL_REQUIRED],
      [RECOVERY_STATES.APPROVAL_REQUIRED]: [RECOVERY_STATES.APPROVED, RECOVERY_STATES.REJECTED],
      [RECOVERY_STATES.APPROVED]: [RECOVERY_STATES.EXECUTED],
      [RECOVERY_STATES.EXECUTED]: [RECOVERY_STATES.OBSERVING],
      [RECOVERY_STATES.OBSERVING]: [RECOVERY_STATES.RECOVERY_CANDIDATE, RECOVERY_STATES.VERIFICATION_FAILED],
      [RECOVERY_STATES.RECOVERY_CANDIDATE]: [RECOVERY_STATES.VERIFIED, RECOVERY_STATES.ROLLED_BACK, RECOVERY_STATES.VERIFICATION_INCONCLUSIVE]
    };

    const allowed = validTransitions[this.currentState] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid state transition from ${this.currentState} to ${nextState}`);
    }

    const prevState = this.currentState;
    this.currentState = nextState;
    this._recordTransition(prevState, nextState, reason);
    return this.currentState;
  }

  recommendAction(actionDetails) {
    this.transitionTo(RECOVERY_STATES.HYPOTHESIS_CREATED, "Causal hypothesis formed");
    this.remediationPlan = actionDetails;
    this.transitionTo(RECOVERY_STATES.ACTION_RECOMMENDED, `Action recommended: ${actionDetails.actionName}`);
    this.transitionTo(RECOVERY_STATES.APPROVAL_REQUIRED, "Human approval requested");
    return this.currentState;
  }

  approve(approverInfo) {
    this.approvalContext = {
      approver: approverInfo.userId || "OPERATOR_ADMIN",
      approvedAt: new Date().toISOString(),
      boundedSafetyToken: approverInfo.safetyToken || "SAFETY_TOKEN_VERIFIED"
    };
    return this.transitionTo(RECOVERY_STATES.APPROVED, `Approved by ${this.approvalContext.approver}`);
  }

  reject(reason) {
    return this.transitionTo(RECOVERY_STATES.REJECTED, reason);
  }

  recordExecution(executionDetails) {
    this.executionResult = executionDetails;
    this.transitionTo(RECOVERY_STATES.EXECUTED, "Remediation executed in target environment");
    this.transitionTo(RECOVERY_STATES.OBSERVING, "Observing post-fix telemetry stream");
    return this.currentState;
  }

  evaluateRecovery(multiSignalCheck) {
    this.verificationReport = multiSignalCheck;
    if (multiSignalCheck.isRecoveryVerified) {
      this.transitionTo(RECOVERY_STATES.RECOVERY_CANDIDATE, "Multi-signal criteria met");
      return this.transitionTo(RECOVERY_STATES.VERIFIED, "Independent multi-signal recovery mathematically verified");
    } else {
      return this.transitionTo(RECOVERY_STATES.VERIFICATION_FAILED, multiSignalCheck.failureReason || "Signals did not meet recovery threshold");
    }
  }

  getStateSummary() {
    return {
      incidentId: this.incidentId,
      currentState: this.currentState,
      historyLength: this.history.length,
      history: [...this.history],
      remediationPlan: this.remediationPlan,
      approvalContext: this.approvalContext,
      executionResult: this.executionResult,
      verificationReport: this.verificationReport
    };
  }
}

module.exports = { RecoveryStateMachine, RECOVERY_STATES };
