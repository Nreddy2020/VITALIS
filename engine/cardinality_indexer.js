/**
 * VITALIS: Cardinality & Index Stratification Engine (Gate 7)
 * Categorizes telemetry attributes into 7 tiers:
 * 1. IDENTITY
 * 2. SERVICE
 * 3. RESOURCE
 * 4. REQUEST
 * 5. BUSINESS
 * 6. HIGH_CARDINALITY (Filtered out of primary inverted indexes)
 * 7. SENSITIVE (Subject to Privacy Policy)
 */

const ATTRIBUTE_TIERS = {
  IDENTITY: ['trace_id', 'span_id', 'parent_span_id'],
  SERVICE: ['service.name', 'service.version', 'service.namespace'],
  RESOURCE: ['host.name', 'k8s.pod.name', 'k8s.node.name', 'container.id'],
  REQUEST: ['http.method', 'http.status_code', 'http.route', 'rpc.method'],
  BUSINESS: ['business.journey', 'transaction.type', 'tenant.tier'],
  HIGH_CARDINALITY: ['customer.id', 'user.session_id', 'order.uuid', 'random.nonce', 'raw.query_params'],
  SENSITIVE: ['auth.token', 'user.password', 'card.pan', 'user.ssn']
};

class CardinalityIndexer {
  static classifyAttribute(key) {
    for (const [tier, keys] of Object.entries(ATTRIBUTE_TIERS)) {
      if (keys.includes(key) || keys.some(k => key.toLowerCase().includes(k))) {
        return tier;
      }
    }
    return 'UNCLASSIFIED';
  }

  static applyIndexPolicy(attributes) {
    const primaryIndex = {};
    const unindexedStorage = {};
    const droppedOrMasked = {};

    for (const [key, value] of Object.entries(attributes)) {
      const tier = this.classifyAttribute(key);

      if (tier === 'SENSITIVE') {
        droppedOrMasked[key] = '[MASKED_SENSITIVE]';
      } else if (tier === 'HIGH_CARDINALITY') {
        // Safe storage in columnar/blob without exploding primary inverted index memory
        unindexedStorage[key] = value;
      } else {
        // Safe for primary inverted memory indexing
        primaryIndex[key] = value;
      }
    }

    return {
      primaryIndexKeys: Object.keys(primaryIndex),
      unindexedKeys: Object.keys(unindexedStorage),
      maskedKeys: Object.keys(droppedOrMasked),
      isPrimaryIndexProtected: Object.keys(primaryIndex).every(k => this.classifyAttribute(k) !== 'HIGH_CARDINALITY')
    };
  }
}

module.exports = { CardinalityIndexer, ATTRIBUTE_TIERS };
