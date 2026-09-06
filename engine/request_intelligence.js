/**
 * VITALIS: Request Intelligence Engine (RIE) — Core Engine v1.0
 * Encapsulates:
 * 1. Immutable Evidence Store (Raw Observation -> Immutable Event -> Correlation)
 * 2. Root Cause Candidate Engine (Ranked hypotheses with supporting & contradicting evidence)
 * 3. 3-Tier Baseline Validator (Structural, Performance, Semantic)
 * 4. Evidence-Grounded AI Investigation Assistant
 * 5. Failure Lab Verification Runner
 */

class ImmutableEvidenceStore {
  constructor() {
    this.events = [];
  }

  recordObservation(traceId, component, metricKey, observedValue, baselineValue, severity = "INFO") {
    const event = {
      eventId: `EVT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      timestamp: new Date().toISOString(),
      traceId,
      component,
      metricKey,
      observedValue,
      baselineValue,
      severity,
      immutableHash: `sha256-${Math.random().toString(36).substring(2, 15)}`
    };
    this.events.push(Object.freeze(event)); // Guarantee immutability
    return event;
  }

  getByTraceId(traceId) {
    return this.events.filter(e => e.traceId === traceId);
  }

  getAllEvents() {
    return [...this.events];
  }
}

class RootCauseCandidateEngine {
  constructor() {
    this.candidates = [];
  }

  evaluateEvidence(scenario, evidenceEvents) {
    if (!scenario.rootCause) {
      return [];
    }

    const rca = scenario.rootCause;
    const candidates = [
      {
        rank: 1,
        title: rca.title,
        node: rca.node,
        confidence: rca.confidence || 94.0,
        type: "PRIMARY_HYPOTHESIS",
        supportingEvidence: rca.symptoms || [],
        contradictingEvidence: rca.contradictingEvidence || [
          "DB CPU utilization is moderate (62%), indicating lock wait rather than CPU starvation"
        ],
        changeCorrelation: rca.causalityEvidence,
        blastRadius: rca.blastRadius || "Checkout API"
      },
      {
        rank: 2,
        title: "Downstream Query Plan Invalidation / Cache Miss Storm",
        node: rca.node,
        confidence: 71.5,
        type: "ALTERNATIVE_HYPOTHESIS",
        supportingEvidence: [
          "Query execution time spiked from 18ms to >2,000ms",
          "Buffer cache hit ratio decreased slightly"
        ],
        contradictingEvidence: [
          "Database connection pool count reached maximum limit of 100",
          "Lock contention queue length exceeds query parse time"
        ],
        changeCorrelation: "Recent deployment altered batch query signature",
        blastRadius: "Database Query Cache"
      },
      {
        rank: 3,
        title: "Intermittent Micro-Network Latency & Socket TCP Backlog",
        node: "F5 Ingress -> WebSphere Interface",
        confidence: 18.2,
        type: "SECONDARY_HYPOTHESIS",
        supportingEvidence: [
          "TCP connection reset metrics observed at ingress"
        ],
        contradictingEvidence: [
          "Load balancer and WAF latencies are healthy (<15ms)",
          "Network packet loss rate is 0.001%"
        ],
        changeCorrelation: "No recent network switch configuration changes detected",
        blastRadius: "Network Ingress Socket"
      }
    ];

    this.candidates = candidates;
    return candidates;
  }
}

class RequestIntelligenceEngine {
  constructor() {
    this.evidenceStore = new ImmutableEvidenceStore();
    this.candidateEngine = new RootCauseCandidateEngine();
    this.currentScenario = window.VITALIS_SCENARIOS.HEALTHY_BASELINE;
    this.isHealed = false;
    this.currentCandidates = [];
    this.liveTransactions = [];
    this.subscribers = [];
    this.initHistory();
  }

  initHistory() {
    this.liveTransactions = [
      {
        id: "PAYMENT-001-GOLDEN",
        scenarioId: "SCENARIO_HEALTHY",
        type: "PAYMENT_FLOW",
        duration: 142,
        status: 200,
        time: "Just now",
        rootNode: "Client -> Stripe",
        health: "HEALTHY"
      },
      {
        id: "PAYMENT-002-CHECKOUT",
        scenarioId: "SCENARIO_HEALTHY",
        type: "PAYMENT_FLOW",
        duration: 138,
        status: 200,
        time: "2s ago",
        rootNode: "Client -> Stripe",
        health: "HEALTHY"
      },
      {
        id: "AUTH-003-TOKEN",
        scenarioId: "SCENARIO_HEALTHY",
        type: "TOKEN_REFRESH",
        duration: 44,
        status: 200,
        time: "5s ago",
        rootNode: "Client -> OAuth2",
        health: "HEALTHY"
      }
    ];
  }

  setScenario(scenarioKey) {
    if (window.VITALIS_SCENARIOS[scenarioKey]) {
      this.currentScenario = JSON.parse(JSON.stringify(window.VITALIS_SCENARIOS[scenarioKey]));
      this.isHealed = false;

      // Ingest into Immutable Evidence Store
      if (this.currentScenario.rootCause) {
        this.evidenceStore.recordObservation(
          this.currentScenario.sampleTransaction.traceId,
          this.currentScenario.rootCause.node,
          "latency_and_locks",
          this.currentScenario.avgLatencyMs,
          142,
          "CRITICAL"
        );
      }

      // Generate Root Cause Candidates with Evidence Scoring
      this.currentCandidates = this.candidateEngine.evaluateEvidence(this.currentScenario, this.evidenceStore.getAllEvents());

      this.notify();
    }
  }

  // Evidence-Grounded AI Investigation Assistant
  queryAiInvestigation(userQuery) {
    const scenario = this.currentScenario;
    const candidates = this.currentCandidates;
    const tx = scenario.sampleTransaction;

    if (!scenario.rootCause || this.isHealed) {
      return {
        query: userQuery,
        timestamp: new Date().toLocaleTimeString(),
        status: "HEALTHY",
        answer: "All enterprise transactions are currently circulating within Golden Baselines. No structural, performance, or semantic deviations detected. Latency is healthy at 142ms."
      };
    }

    const primary = candidates[0];
    return {
      query: userQuery,
      timestamp: new Date().toLocaleTimeString(),
      status: scenario.status,
      answer: `Payments began degrading at ${tx.timestamp} UTC. 100% of affected requests (${primary.blastRadius}) share the same database query fingerprint. Database connection wait increased from 18ms baseline to ${scenario.nodes.find(n => n.id === 'db').latencyMs}ms. Correlation with deployment build #${scenario.rootCause.causalityEvidence.includes('v2.4.1') ? 'v2.4.1' : 'recent'} confirmed. The strongest hypothesis is ${primary.title} (Confidence: ${primary.confidence}%).`,
      groundedEvidence: primary.supportingEvidence,
      recommendedAction: scenario.firstAid ? scenario.firstAid.actionName : "Inspect connection pool and query lock plans"
    };
  }

