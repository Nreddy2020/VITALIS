/**
 * VITALIS Beta-3.0: Ingestion Observability Metrics
 * Tracks collection rates, lag, throughput, and error rates in real-time.
 */

class IngestionMetrics {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
  }

  incrementCounter(name, value = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  recordLag(adapterName, lagMs) {
    if (!this.histograms.has(adapterName)) {
      this.histograms.set(adapterName, []);
    }
    const list = this.histograms.get(adapterName);
    list.push(lagMs);
    if (list.length > 1000) list.shift();
  }

  getMetricsSummary() {
    const summary = {
      counters: Object.fromEntries(this.counters),
      adapterLag: {}
    };

    for (const [adapter, lages] of this.histograms.entries()) {
      if (lages.length === 0) continue;
      const sorted = [...lages].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      summary.adapterLag[adapter] = {
        avgLagMs: parseFloat((sum / sorted.length).toFixed(2)),
        p50LagMs: sorted[Math.floor(sorted.length * 0.50)],
        p95LagMs: sorted[Math.floor(sorted.length * 0.95)],
        maxLagMs: sorted[sorted.length - 1]
      };
    }

    return summary;
  }
}

module.exports = { IngestionMetrics };
