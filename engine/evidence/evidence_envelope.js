/**
 * VITALIS BETA-2.2: Canonical Evidence Envelope Contract
 * Universal evidence structure produced by all sensory adapters.
 */

const crypto = require('crypto');

class EvidenceEnvelope {
  static create({
    evidenceId,
    traceId,
    requestId,
    spanId,
    parentSpanId = null,
    component = {},
    event = {},
    measurements = {},
    identity = {},
    provenance = {},
    epistemic = {},
    security = {}
  }) {
    const assignedTraceId = traceId || `UNASSOCIATED-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    if (!component.type || !component.name) throw new Error("EvidenceEnvelope requires component.type and component.name");

    const id = evidenceId || `ev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const timestamp = event.timestamp || new Date().toISOString();

    return {
      evidenceId: id,
      traceId: assignedTraceId,
      requestId: requestId || `req-${assignedTraceId}`,
      spanId: spanId || `span-${id}`,
      parentSpanId,

      component: {
        type: component.type, // e.g. 'F5', 'IHS', 'WEBSPHERE', 'DB2', 'MQ', 'DNS', 'FIREWALL'
        name: component.name,
        environment: component.environment || "production",
        region: component.region || "ap-south-1",
        cluster: component.cluster || "default-cluster"
      },

      event: {
        type: event.type || "EXECUTION", // e.g. 'HTTP_REQUEST', 'SQL_EXECUTION', 'MQ_PUBLISH', 'WAF_INSPECT'
        phase: event.phase || "FORWARD", // 'FORWARD' | 'RETURN'
        timestamp,
        durationMs: event.durationMs !== undefined ? event.durationMs : 0,
        status: event.status || "SUCCESS" // 'SUCCESS' | 'WARNING' | 'FAILED' | 'UNKNOWN'
      },

      measurements: {
        expectedDurationMs: measurements.expectedDurationMs !== undefined ? measurements.expectedDurationMs : 20,
        observedDurationMs: measurements.observedDurationMs !== undefined ? measurements.observedDurationMs : event.durationMs || 0,
        lockWaitMs: measurements.lockWaitMs || 0,
        connectionPoolUtilization: measurements.connectionPoolUtilization || 0,
        cpuUtilizationPct: measurements.cpuUtilizationPct !== undefined ? measurements.cpuUtilizationPct : null,
        socketRttMs: measurements.socketRttMs !== undefined ? measurements.socketRttMs : null,
        tcpRetransmits: measurements.tcpRetransmits !== undefined ? measurements.tcpRetransmits : 0
      },

      identity: {
        sqlFingerprint: identity.sqlFingerprint || null,
        dbPid: identity.dbPid || null,
        correlationId: identity.correlationId || null,
        messageId: identity.messageId || null,
        threadId: identity.threadId || null,
        vip: identity.vip || null,
        clientIp: identity.clientIp || null
      },

      provenance: {
        sourceType: provenance.sourceType || "NATIVE_ADAPTER", // 'OTEL', 'EBPF', 'NATIVE_METRIC', 'LOG_PARSER'
        sourceSystem: provenance.sourceSystem || component.type,
        collectionMethod: provenance.collectionMethod || "OUT_OF_BAND",
        observed: provenance.observed !== undefined ? provenance.observed : true,
        confidence: provenance.confidence !== undefined ? provenance.confidence : 1.0,
        collectionTimestamp: provenance.collectionTimestamp || new Date().toISOString()
      },

      epistemic: {
        classification: epistemic.classification || "OBSERVED", // 'OBSERVED' | 'CORRELATED' | 'INFERRED' | 'RECOMMENDED' | 'VERIFIED'
        claim: epistemic.claim || `${component.name} executed ${event.type}`,
        supportingEvidenceIds: epistemic.supportingEvidenceIds || [],
        falsifiabilityCriteria: epistemic.falsifiabilityCriteria || []
      },

      security: {
        containsPii: security.containsPii || false,
        redactionApplied: security.redactionApplied || true,
        tenantId: security.tenantId || "default-tenant"
      }
    };
  }

  static validate(envelope) {
    const errors = [];
    if (!envelope.evidenceId) errors.push("Missing evidenceId");
    if (!envelope.traceId) errors.push("Missing traceId");
    if (!envelope.component || !envelope.component.type) errors.push("Missing component.type");
    if (!envelope.event || !envelope.event.timestamp) errors.push("Missing event.timestamp");
    if (!envelope.epistemic || !envelope.epistemic.classification) errors.push("Missing epistemic.classification");
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = { EvidenceEnvelope };
