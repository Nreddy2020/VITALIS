/**
 * VITALIS: IBM MQ evidence normalizer (shape only — see mq_live_adapter.js for
 * the adapter that actually talks to a queue manager).
 *
 * This file used to fabricate, and one default was worse than the rest: an
 * absent `messageId` was replaced with `MSG-${Date.now()}-${Math.random()...}`
 * and returned as `provenance: "OBSERVED"`. A randomly generated identifier
 * presented as an observed message id is not a harmless placeholder — it is a
 * fake primary key for a message that may never have existed, and it would
 * happily be correlated against, reported on, and cited as evidence.
 * `queueManager` ("QM_PAYMENTS_01"), `queueName`, `queueDepth` (12),
 * `channelStatus` ("RUNNING") and `waitDurationMs` (14) were invented the same way.
 *
 * It now reports only what it was actually given.
 */

function present(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

class MqAdapter {
  static extractEvidence(rawMqTelemetry = {}) {
    const r = rawMqTelemetry || {};
    const queueDepth = r.queueDepth;
    const waitDurationMs = r.waitDurationMs;

    const attributes = present({
      queueManager: r.queueManager,
      queueName: r.queueName,
      // Never invented: an identifier that was not observed is simply absent.
      messageId: r.messageId,
      correlationId: r.correlationId,
      queueDepth,
      channelStatus: r.channelStatus,
      waitDurationMs,
      maxQueueDepth: r.maxQueueDepth,
      openInputCount: r.openInputCount,
      openOutputCount: r.openOutputCount
    });

    let status = 'UNKNOWN';
    if (queueDepth !== undefined) {
      // Prefer a real depth-against-limit ratio when the limit is known, rather
      // than a fixed threshold that means nothing without the queue's capacity.
      status = (r.maxQueueDepth ? (queueDepth / r.maxQueueDepth) > 0.8 : queueDepth > 500)
        ? 'DEGRADED' : 'SUCCESS';
    }
    if (r.channelStatus && r.channelStatus !== 'RUNNING') status = 'FAILED';

    const coreFields = ['queueManager', 'queueName', 'queueDepth'];
    const missing = coreFields.filter(f => r[f] === undefined || r[f] === null);

    return {
      component: 'IBM-MQ-Series',
      status,
      provenance: missing.length === 0 ? 'OBSERVED' : 'PARTIAL',
      unobserved: missing,
      timestamp: new Date().toISOString(),
      durationMs: waitDurationMs,
      attributes
    };
  }
}

module.exports = { MqAdapter };
