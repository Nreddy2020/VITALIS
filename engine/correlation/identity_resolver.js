/**
 * VITALIS BETA-2.3: Multi-Level Identity Resolver
 * Resolves request correlation across Level 1 (Exact), Level 2 (Protocol), and Level 3 (Topology).
 */

class IdentityResolver {
  static extractIdentityKeys(evidence = {}) {
    const keys = {
      exact: [],
      protocol: [],
      topology: []
    };

    // Level 1: Exact Identity
    if (evidence.traceId) keys.exact.push({ type: "TRACE_ID", value: evidence.traceId });
    if (evidence.requestId) keys.exact.push({ type: "REQUEST_ID", value: evidence.requestId });
    if (evidence.identity?.correlationId) keys.exact.push({ type: "CORRELATION_ID", value: evidence.identity.correlationId });
    if (evidence.identity?.messageId) keys.exact.push({ type: "MESSAGE_ID", value: evidence.identity.messageId });

    // Level 2: Protocol & Idempotency Identity
    if (evidence.identity?.sqlFingerprint) keys.protocol.push({ type: "SQL_FINGERPRINT", value: evidence.identity.sqlFingerprint });
    if (evidence.identity?.idempotencyKey) keys.protocol.push({ type: "IDEMPOTENCY_KEY", value: evidence.identity.idempotencyKey });
    if (evidence.identity?.streamId) keys.protocol.push({ type: "HTTP2_STREAM_ID", value: evidence.identity.streamId });

    // Level 3: Topology & Process Identity
    if (evidence.identity?.threadId) keys.topology.push({ type: "THREAD_ID", value: evidence.identity.threadId });
    if (evidence.identity?.dbPid) keys.topology.push({ type: "DB_PID", value: evidence.identity.dbPid });
    if (evidence.identity?.vip) keys.topology.push({ type: "F5_VIP", value: evidence.identity.vip });
    if (evidence.component?.name) keys.topology.push({ type: "COMPONENT_NAME", value: evidence.component.name });

    return keys;
  }

  static matchIdentity(evidenceA, evidenceB) {
    const keysA = this.extractIdentityKeys(evidenceA);
    const keysB = this.extractIdentityKeys(evidenceB);

    // Check Level 1 Exact Match
    for (const ka of keysA.exact) {
      for (const kb of keysB.exact) {
        if (ka.type === kb.type && ka.value === kb.value) {
          return {
            matched: true,
            level: "LEVEL_1_EXACT",
            matchedKey: ka.type,
            matchedValue: ka.value,
            confidence: 1.0
          };
        }
      }
    }

    // Check Level 2 Protocol Match (e.g. Correlation ID or SQL Fingerprint alignment)
    for (const ka of keysA.protocol) {
      for (const kb of keysB.protocol) {
        if (ka.type === kb.type && ka.value === kb.value) {
          return {
            matched: true,
            level: "LEVEL_2_PROTOCOL",
            matchedKey: ka.type,
            matchedValue: ka.value,
            confidence: 0.92
          };
        }
      }
    }

    // Check Level 3 Topology Match
    for (const ka of keysA.topology) {
      for (const kb of keysB.topology) {
        if (ka.type === kb.type && ka.value === kb.value && ka.type !== "COMPONENT_NAME") {
          return {
            matched: true,
            level: "LEVEL_3_TOPOLOGY",
            matchedKey: ka.type,
            matchedValue: ka.value,
            confidence: 0.82
          };
        }
      }
    }

    return {
      matched: false,
      level: "UNMATCHED",
      confidence: 0.0
    };
  }
}

module.exports = { IdentityResolver };
