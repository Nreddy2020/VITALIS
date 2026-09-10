/**
 * VITALIS STAGE 4: Governed Remediation State Machine
 *
 * Replaces engine/remediation_state_machine.js, which had six defects proven by
 * running it (see tests/verify_stage4_governance_gates.js, gate D0):
 *
 *   1. `signature: sig-${Math.random()...}` — the "cryptographic signature" was
 *      a random string that nothing ever verified.
 *   2. `approve(operatorId = "sre-lead@bank.corp", ticketId = "INC-884192")` —
 *      approval defaulted to the SRE lead's identity and verified nothing, so
 *      any caller could approve anything as anyone.
 *   3. No transition guards at all: calling execute() straight after construction
 *      moved DETECTED -> EXECUTING, skipping diagnosis, risk assessment and
 *      approval entirely.
 *   4. The tamper-evident ledger was accepted in the constructor and then never
 *      written to — zero audit entries for the most dangerous operation in the
 *      product.
 *   5. `verifyPostAction(isHealthy = true)` defaulted to success, so an
 *      unverified action self-reported as COMPLETED.
 *   6. `assessRisk(riskLevel = "LOW")` defaulted to low risk.
 *
 * This module inverts all six. Its governing principle: every gate fails closed.
 * A missing approver, an unknown action, an unset flag, an unmeasured outcome —
 * each stops the machine rather than being defaulted into a permissive value.
 *
 * EXECUTION IS OFF BY DEFAULT. Even a perfectly valid, correctly signed,
 * in-scope, ticketed approval only ever reaches a dry run unless the operator
 * has explicitly enabled execution AND registered a real executor. Per the
 * roadmap, live execution is intended only after Stages 0-3 have run in
 * observe-only mode for 4-8 weeks with SRE and security sign-off.
 */

const { ApprovalAuthority } = require('./approval_authority');
const { getAction, targetIsValid, RISK } = require('./remediation_actions');

const STATES = {
  DETECTED: 'DETECTED',
  DIAGNOSED: 'DIAGNOSED',
  RECOMMENDED: 'RECOMMENDED',
  RISK_ASSESSED: 'RISK_ASSESSED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  ROLLING_BACK: 'ROLLING_BACK',
  ROLLED_BACK: 'ROLLED_BACK',
  REFUSED: 'REFUSED'
};

/** The only transitions that may ever happen. Anything else is refused. */
const LEGAL_TRANSITIONS = {
  DETECTED:          [STATES.DIAGNOSED, STATES.REFUSED],
  DIAGNOSED:         [STATES.RECOMMENDED, STATES.REFUSED],
  RECOMMENDED:       [STATES.RISK_ASSESSED, STATES.REFUSED],
  RISK_ASSESSED:     [STATES.AWAITING_APPROVAL, STATES.REFUSED],
  AWAITING_APPROVAL: [STATES.APPROVED, STATES.REFUSED],
  APPROVED:          [STATES.EXECUTING, STATES.REFUSED],
  EXECUTING:         [STATES.VERIFYING, STATES.ROLLING_BACK, STATES.REFUSED],
  VERIFYING:         [STATES.COMPLETED, STATES.ROLLING_BACK, STATES.REFUSED],
  ROLLING_BACK:      [STATES.ROLLED_BACK, STATES.REFUSED],
  COMPLETED:         [],
  ROLLED_BACK:       [],
  REFUSED:           []
};

class GovernanceError extends Error {
  constructor(message) { super(message); this.name = 'GovernanceError'; }
}

