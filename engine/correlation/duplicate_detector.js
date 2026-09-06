/**
 * VITALIS BETA-2.3: Duplicate Event & Retry Detector
 * Detects duplicate events from retries, dual-reporting proxies, and retransmitted spans.
 */

class DuplicateDetector {
  static deduplicateEnvelopes(envelopes = []) {
    const seenSignatures = new Map();
    const uniqueEnvelopes = [];
    const duplicates = [];

    for (const env of envelopes) {
      // Signature based on Component + Event Type + SpanId or Timestamp
      const signature = `${env.component.type}-${env.event.type}-${env.spanId || ''}-${env.event.durationMs}`;

      if (seenSignatures.has(signature)) {
        duplicates.push({
          duplicateOf: seenSignatures.get(signature),
          droppedEnvelope: env,
          reason: "DUPLICATE_EVENT_SIGNATURE"
        });
      } else {
        seenSignatures.set(signature, env.evidenceId);
        uniqueEnvelopes.push(env);
      }
    }

    return {
      uniqueEnvelopes,
      duplicateCount: duplicates.length,
      duplicates
    };
  }
}

module.exports = { DuplicateDetector };
