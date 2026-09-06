/**
 * Scenario 01: Database Lock Contention & Pool Saturation
 */
module.exports = {
  name: "Database Lock Contention",
  category: "DATABASE",
  run: (engine) => {
    const traceId = "SCEN-01-DB-LOCK";
    const spans = [
      { service: "Client", durationMs: 8 },
      { service: "WAF", durationMs: 12 },
      { service: "F5-LB", durationMs: 10 },
      { service: "AuthService", durationMs: 24 },
      { service: "WebSphere", durationMs: 45 },
      { service: "Postgres", durationMs: 2814, status: "CRITICAL" },
      { service: "Stripe", durationMs: 0, status: "UNREACHED" }
    ];

    engine.ingestOtelSpans([{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "Postgres" } }] },
      scopeSpans: [{ spans: [{ traceId, spanId: "sp-db", name: "DB-Query", durationMs: 2814 }] }]
    }]);

    const evalResult = engine.evaluateTrace(traceId);
    const candidate = evalResult.candidates[0] || {};

    return {
      name: "Database Lock Contention",
      detection: evalResult.diff.diffCount > 0 ? "PASS" : "FAIL",
      rca: (candidate.confidence >= 90.0) ? "PASS" : "FAIL",
      impact: candidate.blastRadius ? "PASS" : "FAIL",
      recovery: candidate.recommendedAction ? "PASS" : "FAIL",
      confidence: candidate.confidence || 0
    };
  }
};