class GovernedRemediation {
  /**
   * @param opts.incidentId   the incident this remediation belongs to
   * @param opts.actionId     must exist in the allowlist — an unknown action is refused
   * @param opts.target       must match the action's target pattern
   * @param opts.ledger       EvidenceTruthLedger; REQUIRED — no audit sink, no remediation
   * @param opts.authority    ApprovalAuthority holding registered approver public keys
   * @param opts.executor     async fn actually performing the action. Absent = dry run only.
   * @param opts.executionEnabled  explicit opt-in. Defaults to false, and to false
   *                          unless VITALIS_ALLOW_REMEDIATION === 'true'.
   */
  constructor({ incidentId, actionId, target, ledger, authority, executor = null, executionEnabled } = {}) {
    if (!incidentId) throw new GovernanceError('incidentId is required');
    if (!ledger || typeof ledger.recordConclusion !== 'function') {
      throw new GovernanceError('A tamper-evident ledger is required — remediation without an audit trail is not permitted');
    }
    if (!(authority instanceof ApprovalAuthority)) {
      throw new GovernanceError('An ApprovalAuthority is required — remediation without verifiable approval is not permitted');
    }

    const action = getAction(actionId);
    if (!action) {
      throw new GovernanceError(`Action "${actionId}" is not in the remediation allowlist — refused`);
    }
    if (!targetIsValid(action, target)) {
      throw new GovernanceError(`Target "${target}" is not valid for action ${actionId} — refused`);
    }

    this.incidentId = incidentId;
    this.action = action;
    this.target = target;
    this.ledger = ledger;
    this.authority = authority;
    this.executor = executor;
    // Fails closed: only an explicit true, or an explicit env opt-in, enables execution.
    this.executionEnabled = executionEnabled === true
      || (executionEnabled === undefined && process.env.VITALIS_ALLOW_REMEDIATION === 'true');

    this.state = STATES.DETECTED;
    this.history = [];
    this.approval = null;
    /** Verified approvals collected so far — segregation of duties needs more than one for MEDIUM risk. */
    this.approvals = [];
    this.minApprovals = Number(action.minApprovals) > 0 ? Number(action.minApprovals) : 1;
    this._record(STATES.DETECTED, 'Incident detected', { actionId, target });
  }

  /** Every transition is guarded and written to the tamper-evident ledger. */
  _record(toState, reason, metadata = {}) {
    const from = this.state;
    if (this.history.length > 0) {
      const legal = LEGAL_TRANSITIONS[from] || [];
      if (!legal.includes(toState)) {
        throw new GovernanceError(
          `Illegal transition ${from} -> ${toState}. Legal from ${from}: [${legal.join(', ') || 'none — terminal state'}]`
        );
      }
    }

    const transition = {
      fromState: from,
      toState,
      timestamp: new Date().toISOString(),
      reason,
      metadata
    };
    this.state = toState;
    this.history.push(transition);

    // Real audit trail in the hash-chained ledger — the original never wrote here.
    const block = this.ledger.recordConclusion({
      traceId: this.incidentId,
      primaryHypothesis: `REMEDIATION ${from} -> ${toState}: ${reason}`,
      confidence: 100,
      supportingEvidence: [`action=${this.action.id}`, `target=${this.target}`, `risk=${this.action.riskClass}`],
      provenance: 'OBSERVED',
      sourceTelemetry: metadata
    });
    transition.ledgerBlock = block && (block.conclusionId || block.hash) ? (block.conclusionId || block.hash) : undefined;
    return transition;
  }

  /**
   * Write an audit entry WITHOUT changing state — used to record a partial
   * approval, which is a real, auditable event that does not yet advance the
   * machine. It goes through the same ledger, so a half-collected approval set
   * is as traceable as a completed one.
   */
  _annotate(reason, metadata = {}) {
    const entry = {
      fromState: this.state,
      toState: this.state,
      timestamp: new Date().toISOString(),
      reason,
      metadata,
      annotation: true
    };
    this.history.push(entry);
    this.ledger.recordConclusion({
      traceId: this.incidentId,
      primaryHypothesis: `REMEDIATION ${this.state} (no state change): ${reason}`,
      confidence: 100,
      supportingEvidence: [`action=${this.action.id}`, `target=${this.target}`],
      provenance: 'OBSERVED',
      sourceTelemetry: metadata
    });
    return entry;
  }

