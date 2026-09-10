/**
 * VITALIS STAGE 4+: Approver enrolment and pluggable signature verification
 *
 * Closes the last gap left open by Stage 4: approver keys had to be registered
 * in-process, by hand, every time — which is fine for a test and useless for an
 * organisation. This adds the two things that were missing:
 *
 *  1. A PERSISTENT enrolment registry. Who may approve what survives a restart,
 *     is auditable, and records who enrolled each approver and when. Revocation
 *     is explicit and retained (a revoked approver is kept with a reason, never
 *     quietly deleted, so the audit trail stays complete).
 *
 *  2. A PLUGGABLE verifier. VITALIS verifies signatures through a small
 *     interface, so the local Ed25519 verifier used today can be swapped for an
 *     HSM, a smart card, or an SSO/OIDC-backed signing service without touching
 *     the remediation logic. Only the verifier changes; every governance rule
 *     around it stays exactly where it is.
 *
 * What this deliberately does NOT do: hold private keys. Enrolment records
 * PUBLIC keys only. `generateEnrolmentRequest()` exists so an approver can mint
 * a keypair on their own machine and hand over only the public half — the
 * private key never travels to VITALIS, and there is no code path here that
 * would accept one.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApprovalAuthority } = require('./approval_authority');

/**
 * The verifier interface. Any implementation must expose:
 *   verifySignature(publicKeyRef, payloadBytes, signatureBase64) -> boolean
 *
 * LocalEd25519Verifier is the reference implementation and the one proven by
 * the Stage 4 gates. An HSM/PKCS#11 or cloud-KMS implementation replaces only
 * this class.
 */
class LocalEd25519Verifier {
  constructor() { this.name = 'local-ed25519'; }

  verifySignature(publicKeyPem, payloadBytes, signatureBase64) {
    try {
      return crypto.verify(
        null, payloadBytes,
        crypto.createPublicKey(publicKeyPem),
        Buffer.from(String(signatureBase64), 'base64')
      );
    } catch (err) {
      return false;
    }
  }
}

/**
 * Example shape for an external signing service (HSM, KMS, SSO-backed signer).
 * Intentionally not wired to anything: it documents the contract so an
 * organisation can implement it against their own infrastructure. It refuses
 * rather than silently returning false, so a half-configured integration fails
 * loudly instead of rejecting every legitimate approval.
 */
class ExternalVerifier {
  constructor({ name, verifyFn }) {
    if (typeof verifyFn !== 'function') {
      throw new Error('ExternalVerifier requires a verifyFn(publicKeyRef, payloadBytes, signatureBase64) -> boolean');
    }
    this.name = name || 'external';
    this.verifyFn = verifyFn;
  }
  verifySignature(publicKeyRef, payloadBytes, signatureBase64) {
    return this.verifyFn(publicKeyRef, payloadBytes, signatureBase64);
  }
}

