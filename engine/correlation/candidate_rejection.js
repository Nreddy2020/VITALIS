/**
 * VITALIS Beta-3.0: Candidate Rejection Logger
 * Records why potential trace candidates were rejected during correlation
 * to ensure complete auditability and avoid silent correlation mistakes.
 */

class CandidateRejectionTracker {
  constructor() {
    this.rejections = [];
  }

  recordRejection({
    targetTraceId,
    candidateTraceId,
    candidateSpanId = null,
    reason,
    divergentFactor,
    timestamp = new Date().toISOString()
  }) {
    const record = {
      targetTraceId,
      candidateTraceId,
      candidateSpanId,
      reason, // e.g. "TEMPORAL_WINDOW_EXCEEDED", "IP_COLLISION_MISMATCH", "INCOMPATIBLE_PROTOCOL_STREAM"
      divergentFactor,
      timestamp
    };
    this.rejections.push(record);
    return record;
  }

  getRejectionsForTrace(traceId) {
    return this.rejections.filter(r => r.targetTraceId === traceId);
  }
}

module.exports = { CandidateRejectionTracker };
