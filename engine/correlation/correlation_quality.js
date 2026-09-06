/**
 * VITALIS BETA-2.3: Correlation Quality & Evidence Completeness Matrix
 * Decouples Evidence Completeness from Causal Confidence and computes multi-dimensional truth states.
 */

class CorrelationQuality {
  static evaluateTruthStatus({
    envelopes = [],
    expectedHopCount = 10,
    hasConflicts = false,
    isCausallyConsistent = true,
    identityMatchLevel = "LEVEL_1_EXACT",
    causalConfidence = 0.8
  }) {
    const completeness = Math.min(1.0, envelopes.length / Math.max(1, expectedHopCount));
    
    let identityIntegrity = 0.5;
    if (identityMatchLevel === "LEVEL_1_EXACT") identityIntegrity = 1.0;
    else if (identityMatchLevel === "LEVEL_2_PROTOCOL") identityIntegrity = 0.85;
    else if (identityMatchLevel === "LEVEL_3_TOPOLOGY") identityIntegrity = 0.70;

    const temporalIntegrity = isCausallyConsistent ? 0.98 : 0.60;
    const sourceAgreement = hasConflicts ? 0.65 : 0.98;

    // Determine Overall Truth Status
    let overallTruthStatus = "PARTIALLY_SUPPORTED";

    if (completeness < 0.3) {
      overallTruthStatus = "INSUFFICIENT_EVIDENCE";
    } else if (hasConflicts) {
      overallTruthStatus = "CONFLICTED";
    } else if (completeness >= 0.8 && identityIntegrity >= 0.9 && causalConfidence >= 0.8) {
      overallTruthStatus = "VERIFIED";
    } else if (completeness >= 0.5 && causalConfidence >= 0.7) {
      overallTruthStatus = "STRONGLY_SUPPORTED";
    }

    return {
      evidenceCompleteness: parseFloat(completeness.toFixed(2)),
      identityIntegrity: parseFloat(identityIntegrity.toFixed(2)),
      temporalIntegrity: parseFloat(temporalIntegrity.toFixed(2)),
      sourceAgreement: parseFloat(sourceAgreement.toFixed(2)),
      causalConfidence: parseFloat(causalConfidence.toFixed(2)),
      overallTruthStatus
    };
  }
}

module.exports = { CorrelationQuality };
