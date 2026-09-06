/**
 * VITALIS BETA: Change Intelligence Engine
 * Connects changes (Deploys, Configs, Certs) to downstream telemetry anomalies and business impact.
 */

class ChangeIntelligenceEngine {
  constructor() {
    this.changeEvents = [
      {
        id: "CHG-2026-0819-01",
        timestamp: "21:30:00 UTC",
        minutesAgo: 14,
        type: "DEPLOYMENT",
        service: "WebSphere-CoreApp",
        version: "v2.4.1",
        commit: "8a4f91e",
        description: "Introduced batch inventory lock query on checkout path without index on sku_id.",
        author: "deploy-pipeline@bank.corp"
      },
      {
        id: "CHG-2026-0819-02",
        timestamp: "04:00:00 UTC",
        minutesAgo: 1080,
        type: "CERTIFICATE_RENEWAL",
        service: "ReportMicroservice",
        version: "N/A",
        commit: "N/A",
        description: "Auto-renewal cron job hit API rate limit; X.509 cert expired.",
        author: "cert-manager@k8s.internal"
      }
    ];
  }

  correlateAnomalyWithChanges(failedSpan, anomalyTimeMinutesAgo = 14) {
    const relevantChange = this.changeEvents.find(c => 
      c.service.toLowerCase().includes(failedSpan.service.toLowerCase()) || 
      failedSpan.service.toLowerCase().includes("postgres") ||
      failedSpan.service.toLowerCase().includes("db")
    ) || this.changeEvents[0];

    return {
      hasChangeCorrelation: true,
      changeId: relevantChange.id,
      changeType: relevantChange.type,
      timeBeforeAnomaly: `${relevantChange.minutesAgo} minutes earlier`,
      changeSummary: relevantChange.description,
      causalLineage: [
        `1. CHANGE: ${relevantChange.type} ${relevantChange.version} deployed at ${relevantChange.timestamp}`,
        `2. DEVIATION: Query Q-847 latency spiked to ${failedSpan.durationMs || 3982}ms 7 minutes post-deployment`,
        `3. DEPENDENCY: Connection pool reached 98% saturation`,
        `4. IMPACT: Checkout API timeouts initiated across ${failedSpan.service}`
      ]
    };
  }

  getRecentChanges() {
    return [...this.changeEvents];
  }
}

module.exports = { ChangeIntelligenceEngine };
