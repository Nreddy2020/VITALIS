/**
 * VITALIS Beta-3.0: Enterprise Telemetry Source Registry
 * Catalogs authoritative sources across Network, Load Balancer, Web Server, App Server, DB, and MQ.
 */

class SourceRegistry {
  constructor() {
    this.sources = new Map();
  }

  registerSource({
    sourceId,
    name,
    tier, // "EDGE", "NETWORK", "DMZ", "WEB", "APP", "DATABASE", "MESSAGING", "EXTERNAL"
    protocol, // "OTLP_HTTP", "OTLP_GRPC", "SYSLOG", "JMX_POLL", "EBPF_STREAM", "DB2_SNAPSHOT"
    expectedLatencyBudgetMs = 20,
    isAuthoritative = true,
    samplingRate = 1.0
  }) {
    this.sources.set(sourceId, {
      sourceId,
      name,
      tier,
      protocol,
      expectedLatencyBudgetMs,
      isAuthoritative,
      samplingRate,
      registeredAt: new Date().toISOString()
    });
    return this.sources.get(sourceId);
  }

  getSource(sourceId) {
    return this.sources.get(sourceId);
  }

  getAllSources() {
    return Array.from(this.sources.values());
  }

  getSourcesByTier(tier) {
    return this.getAllSources().filter(s => s.tier === tier);
  }
}

module.exports = { SourceRegistry };
