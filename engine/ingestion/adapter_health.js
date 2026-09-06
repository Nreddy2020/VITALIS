/**
 * VITALIS Beta-3.0: Adapter Health & Visibility Engine
 * Distinguishes "System is Healthy" from "VITALIS Cannot Observe System".
 * Tracks collection lag, permissions, coverage, and authoritative status.
 */

const ADAPTER_STATES = {
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  STALE: "STALE",
  DISCONNECTED: "DISCONNECTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNSUPPORTED: "UNSUPPORTED",
  UNKNOWN: "UNKNOWN"
};

class AdapterHealthManager {
  constructor() {
    this.adapters = new Map();
  }

  registerAdapter(name, {
    type = "GENERIC",
    capabilities = { traceId: true, sqlFingerprint: false, lockEvidence: false, metrics: true },
    isAuthoritative = true
  } = {}) {
    this.adapters.set(name, {
      name,
      type,
      status: ADAPTER_STATES.UNKNOWN,
      capabilities,
      isAuthoritative,
      lastSuccessfulCollection: null,
      collectionLagMs: 0,
      totalEventsCollected: 0,
      failures: []
    });
    return this.adapters.get(name);
  }

  recordSuccess(name, { lagMs = 0, eventCount = 1 } = {}) {
    let adapter = this.adapters.get(name);
    if (!adapter) {
      adapter = this.registerAdapter(name);
    }

    adapter.status = ADAPTER_STATES.HEALTHY;
    adapter.lastSuccessfulCollection = new Date().toISOString();
    adapter.collectionLagMs = lagMs;
    adapter.totalEventsCollected += eventCount;
    return adapter;
  }

  recordFailure(name, { type = "COLLECTION_ERROR", message = "Telemetry collection failed", lagMs = 0 } = {}) {
    let adapter = this.adapters.get(name);
    if (!adapter) {
      adapter = this.registerAdapter(name);
    }

    if (type === "PERMISSION_DENIED") {
      adapter.status = ADAPTER_STATES.PERMISSION_DENIED;
    } else if (type === "DISCONNECTED" || type === "SOCKET_TIMEOUT") {
      adapter.status = ADAPTER_STATES.DISCONNECTED;
    } else {
      adapter.status = ADAPTER_STATES.DEGRADED;
    }

    adapter.collectionLagMs = lagMs;
    adapter.failures.push({
      timestamp: new Date().toISOString(),
      type,
      message
    });

    return adapter;
  }

  checkStaleness(maxStalenessMs = 30000) {
    const now = Date.now();
    for (const [name, adapter] of this.adapters.entries()) {
      if (adapter.lastSuccessfulCollection) {
        const elapsed = now - new Date(adapter.lastSuccessfulCollection).getTime();
        if (elapsed > maxStalenessMs && adapter.status === ADAPTER_STATES.HEALTHY) {
          adapter.status = ADAPTER_STATES.STALE;
        }
      }
    }
  }

  getHealthSummary() {
    const summary = {
      totalAdapters: this.adapters.size,
      healthyCount: 0,
      degradedCount: 0,
      blindspots: [],
      adapters: {}
    };

    for (const [name, adapter] of this.adapters.entries()) {
      summary.adapters[name] = { ...adapter };
      if (adapter.status === ADAPTER_STATES.HEALTHY) {
        summary.healthyCount++;
      } else {
        summary.degradedCount++;
        summary.blindspots.push({
          name,
          type: adapter.type,
          status: adapter.status,
          missingVisibility: Object.entries(adapter.capabilities)
            .filter(([_, enabled]) => !enabled)
            .map(([cap]) => cap)
        });
      }
    }

    summary.observabilityCompleteness = summary.totalAdapters > 0
      ? parseFloat((summary.healthyCount / summary.totalAdapters).toFixed(2))
      : 0;

    return summary;
  }
}

module.exports = { AdapterHealthManager, ADAPTER_STATES };