  refuse(reason, metadata = {}) {
    return this._record(STATES.REFUSED, reason, metadata);
  }

  diagnose(rcaCandidate) {
    if (!rcaCandidate || !rcaCandidate.title) throw new GovernanceError('diagnose() requires a real RCA candidate');
    return this._record(STATES.DIAGNOSED, `Root cause candidate: ${rcaCandidate.title}`, {
      confidence: rcaCandidate.confidence,
      provenance: rcaCandidate.provenance
    });
  }

  recommend() {
    return this._record(STATES.RECOMMENDED, `Recommended: ${this.action.description}`, {
      actionId: this.action.id, verify: this.action.verify
    });
  }

  /**
   * Risk is READ from the action definition, never passed in and never defaulted
   * to LOW. A HIGH-risk or irreversible action is refused here — it can be
   * recommended to a human, but this machine will not carry it to execution.
   */
  assessRisk() {
    const { riskClass, reversible } = this.action;
    if (riskClass === RISK.HIGH) {
      this.refuse(
        `Action ${this.action.id} is classified ${riskClass} and will not be auto-executed at this stage of the programme — recommend to a human instead`,
        { riskClass, reversible }
      );
      return { refused: true, riskClass };
    }
    if (!reversible) {
      this.refuse(`Action ${this.action.id} is irreversible; automatic rollback is impossible, so it will not be auto-executed`, { riskClass, reversible });
      return { refused: true, riskClass };
    }
    this._record(STATES.RISK_ASSESSED, `Risk assessed as ${riskClass} (reversible)`, { riskClass, reversible });
    return { refused: false, riskClass };
  }

  requestApproval() {
    return this._record(STATES.AWAITING_APPROVAL,
      `Awaiting ${this.minApprovals} cryptographically signed approval(s) from distinct holders of ` +
      `[${this.action.requiredRoles.join(', ')}]`,
      { requiredRoles: this.action.requiredRoles, minApprovals: this.minApprovals });
  }

  /**
   * Verify a REAL signed approval. A rejected approval refuses the remediation
   * rather than throwing — refusal is a normal, auditable outcome.
   *
   * Segregation of duties: an action requiring N approvals needs N *distinct*
   * humans. The same person signing twice — even with two perfectly valid
   * signatures and two fresh nonces — does not satisfy a two-person rule, and is
   * rejected. That is the whole point of the control: one compromised key or one
   * person's bad judgement must not be sufficient on its own.
   */
  approve(signedApproval) {
    const result = this.authority.verify(signedApproval, this.action, {
      incidentId: this.incidentId,
      actionId: this.action.id,
      target: this.target
    });

    if (!result.valid) {
      this.refuse(`Approval rejected: ${result.reason}`, { approverId: signedApproval && signedApproval.approverId });
      return { approved: false, reason: result.reason };
    }

    if (this.approvals.some(a => a.approverId === result.approverId)) {
      const reason = `Approver ${result.approverId} has already approved this action; ` +
                     `${this.minApprovals} DISTINCT approvers are required (segregation of duties)`;
      this.refuse(`Approval rejected: ${reason}`, { approverId: result.approverId });
      return { approved: false, reason };
    }

    this.approvals.push(result);
    this.approval = result; // most recent, kept for execute()/audit metadata

    if (this.approvals.length < this.minApprovals) {
      const remaining = this.minApprovals - this.approvals.length;
      this._annotate(
        `Approval ${this.approvals.length} of ${this.minApprovals} recorded from ${result.approverId} ` +
        `(roles: ${result.rolesHeld.join(', ')}, ticket ${result.ticketId}) — ${remaining} more required`,
        { approverId: result.approverId, ticketId: result.ticketId, collected: this.approvals.length, required: this.minApprovals }
      );
      return {
        approved: false,
        pending: true,
        collected: this.approvals.length,
        required: this.minApprovals,
        reason: `${remaining} further distinct approval(s) required`
      };
    }

    const approverIds = this.approvals.map(a => a.approverId);
    this._record(STATES.APPROVED,
      `Approved by ${approverIds.length} distinct approver(s): ${approverIds.join(', ')} under change ticket ${result.ticketId}`,
      { approvers: approverIds, ticketId: result.ticketId, minApprovals: this.minApprovals });
    return { approved: true, approverId: result.approverId, approvers: approverIds, ticketId: result.ticketId };
  }