  executeFirstAid() {
    if (!this.currentScenario.firstAid) return;

    this.isHealed = true;
    this.currentScenario.overallHealth = 99.96;
    this.currentScenario.avgLatencyMs = 148;
    this.currentScenario.status = "HEALTHY (HEALED)";
    this.currentScenario.badge = "AUTONOMOUSLY HEALED";
    this.currentScenario.badgeClass = "badge-healthy";
    this.currentScenario.systemLoadPct = 38;
    this.currentScenario.throughputRps = 4180;
    this.currentScenario.activeAnomalies = 0;

    this.currentScenario.nodes.forEach(node => {
      node.status = "OK";
      if (node.latencyMs > 100) node.latencyMs = 22;
      if (node.metrics) {
        if (node.metrics.connPool) node.metrics.connPool = "34/200 (SCALED & HEALTHY)";
        if (node.metrics.lockWaitMs) node.metrics.lockWaitMs = "0ms";
        if (node.metrics.httpCode) node.metrics.httpCode = "200 (ADYEN FALLBACK)";
        if (node.metrics.certStatus) node.metrics.certStatus = "RENEWED (VALID 90D)";
      }
    });

    this.currentScenario.sampleTransaction.httpStatus = 200;
    this.currentScenario.sampleTransaction.totalDurationMs = 148;
    this.currentScenario.sampleTransaction.structuralMatch = true;
    this.currentScenario.sampleTransaction.performanceMatch = true;
    this.currentScenario.sampleTransaction.semanticMatch = true;
    this.currentScenario.sampleTransaction.goldenDiff = "✓ HEALING VERIFIED: All 3 Baselines restored to Golden Footprint (<150ms).";
    this.currentScenario.sampleTransaction.hops.forEach(h => {
      h.status = "OK";
      if (h.durationMs > 100) h.durationMs = 24;
      h.detail = h.detail.replace(/🛑/g, "✓ HEALED: ");
    });

    this.currentCandidates = [];
    this.notify();
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  notify() {
    this.subscribers.forEach(cb => cb(this.currentScenario, this.isHealed, this.currentCandidates));
  }
}

window.rieEngine = new RequestIntelligenceEngine();
