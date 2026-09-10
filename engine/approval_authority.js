/**
 * VITALIS STAGE 4: Approval Authority — real cryptographic approval
 *
 * Replaces the Stage 0-flagged fake: the previous remediation state machine
 * generated `signature: sig-${Math.random()...}` and its approve() method took
 * `operatorId = "sre-lead@bank.corp"` as a DEFAULT, so any caller could approve
 * anything as the SRE lead, and the transition text still claimed "cryptographic
 * human approval". Nothing was signed, nothing was verified.
 *
 * This module does the real thing with Node's own crypto:
 *
 *  - The approver signs a canonical payload with a real Ed25519 private key that
 *    VITALIS never holds. VITALIS verifies with the registered public key.
 *  - The signed payload BINDS the approval to one specific action, target,
 *    incident and change ticket. Re-using a signature for a different action or
 *    a different target fails verification, because those fields are signed.
 *  - Every approval carries a nonce and an expiry. A replayed nonce is refused
 *    and an expired approval is refused, so a captured approval cannot be used
 *    twice or banked for later.
 *  - RBAC: the approver must actually hold a role the action requires.
 *
 * The signing side (sign()) exists so operators and tests can produce real
 * signatures. In production the private key lives in the approver's HSM, smart
 * card, or SSO-backed signing service — never in this process.
 */

const crypto = require('crypto');

/** Fields are ordered and delimited so the signed bytes are unambiguous. */
function canonicalApprovalBytes(a) {
  return Buffer.from([
    'VITALIS-APPROVAL-v1',
    a.incidentId,
    a.actionId,
    a.target,
    a.ticketId,
    a.approverId,
    a.nonce,
    String(a.expiresAt)
  ].join('\x1f'), 'utf8');
}

class ApprovalAuthority {
  constructor({ clock = () => Date.now() } = {}) {
    /** approverId -> { publicKey, roles:Set } */
    this.approvers = new Map();
    /** nonces already spent — replay protection */
    this.usedNonces = new Set();
    this.clock = clock;
  }

  /**
   * Register a real approver identity and their real public key.
   * @param publicKeyPem  PEM-encoded Ed25519 public key
   * @param roles         roles this human actually holds
   */
  registerApprover(approverId, publicKeyPem, roles = []) {
    if (!approverId || !publicKeyPem) throw new Error('approverId and publicKeyPem are required');
    this.approvers.set(approverId, {
      publicKey: crypto.createPublicKey(publicKeyPem),
      publicKeyPem,                 // kept so a pluggable external verifier gets the raw reference
      roles: new Set(roles)
    });
    return { approverId, roles: [...roles] };
  }

  /** Produce a real signature. Used by the approver's own tooling and by tests. */
  static sign(privateKeyPem, approval) {
    const key = crypto.createPrivateKey(privateKeyPem);
    return crypto.sign(null, canonicalApprovalBytes(approval), key).toString('base64');
  }

  /** Generate a real Ed25519 keypair (operator enrolment / test setup). */
  static generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
  }

  /**
   * Verify a real approval. Returns { valid, reason } and NEVER throws on a bad
   * approval — a rejection is an expected outcome, not an exception.
   *
   * @param approval  { incidentId, actionId, target, ticketId, approverId, nonce, expiresAt, signature }
   * @param action    the action definition from the allowlist (for RBAC)
   * @param expected  { incidentId, actionId, target } the request actually being approved
   */
  verify(approval, action, expected) {
    const required = ['incidentId', 'actionId', 'target', 'ticketId', 'approverId', 'nonce', 'expiresAt', 'signature'];
    for (const f of required) {
      if (approval == null || approval[f] === undefined || approval[f] === null || approval[f] === '') {
        return { valid: false, reason: `Approval is missing required field: ${f}` };
      }
    }

    // A change ticket is mandatory and must look like one — an approval with no
    // traceable change record is not an approval anyone can be accountable for.
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(String(approval.ticketId))) {
      return { valid: false, reason: `Change ticket "${approval.ticketId}" is not a valid ticket reference` };
    }

    const approver = this.approvers.get(approval.approverId);
    if (!approver) return { valid: false, reason: `Unknown approver: ${approval.approverId}` };

    // The approval must be for THIS action on THIS target for THIS incident.
    if (approval.incidentId !== expected.incidentId) {
      return { valid: false, reason: `Approval is bound to incident ${approval.incidentId}, not ${expected.incidentId}` };
    }
    if (approval.actionId !== expected.actionId) {
      return { valid: false, reason: `Approval is bound to action ${approval.actionId}, not ${expected.actionId}` };
    }
    if (approval.target !== expected.target) {
      return { valid: false, reason: `Approval is bound to target "${approval.target}", not "${expected.target}"` };
    }

    const now = this.clock();
    if (Number(approval.expiresAt) <= now) {
      return { valid: false, reason: `Approval expired at ${new Date(Number(approval.expiresAt)).toISOString()}` };
    }

    const nonceKey = `${approval.approverId}:${approval.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      return { valid: false, reason: `Approval nonce ${approval.nonce} has already been used (replay refused)` };
    }

    // RBAC — the human must hold a role this action actually requires.
    const requiredRoles = (action && action.requiredRoles) || [];
    const held = [...approver.roles];
    if (requiredRoles.length && !requiredRoles.some(r => approver.roles.has(r))) {
      return {
        valid: false,
        reason: `Approver ${approval.approverId} holds [${held.join(', ') || 'no roles'}] but action ` +
                `${approval.actionId} requires one of [${requiredRoles.join(', ')}]`
      };
    }

    // The real cryptographic check, last: everything above is cheap and the
    // failure reasons are more useful, but none of them can be trusted without this.
    let signatureOk = false;
    try {
      if (typeof this._externalVerify === 'function') {
        // Pluggable path: an HSM, smart card, or SSO-backed signing service
        // supplied via engine/approver_enrolment.js. Every governance rule above
        // still applies — only the cryptographic check is delegated.
        signatureOk = this._externalVerify(
          approver.publicKeyPem || approver.publicKey,
          canonicalApprovalBytes(approval),
          approval.signature
        ) === true;
      } else {
        signatureOk = crypto.verify(
          null,
          canonicalApprovalBytes(approval),
          approver.publicKey,
          Buffer.from(String(approval.signature), 'base64')
        );
      }
    } catch (err) {
      return { valid: false, reason: `Signature could not be verified: ${err.message}` };
    }
    if (!signatureOk) {
      return { valid: false, reason: 'Cryptographic signature is invalid for this approver and payload' };
    }

    // Spend the nonce only once the approval is fully accepted.
    this.usedNonces.add(nonceKey);
    return {
      valid: true,
      approverId: approval.approverId,
      ticketId: approval.ticketId,
      rolesHeld: held,
      verifiedAt: now
    };
  }
}

module.exports = { ApprovalAuthority, canonicalApprovalBytes };
