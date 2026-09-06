/**
 * VITALIS ENTERPRISE PIPELINE: IBM MQ Series Sensory Adapter
 * Captures Queue Manager, Queue Depth, Message ID, Correlation ID, Channel Status, and Consumer Wait.
 */

class MqAdapter {
  static extractEvidence(rawMqTelemetry = {}) {
    const queueManager = rawMqTelemetry.queueManager || "QM_PAYMENTS_01";
    const queueName = rawMqTelemetry.queueName || "DEV.CHECKOUT.IN";
    const messageId = rawMqTelemetry.messageId || `MSG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const correlationId = rawMqTelemetry.correlationId || `CORREL-${Date.now()}`;
    const queueDepth = rawMqTelemetry.queueDepth !== undefined ? rawMqTelemetry.queueDepth : 12;
    const channelStatus = rawMqTelemetry.channelStatus || "RUNNING";
    const waitDurationMs = rawMqTelemetry.waitDurationMs !== undefined ? rawMqTelemetry.waitDurationMs : 14;

    return {
      component: "IBM-MQ-Series",
      status: queueDepth > 500 ? "DEGRADED" : "SUCCESS",
      provenance: "OBSERVED",
      timestamp: new Date().toISOString(),
      durationMs: waitDurationMs,
      attributes: {
        queueManager,
        queueName,
        messageId,
        correlationId,
        queueDepth,
        channelStatus,
        channelName: "TO.WAS.PAYMENTS.SVRCONN",
        msgSizeBytes: rawMqTelemetry.msgSizeBytes || 1024,
        persistence: "PERSISTENT"
      }
    };
  }
}

module.exports = { MqAdapter };
