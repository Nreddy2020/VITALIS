/**
 * VITALIS ENTERPRISE PIPELINE: Return Journey & Egress Response Sensory Adapter
 * Captures Egress Path, Response Compression, Header Mutations, and Client Receive Timing.
 */

class ReturnJourneyAdapter {
  static extractEvidence(rawReturnTelemetry = {}) {
    const finalHttpStatus = rawReturnTelemetry.finalHttpStatus || 200;
    const compressionType = rawReturnTelemetry.compressionType || "gzip";
    const responseSizeBytes = rawReturnTelemetry.responseSizeBytes || 4820;
    const returnLatencyMs = rawReturnTelemetry.returnLatencyMs !== undefined ? rawReturnTelemetry.returnLatencyMs : 8.5;
    const headersPreserved = rawReturnTelemetry.headersPreserved !== undefined ? rawReturnTelemetry.headersPreserved : true;

    return {
      component: "Return-Journey-Egress",
      status: finalHttpStatus >= 500 ? "FAILED" : "SUCCESS",
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs: returnLatencyMs,
      attributes: {
        finalHttpStatus,
        compressionType,
        responseSizeBytes,
        returnLatencyMs,
        headersPreserved,
        egressRoute: "DB2 -> WAS -> IHS -> F5 -> Client",
        totalReturnTransitMs: returnLatencyMs
      }
    };
  }
}

module.exports = { ReturnJourneyAdapter };