class ApproverRegistry {
  /**
   * @param opts.storePath  where enrolments persist (JSON)
   * @param opts.verifier   signature verifier; defaults to local Ed25519
   */
  constructor({ storePath, verifier } = {}) {
    this.storePath = storePath || path.join(process.env.VITALIS_DATA_DIR || path.join(__dirname, '..', 'data'), 'approvers.json');
    this.verifier = verifier || new LocalEd25519Verifier();
    this.approvers = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8') || '{}');
        for (const rec of raw.approvers || []) {
          if (rec && rec.approverId) this.approvers.set(rec.approverId, rec);
        }
      }
    } catch (err) {
      console.warn('[VITALIS ENROLMENT] Could not read approver registry:', err.message);
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({ approvers: [...this.approvers.values()] }, null, 2), 'utf8');
    } catch (err) {
      console.warn('[VITALIS ENROLMENT] Could not persist approver registry:', err.message);
    }
  }

  /**
   * Run on the APPROVER's own machine. Returns a keypair plus the enrolment
   * request to hand to whoever administers VITALIS. Only the request should
   * ever leave the approver's machine.
   */
  static generateEnrolmentRequest(approverId, roles = []) {
    const { publicKeyPem, privateKeyPem } = ApprovalAuthority.generateKeyPair();
    return {
      privateKeyPem,                       // stays with the approver — never sent
      request: {
        approverId,
        roles,
        publicKeyPem,
        fingerprint: ApproverRegistry.fingerprint(publicKeyPem),
        requestedAt: new Date().toISOString()
      }
    };
  }

  /** A short, comparable fingerprint so a key can be verified out-of-band before enrolment. */
  static fingerprint(publicKeyPem) {
    return crypto.createHash('sha256').update(String(publicKeyPem)).digest('hex').slice(0, 32);
  }

  /**
   * Enrol an approver. `enrolledBy` is required: an enrolment nobody is
   * accountable for is not an enrolment, and this registry decides who can
   * authorise production changes.
   */
  enrol({ approverId, publicKeyPem, roles = [], enrolledBy }) {
    if (!approverId) throw new Error('approverId is required');
    if (!publicKeyPem) throw new Error('publicKeyPem is required');
    if (!enrolledBy) throw new Error('enrolledBy is required — every enrolment must be attributable');
    if (/PRIVATE KEY/.test(String(publicKeyPem))) {
      throw new Error('Refusing to enrol: that looks like a PRIVATE key. Enrol the public half only.');
    }
    try {
      crypto.createPublicKey(publicKeyPem);
    } catch (err) {
      throw new Error(`Refusing to enrol: public key is not parseable (${err.message})`);
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new Error('At least one role is required — an approver with no roles can approve nothing');
    }

    const existing = this.approvers.get(approverId);
    const record = {
      approverId,
      publicKeyPem,
      fingerprint: ApproverRegistry.fingerprint(publicKeyPem),
      roles: [...new Set(roles)],
      enrolledBy,
      enrolledAt: new Date().toISOString(),
      revoked: false,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      previousFingerprints: existing
        ? [...(existing.previousFingerprints || []), existing.fingerprint]
        : []
    };
    this.approvers.set(approverId, record);
    this._save();
    return { ...record, publicKeyPem: '[stored]' };
  }

  /**
   * Revoke an approver. The record is RETAINED with the reason — deleting it
   * would erase the fact that this identity was once able to approve changes,
   * which is exactly what an audit needs to see.
   */
  revoke(approverId, { revokedBy, reason } = {}) {
    const rec = this.approvers.get(approverId);
    if (!rec) return { revoked: false, reason: `No approver ${approverId} is enrolled` };
    if (!revokedBy) throw new Error('revokedBy is required — every revocation must be attributable');
    rec.revoked = true;
    rec.revokedAt = new Date().toISOString();
    rec.revokedBy = revokedBy;
    rec.revocationReason = reason || 'not stated';
    this._save();
    return { revoked: true, approverId, revokedBy, reason: rec.revocationReason };
  }

  list() {
    return [...this.approvers.values()].map(r => ({
      approverId: r.approverId,
      roles: r.roles,
      fingerprint: r.fingerprint,
      enrolledBy: r.enrolledBy,
      enrolledAt: r.enrolledAt,
      revoked: r.revoked,
      revokedAt: r.revokedAt,
      revokedBy: r.revokedBy,
      revocationReason: r.revocationReason
    }));
  }

  /**
   * Build an ApprovalAuthority from the CURRENT registry. Revoked approvers are
   * simply not registered, so their signatures fail as "unknown approver" —
   * fail-closed, with no separate revocation check to forget.
   */
  buildAuthority(opts = {}) {
    const authority = new ApprovalAuthority(opts);
    // Route signature checking through the pluggable verifier so an HSM or SSO
    // signer can be substituted without changing any governance rule.
    const verifier = this.verifier;
    if (verifier && verifier.name !== 'local-ed25519') {
      authority._externalVerify = (publicKeyRef, bytes, sig) => verifier.verifySignature(publicKeyRef, bytes, sig);
    }
    for (const rec of this.approvers.values()) {
      if (rec.revoked) continue;
      authority.registerApprover(rec.approverId, rec.publicKeyPem, rec.roles);
    }
    return authority;
  }
}

module.exports = { ApproverRegistry, LocalEd25519Verifier, ExternalVerifier };

// CLI:
//   node engine/approver_enrolment.js request <approverId> <role[,role]>
//   node engine/approver_enrolment.js enrol   <approverId> <publicKeyFile> <role[,role]> <enrolledBy>
//   node engine/approver_enrolment.js revoke  <approverId> <revokedBy> [reason]
//   node engine/approver_enrolment.js list
if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const registry = new ApproverRegistry();
  try {
    if (cmd === 'request') {
      const [approverId, roleCsv] = args;
      if (!approverId) throw new Error('usage: request <approverId> <role[,role]>');
      const { privateKeyPem, request } = ApproverRegistry.generateEnrolmentRequest(
        approverId, (roleCsv || '').split(',').filter(Boolean));
      const keyFile = `${approverId.replace(/[^\w.@-]/g, '_')}.private.pem`;
      const reqFile = `${approverId.replace(/[^\w.@-]/g, '_')}.enrolment.json`;
      fs.writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
      fs.writeFileSync(reqFile, JSON.stringify(request, null, 2));
      console.log(`Private key written to ${keyFile} — KEEP THIS. Do not send it to anyone, including VITALIS.`);
      console.log(`Enrolment request written to ${reqFile} — this is the file to hand over.`);
      console.log(`Verify this fingerprint out-of-band before it is enrolled: ${request.fingerprint}`);
    } else if (cmd === 'enrol') {
      const [approverId, pubFile, roleCsv, enrolledBy] = args;
      if (!approverId || !pubFile || !roleCsv || !enrolledBy) {
        throw new Error('usage: enrol <approverId> <publicKeyFile> <role[,role]> <enrolledBy>');
      }
      const rec = registry.enrol({
        approverId,
        publicKeyPem: fs.readFileSync(pubFile, 'utf8'),
        roles: roleCsv.split(',').filter(Boolean),
        enrolledBy
      });
      console.log(`Enrolled ${rec.approverId} [${rec.roles.join(', ')}] fingerprint ${rec.fingerprint} by ${rec.enrolledBy}`);
    } else if (cmd === 'revoke') {
      const [approverId, revokedBy, ...reason] = args;
      console.log(JSON.stringify(registry.revoke(approverId, { revokedBy, reason: reason.join(' ') }), null, 2));
    } else if (cmd === 'list') {
      console.table(registry.list());
    } else {
      console.log('Commands: request | enrol | revoke | list  (see file header for usage)');
    }
  } catch (err) {
    console.error('[enrolment]', err.message);
    process.exit(1);
  }
}
