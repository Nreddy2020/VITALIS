/**
 * VITALIS BETA-2.2: Epistemic Claim Model
 * Distinguishes Measurements, Relationships, Inferences, Recommendations, and Verified Outcomes.
 */

const crypto = require('crypto');

class ClaimModel {
  static create({
    claimId,
    traceId,
    type = "ROOT_CAUSE_CANDIDATE", // 'ROOT_CAUSE_CANDIDATE' | 'DEVIATION_OBSERVATION' | 'BUSINESS_IMPACT' | 'REMEDIATION_ACTION' | 'RECOVERY_VERIFICATION'
    statement,
    classification = "INFERRED", // 'OBSERVED' | 'CORRELATED' | 'INFERRED' | 'RECOMMENDED' | 'VERIFIED' | 'UNKNOWN'
    confidence = 1.0,
    supportingEvidence = [],
    contradictingEvidence = [],
    falsifiability = [],
    status = "OPEN" // 'OPEN' | 'VERIFIED' | 'FALSIFIED' | 'INSUFFICIENT_EVIDENCE'
  }) {
    if (!traceId) throw new Error("ClaimModel requires a valid traceId");
    if (!statement) throw new Error("ClaimModel requires a statement");

    const id = claimId || `claim-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    return {
      claimId: id,
      traceId,
      timestamp: new Date().toISOString(),
      type,
      statement,
      classification,
      confidence: parseFloat(confidence.toFixed(3)),
      supportingEvidence: Array.isArray(supportingEvidence) ? supportingEvidence : [supportingEvidence],
      contradictingEvidence: Array.isArray(contradictingEvidence) ? contradictingEvidence : [contradictingEvidence],
      falsifiability: Array.isArray(falsifiability) ? falsifiability : [falsifiability],
      status
    };
  }

  static createUnknown({ traceId, statement, reason, missingEvidence = [] }) {
    return this.create({
      traceId,
      type: "ROOT_CAUSE_CANDIDATE",
      statement: statement || "Root cause is UNKNOWN due to insufficient telemetry",
      classification: "UNKNOWN",
      confidence: 0.0,
      supportingEvidence: [],
      contradictingEvidence: [],
      falsifiability: [
        `Collect missing telemetry: ${missingEvidence.join(', ')}`,
        "Re-evaluate trace when full context is present"
      ],
      status: "INSUFFICIENT_EVIDENCE"
    });
  }
}

module.exports = { ClaimModel };
