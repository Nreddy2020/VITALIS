/**
 * VITALIS STAGE 4: The remediation action allowlist
 *
 * The roadmap is explicit that the first automated actions must be narrow and
 * low-risk — "restart a specific connection pool", NOT "kill a DB2 session" as a
 * first action. This file is that constraint expressed as code: an action that
 * is not defined here cannot be approved or executed at all, regardless of how
 * valid the approval signature is.
 *
 * Every action declares:
 *   riskClass       LOW | MEDIUM | HIGH  — HIGH is refused by the state machine
 *                   outright at this stage of the programme.
 *   requiredRoles   RBAC — the approving human must actually hold one of these.
 *   minApprovals    how many DISTINCT humans must each independently sign before
 *                   the action may proceed. MEDIUM-risk actions require two
 *                   (segregation of duties): one person's compromised key or bad
 *                   judgement is then not sufficient on its own.
 *   reversible      whether an automatic rollback is even possible. An
 *                   irreversible action must never be auto-executed.
 *   rollbackOf      the action that undoes it, where one exists.
 *   verify          what "did it work?" means for this action, so success is
 *                   measured rather than assumed.
 *
 * Adding an action here is a deliberate governance decision, not a code tidy-up:
 * it should go through the same review as any production change.
 */

const RISK = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

const ACTIONS = {
  // ---- Enabled: narrow, reversible, low blast radius -------------------
  'connection-pool.restart': {
    id: 'connection-pool.restart',
    description: 'Restart a single named application connection pool',
    riskClass: RISK.LOW,
    requiredRoles: ['sre', 'platform-oncall'],
    minApprovals: 1,
    reversible: true,
    targetPattern: /^pool:[A-Za-z0-9_.\-]+$/,
    verify: 'Pool reports healthy and request latency returns within baseline budget'
  },
  'cache.flush': {
    id: 'cache.flush',
    description: 'Flush a single named application cache',
    riskClass: RISK.LOW,
    requiredRoles: ['sre', 'platform-oncall', 'app-engineer'],
    minApprovals: 1,
    reversible: true,
    targetPattern: /^cache:[A-Za-z0-9_.\-]+$/,
    verify: 'Cache repopulates and error rate returns to baseline'
  },
  'readreplica.scale-out': {
    id: 'readreplica.scale-out',
    description: 'Add one read replica to a named database cluster',
    riskClass: RISK.MEDIUM,
    requiredRoles: ['sre-lead', 'dba'],
    minApprovals: 2,          // MEDIUM risk: two distinct humans must sign
    reversible: true,
    rollbackOf: 'readreplica.scale-in',
    targetPattern: /^db:[A-Za-z0-9_.\-]+$/,
    verify: 'Replica joins the cluster and read latency returns within baseline budget'
  },
  'readreplica.scale-in': {
    id: 'readreplica.scale-in',
    description: 'Remove one read replica from a named database cluster (rollback of scale-out)',
    riskClass: RISK.MEDIUM,
    requiredRoles: ['sre-lead', 'dba'],
    minApprovals: 2,
    reversible: true,
    targetPattern: /^db:[A-Za-z0-9_.\-]+$/,
    verify: 'Cluster remains healthy after the replica is removed'
  },

  // ---- Defined but deliberately HIGH risk ------------------------------
  // Present so the system can REASON about them and recommend them to a human,
  // while the state machine refuses to auto-execute anything HIGH at this stage.
  // This is the action the original demo proposed first; it is exactly the kind
  // that should be last.
  'db.terminate-session': {
    id: 'db.terminate-session',
    description: 'Terminate a specific database backend session holding a lock',
    riskClass: RISK.HIGH,
    requiredRoles: ['dba-lead'],
    minApprovals: 2,
    reversible: false,
    targetPattern: /^session:\d+$/,
    verify: 'Blocked queries drain and no transaction rollback storm follows',
    note: 'Irreversible: terminating a session rolls back its in-flight transaction. ' +
          'Recommend to a human; never auto-execute.'
  }
};

function getAction(actionId) {
  return Object.prototype.hasOwnProperty.call(ACTIONS, actionId) ? ACTIONS[actionId] : null;
}

/** Is this target well-formed for this action? Prevents an approval for one pool executing against another. */
function targetIsValid(action, target) {
  if (!action || !action.targetPattern) return false;
  return action.targetPattern.test(String(target || ''));
}

module.exports = { ACTIONS, RISK, getAction, targetIsValid };
