/**
 * VITALIS BETA-2.1: 14-Point Technical Request DNA Versioned Schema
 * Canonical, versioned data contract capturing technical request identity across all enterprise hops.
 */

const SCHEMA_VERSION = "2.1.0";

class RequestDnaSchema {
  static createDefaultEnvelope(traceId) {
    return {
      schemaVersion: SCHEMA_VERSION,
      traceId: traceId || `TX-${Date.now()}`,
      timestamp: new Date().toISOString(),
      
      // 1. Client & Browser
      client: {
        userAgent: null,
        browser: null,
        os: null,
        device: null,
        httpVersion: "HTTP/2",
        streamId: null
      },

      // 2. Network Origin
      network: {
        sourceIp: null,
        sourcePort: null,
        edgeLocation: null,
        asn: null
      },

      // 3. DNS Resolution
      dns: {
        resolverIp: null,
        queryLatencyMs: null,
        ttl: null,
        dnssecValidated: false
      },

      // 4. TLS Handshake
      tls: {
        protocol: "TLSv1.3",
        cipherSuite: null,
        sni: null,
        certFingerprint: null,
        handshakeDurationMs: null
      },

      // 5. Perimeter Security & WAF
      security: {
        wafDecision: "PASS",
        wafRuleId: null,
        rateLimitTier: "STANDARD",
        threatScore: 0
      },

      // 6. Load Balancer (F5 BIG-IP)
      f5: {
        virtualServer: null,
        vip: null,
        poolName: null,
        selectedMember: null,
        persistenceType: "COOKIE",
        activeConnections: null,
        healthStatus: "HEALTHY"
      },

      // 7. Web Server (IBM HTTP Server / Apache)
      ihs: {
        requestId: null,
        pluginRouting: "mod_was_ap22",
        backendWorker: null,
        workerWaitMs: null,
        httpStatus: 200
      },

      // 8. Application Server (WebSphere Core)
      websphere: {
        cellName: null,
        serverName: null,
        threadId: null,
        threadPoolSaturationPct: null,
        jvmHeapUtilizationPct: null,
        jdbcPoolInUse: null,
        jdbcPoolCapacity: null
      },

      // 9. Message Bus (IBM MQ Series)
      mq: {
        queueManager: null,
        queueName: null,
        messageId: null,
        correlationId: null,
        queueDepth: null,
        waitDurationMs: null
      },

      // 10. Database Cluster (IBM DB2)
      db2: {
        sqlFingerprint: null,
        queryPlanCost: null,
        executionDurationMs: null,
        lockWaitMs: 0,
        holdingLockPid: null,
        connectionPoolSaturationPct: null,
        bufferPoolHitRatioPct: null
      },

      // 11. External API / Gateway
      externalGateway: {
        provider: null,
        endpointUri: null,
        idempotencyKey: null,
        egressTlsVersion: "TLSv1.3",
        httpStatus: null,
        latencyMs: null
      },

      // 12. Return Journey & Egress
      returnJourney: {
        compressionType: "gzip",
        responseSizeBytes: null,
        headersPreserved: true,
        finalHttpStatus: 200
      },

      // 13. Temporal Lineage
      temporalLineage: {
        totalDurationMs: 0,
        hopDeltas: [],
        firstMeaningfulDeviationHop: null
      },

      // 14. Epistemic Audit Lineage
      epistemicAudit: {
        ledgerIndex: null,
        cryptographicBlockHash: null,
        overallRti: 98.7
      }
    };
  }

  static validate(envelope) {
    if (!envelope || envelope.schemaVersion !== SCHEMA_VERSION) {
      return { isValid: false, error: `Invalid or unsupported schemaVersion: ${envelope?.schemaVersion}` };
    }
    if (!envelope.traceId) {
      return { isValid: false, error: "Missing required traceId" };
    }
    return { isValid: true };
  }
}

module.exports = { RequestDnaSchema, SCHEMA_VERSION };