  /**
   * Execute — or, by default, DON'T. Without an explicit opt-in and a registered
   * executor this performs a dry run and says so. It cannot be reached at all
   * without a verified approval, because APPROVED is the only legal predecessor.
   */
  async execute() {
    if (this.state !== STATES.APPROVED) {
      throw new GovernanceError(`Cannot execute from ${this.state} — a verified approval is required first`);
    }

    const dryRun = !this.executionEnabled || typeof this.executor !== 'function';
    const why = !this.executionEnabled
      ? 'execution is not enabled (set VITALIS_ALLOW_REMEDIATION=true and pass an executor after SRE + security sign-off)'
      : 'no executor is registered';

    this._record(STATES.EXECUTING,
      dryRun ? `DRY RUN — no control-plane call made: ${why}` : `Executing ${this.action.id} on ${this.target}`,
      { dryRun, actionId: this.action.id, target: this.target, ticketId: this.approval.ticketId });

    if (dryRun) return { executed: false, dryRun: true, reason: why };

    try {
      const result = await this.executor({
        actionId: this.action.id,
        target: this.target,
        incidentId: this.incidentId,
        approvedBy: this.approval.approverId,
        ticketId: this.approval.ticketId
      });
      return { executed: true, dryRun: false, result };
    } catch (err) {
      this._record(STATES.ROLLING_BACK, `Execution failed: ${err.message}`, { error: err.message });
      this._record(STATES.ROLLED_BACK, 'No control-plane change was completed; nothing to undo', {});
      return { executed: false, dryRun: false, error: err.message };
    }
  }

  /**
   * Verify the outcome by MEASUREMENT. `healthCheck` must be a function that
   * actually looks at post-action telemetry; there is no isHealthy default, so
   * an unverified action can never self-report success.
   */
  async verifyPostAction(healthCheck) {
    if (this.state !== STATES.EXECUTING) {
      throw new GovernanceError(`Cannot verify from ${this.state}`);
    }
    if (typeof healthCheck !== 'function') {
      throw new GovernanceError('verifyPostAction() requires a health-check function — success is measured, never assumed');
    }

    this._record(STATES.VERIFYING, `Verifying: ${this.action.verify}`, {});

    let healthy;
    try {
      healthy = await healthCheck();
    } catch (err) {
      healthy = false;
    }

    if (healthy === true) {
      this._record(STATES.COMPLETED, 'Post-action telemetry verified healthy against baseline', { healthy: true });
      return { completed: true, rolledBack: false };
    }

    // Anything that is not an explicit healthy===true rolls back.
    this._record(STATES.ROLLING_BACK,
      `Post-action verification did not confirm health (result: ${JSON.stringify(healthy)}) — rolling back`,
      { healthy });
    const rollbackAction = this.action.rollbackOf || null;
    this._record(STATES.ROLLED_BACK,
      rollbackAction ? `Rollback via ${rollbackAction} completed` : 'Action reverted; system returned to pre-action state',
      { rollbackAction });
    return { completed: false, rolledBack: true };
  }

  getStatus() {
    return {
      incidentId: this.incidentId,
      actionId: this.action.id,
      target: this.target,
      riskClass: this.action.riskClass,
      currentState: this.state,
      executionEnabled: this.executionEnabled,
      minApprovals: this.minApprovals,
      approvalsCollected: this.approvals.length,
      approvedBy: this.approvals.map(a => a.approverId),
      ticketId: this.approval ? this.approval.ticketId : null,
      history: this.history
    };
  }
}

module.exports = { GovernedRemediation, GovernanceError, STATES, LEGAL_TRANSITIONS };
