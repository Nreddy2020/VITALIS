/**
 * VITALIS Beta-3.0: Explainable Correlation Rationale Generator
 * Produces structured, human- and machine-readable explanations for how telemetry was correlated.
 */

class CorrelationExplanationEngine {
  static explain({
    traceId,
    matchedBy = [],
    missingEvidence = [],
    rejectedCandidates = [],
    method = "LEVEL_1_EXACT",
    confidence = 0.95
  }) {
    let explanationStatement = "";

    if (method === "LEVEL_1_EXACT") {
      explanationStatement = `All telemetry hops unified via exact distributed trace identifier [${traceId}] with zero ambiguity.`;
    } else if (method === "LEVEL_2_PROTOCOL") {
      explanationStatement = `Telemetry associated using SQL fingerprint, temporal alignment, and database connection identity; direct trace ID was unavailable at downstream boundary.`;
    } else if (method === "LEVEL_3_TOPOLOGY") {
      explanationStatement = `Telemetry correlated via physical host topology and synchronous sequence timing window.`;
    } else {
      explanationStatement = `Correlation achieved with partial evidence; confidence reflects missing component headers.`;
    }

    return {
      traceId,
      correlationStatus: confidence >= 0.8 ? "STRONGLY_SUPPORTED" : "PARTIALLY_SUPPORTED",
      method,
      confidence: parseFloat(confidence.toFixed(2)),
      matchedBy,
      missing: missingEvidence,
      rejectedCandidates,
      explanationStatement
    };
  }
}

module.exports = { CorrelationExplanationEngine };
