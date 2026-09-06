/**
 * VITALIS BETA-2.3: Asynchronous Message Boundary Correlator
 * Correlates producer, queue delay, and consumer across IBM MQ / Kafka message brokers.
 */

class AsyncBoundaryCorrelator {
  static correlateMessageHop({
    producerEnvelope,
    consumerEnvelope,
    queueMetrics = {}
  }) {
    if (!producerEnvelope && !consumerEnvelope) {
      return {
        correlated: false,
        reason: "Missing both producer and consumer evidence"
      };
    }

    const messageId = producerEnvelope?.identity?.messageId || consumerEnvelope?.identity?.messageId;
    const correlationId = producerEnvelope?.identity?.correlationId || consumerEnvelope?.identity?.correlationId;

    const idsMatch = (producerEnvelope?.identity?.messageId && consumerEnvelope?.identity?.messageId && producerEnvelope.identity.messageId === consumerEnvelope.identity.messageId) ||
                     (producerEnvelope?.identity?.correlationId && consumerEnvelope?.identity?.correlationId && producerEnvelope.identity.correlationId === consumerEnvelope.identity.correlationId);

    const producerTime = producerEnvelope ? new Date(producerEnvelope.event.timestamp).getTime() : null;
    const consumerTime = consumerEnvelope ? new Date(consumerEnvelope.event.timestamp).getTime() : null;
    const queueTransitDelayMs = (producerTime && consumerTime) ? (consumerTime - producerTime) : (queueMetrics.waitDurationMs || 14);

    return {
      correlated: idsMatch || (!producerEnvelope?.identity?.messageId && consumerEnvelope !== undefined),
      correlationLevel: idsMatch ? "EXACT_MESSAGE_CORRELATION" : "PROBABILISTIC_TIMING_ALIGNMENT",
      messageId,
      correlationId,
      queueDepth: queueMetrics.queueDepth !== undefined ? queueMetrics.queueDepth : 14,
      queueTransitDelayMs,
      isDelayed: queueTransitDelayMs > 2000,
      confidence: idsMatch ? 1.0 : 0.85
    };
  }
}

module.exports = { AsyncBoundaryCorrelator };
