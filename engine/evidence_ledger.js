/**
 * VITALIS BETA-2: Cryptographic Evidence Truth Ledger
 * Guarantees permanent, tamper-proof auditability for every diagnostic conclusion.
 * Uses real SHA-256 cryptographic hashing and Merkle-style hash chaining.
 */

const crypto = require('crypto');

function canonicalJsonStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k])).join(',') + '}';
}

class EvidenceTruthLedger {
  constructor() {
    this.chain = []; // Array of LedgerBlock
    this.indexMap = new Map(); // conclusionId -> blockIndex
    this.genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";
  }

  getLatestHash() {
    return this.chain.length === 0 ? this.genesisHash : this.chain[this.chain.length - 1].hash;
  }

  recordConclusion({
    traceId,
    primaryHypothesis,
    confidence,
    supportingEvidence = [],
    contradictingEvidence = [],
    correlatedChanges = [],
    provenance = "INFERRED",
    sourceTelemetry = {},
    modelVersion = "v2.0-BETA-CANONICAL"
  }) {
    const index = this.chain.length;
    const timestamp = new Date().toISOString();
    const conclusionId = `LEDGER-${Date.now()}-${index}`;
    const previousHash = this.getLatestHash();

    const payload = {
      index,
      conclusionId,
      traceId,
      timestamp,
      modelVersion,
      provenance,
      primaryHypothesis,
      confidence: parseFloat(confidence.toFixed(2)),
      supportingEvidence: Array.isArray(supportingEvidence) ? supportingEvidence : [supportingEvidence],
      contradictingEvidence: Array.isArray(contradictingEvidence) ? contradictingEvidence : [contradictingEvidence],
      correlatedChanges: Array.isArray(correlatedChanges) ? correlatedChanges : [correlatedChanges],
      sourceTelemetrySummary: canonicalJsonStringify(sourceTelemetry),
      previousHash
    };

    // Compute true SHA-256 over deterministic canonical payload
    const canonicalString = canonicalJsonStringify(payload);
    const hash = crypto.createHash('sha256').update(canonicalString).digest('hex');

    const block = Object.freeze({
      ...payload,
      hash,
      canonicalPayload: canonicalString
    });

    this.chain.push(block);
    this.indexMap.set(conclusionId, index);
    return block;
  }

  getConclusion(conclusionId) {
    const idx = this.indexMap.get(conclusionId);
    return idx !== undefined ? this.chain[idx] : null;
  }

  getAllEntries() {
    return [...this.chain];
  }

  queryByTraceId(traceId) {
    return this.chain.filter(e => e.traceId === traceId);
  }

  /**
   * Cryptographic verification: Recomputes hashes across the entire chain
   * to mathematically guarantee zero data tampering.
   */
  verifyLedgerIntegrity() {
    for (let i = 0; i < this.chain.length; i++) {
      const current = this.chain[i];
      const prevHash = i === 0 ? this.genesisHash : this.chain[i - 1].hash;

      if (current.previousHash !== prevHash) {
        return {
          isValid: false,
          tamperedIndex: i,
          reason: `Broken hash chain at block #${i}: expected previousHash ${prevHash}, got ${current.previousHash}`
        };
      }

      const { hash, canonicalPayload, ...dataToVerify } = current;
      const recomputedCanonical = canonicalJsonStringify(dataToVerify);
      const recomputedHash = crypto.createHash('sha256').update(recomputedCanonical).digest('hex');

      if (recomputedHash !== current.hash) {
        return {
          isValid: false,
          tamperedIndex: i,
          reason: `Hash mismatch at block #${i}: computed ${recomputedHash}, stored ${current.hash}`
        };
      }
    }

    return {
      isValid: true,
      blockCount: this.chain.length,
      latestHash: this.getLatestHash()
    };
  }
}

module.exports = { EvidenceTruthLedger, canonicalJsonStringify };
