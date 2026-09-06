/**
 * VITALIS Beta-3.0: High-Throughput Ingestion Gateway
 * Central out-of-band entrypoint for all enterprise adapters.
 */

const { AdapterHealthManager, ADAPTER_STATES } = require('./adapter_health');
const { SourceRegistry } = require('./source_registry');
const { BackpressureController } = require('./backpressure_controller');
const { IngestionMetrics } = require('./ingestion_metrics');
const { EvidenceEnvelope } = require('../evidence/evidence_envelope');

class IngestionGateway {
  constructor(options = {}) {
    this.healthManager = options.healthManager || new AdapterHealthManager();
    this.registry = options.registry || new SourceRegistry();
    this.buffer = options.buffer || new BackpressureController(options.capacity || 50000);
    this.metrics = options.metrics || new IngestionMetrics();
  }

  /**
   * Ingests raw telemetry envelope safely into the non-blocking ring buffer.
   */
  ingest(envelopeData) {
    try {
      const envelope = envelopeData instanceof EvidenceEnvelope
        ? envelopeData
        : EvidenceEnvelope.create(envelopeData);

      const componentName = envelope.component?.name || "UNKNOWN_SOURCE";
      const lagMs = envelope.event?.timestamp
        ? Math.max(0, Date.now() - new Date(envelope.event.timestamp).getTime())
        : 0;

      // 1. Update Adapter Health & Metrics
      this.healthManager.recordSuccess(componentName, { lagMs, eventCount: 1 });
      this.metrics.incrementCounter("ingested_events_total");
      this.metrics.recordLag(componentName, lagMs);

      // 2. Buffer into Ring Buffer
      const result = this.buffer.push(envelope);
      return {
        accepted: true,
        envelopeId: envelope.evidenceId,
        buffered: result.buffered
      };
    } catch (err) {
      this.metrics.incrementCounter("ingestion_errors_total");
      return {
        accepted: false,
        error: err.message
      };
    }
  }

  /**
   * Drains buffered telemetry batches for correlation processing
   */
  drainBatch(batchSize = 1000) {
    const rawBatch = this.buffer.drain(batchSize);
    return rawBatch.map(item => item.data);
  }

  getStatus() {
    return {
      health: this.healthManager.getHealthSummary(),
      bufferMetrics: this.buffer.getMetrics(),
      ingestionMetrics: this.metrics.getMetricsSummary()
    };
  }
}

module.exports = { IngestionGateway };
