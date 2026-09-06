/**
 * VITALIS: The IT Circulatory Intelligence Platform
 * Enterprise Scenario Registry & Causal Evidence Graph Dataset
 */

window.VITALIS_SCENARIOS = {
  HEALTHY_BASELINE: {
    id: "SCENARIO_HEALTHY",
    name: "Golden Circulatory Baseline",
    badge: "100% HEALTHY",
    badgeClass: "badge-healthy",
    status: "HEALTHY",
    description: "Optimal end-to-end request circulation across all 8 nodes. Sub-160ms total duration with 100% structural, performance, and semantic baseline compliance.",
    overallHealth: 99.96,
    avgLatencyMs: 142,
    throughputRps: 4250,
    activeAnomalies: 0,
    systemLoadPct: 34,
    nodes: [
      { id: "client", name: "Client Browser / iOS", type: "CLIENT", latencyMs: 8, status: "OK", metrics: { cpu: "12%", queue: "0" } },
      { id: "waf", name: "Cloudflare WAF / CDN", type: "GATEWAY", latencyMs: 12, status: "OK", metrics: { blocked: "0.01%", cacheHit: "94%" } },
      { id: "lb", name: "F5 Ingress Load Balancer", type: "LB", latencyMs: 10, status: "OK", metrics: { activeConns: "14.2k", rps: "4.2k" } },
      { id: "auth", name: "OAuth2 / Token Service", type: "AUTH", latencyMs: 24, status: "OK", metrics: { jwtVerifyMs: "1.2ms", tokenCache: "99.1%" } },
      { id: "app", name: "WebSphere / Core App", type: "APP", latencyMs: 45, status: "OK", metrics: { jvmHeap: "48%", activeThreads: "62/200" } },
      { id: "kafka", name: "Kafka Event Broker", type: "BROKER", latencyMs: 14, status: "OK", metrics: { lag: "0", throughput: "12MB/s" } },
      { id: "db", name: "PostgreSQL / DB Cluster", type: "DATABASE", latencyMs: 18, status: "OK", metrics: { connPool: "32/100", lockWaitMs: "0ms", qps: "850" } },
      { id: "payment", name: "Stripe / Payment Gateway", type: "EXTERNAL", latencyMs: 78, status: "OK", metrics: { httpCode: "200", p99: "95ms" } }
    ],
    sampleTransaction: {
      traceId: "TX-99824-GOLDEN",
      endpoint: "POST /api/v2/checkout/process",
      userId: "cust_992147",
      timestamp: "21:40:12.482",
      totalDurationMs: 142,
      httpStatus: 200,
      structuralMatch: true,
      performanceMatch: true,
      semanticMatch: true,
      goldenDiff: "✓ All 3 Baselines Verified: Structural (8/8 hops), Performance (142ms vs budget 180ms), Semantic (All headers & schemas intact).",
      hops: [
        { hop: 1, node: "Client Browser", durationMs: 8, status: "OK", detail: "Payload serialized (3.4 KB), W3C TraceContext x-vitalis-trace-id attached." },
        { hop: 2, node: "Cloudflare WAF", durationMs: 12, status: "OK", detail: "TLS termination verified, IP rate limit clean." },
        { hop: 3, node: "F5 Load Balancer", durationMs: 10, status: "OK", detail: "Layer-7 round-robin dispatch to App Pod #4." },
        { hop: 4, node: "OAuth2 Token Svc", durationMs: 24, status: "OK", detail: "Bearer token verified: scope=['payments:write', 'user:read']." },
        { hop: 5, node: "WebSphere App", durationMs: 45, status: "OK", detail: "Business rules evaluated, order ID generated (ORD-88192)." },
        { hop: 6, node: "Kafka Broker", durationMs: 14, status: "OK", detail: "Order event published to topic 'transactions.v1'." },
        { hop: 7, node: "PostgreSQL Cluster", durationMs: 18, status: "OK", detail: "Row inserted in 4ms: `INSERT INTO orders VALUES (...)`." },
        { hop: 8, node: "Stripe Gateway", durationMs: 78, status: "OK", detail: "Charge captured: `$149.00 USD` (Card approved)." }
      ]
    },
    rootCause: null,
    firstAid: null,
    telemetryRoi: {
      incidentsAnalyzed: 428,
      rcaIdentified: 391,
      avgInvestigationReductionPct: 73,
      engineerHoursSaved: 1248,
      downtimeAvoidedHours: 18.4,
      automatedRemediations: 86
    }
  },

  DB_STARVATION: {
    id: "SCENARIO_DB_STARVATION",
    name: "Database Connection Pool Saturation & Row Lock Contention",
    badge: "CRITICAL FAILURE (DB ISCHEMIA)",
    badgeClass: "badge-critical",
    status: "CRITICAL",
    description: "Database connection pool saturated at 98%. Transactions queue for 3,800ms before encountering timeout/504.",
    overallHealth: 64.2,
    avgLatencyMs: 3950,
    throughputRps: 1120,
    activeAnomalies: 1,
    systemLoadPct: 94,
    nodes: [
      { id: "client", name: "Client Browser / iOS", type: "CLIENT", latencyMs: 8, status: "OK", metrics: { cpu: "12%", queue: "0" } },
      { id: "waf", name: "Cloudflare WAF / CDN", type: "GATEWAY", latencyMs: 14, status: "OK", metrics: { blocked: "0.02%", cacheHit: "92%" } },
      { id: "lb", name: "F5 Ingress Load Balancer", type: "LB", latencyMs: 12, status: "OK", metrics: { activeConns: "18.4k", rps: "1.1k" } },
      { id: "auth", name: "OAuth2 / Token Service", type: "AUTH", latencyMs: 28, status: "OK", metrics: { jwtVerifyMs: "1.4ms", tokenCache: "98.5%" } },
      { id: "app", name: "WebSphere / Core App", type: "APP", latencyMs: 3890, status: "CRITICAL", metrics: { jvmHeap: "88%", activeThreads: "198/200 ⚠️" } },
      { id: "kafka", name: "Kafka Event Broker", type: "BROKER", latencyMs: 16, status: "OK", metrics: { lag: "140", throughput: "4MB/s" } },
      { id: "db", name: "PostgreSQL / DB Cluster", type: "DATABASE", latencyMs: 3820, status: "CRITICAL", metrics: { connPool: "98/100 (BLOCKED)", lockWaitMs: "3740ms 🛑", qps: "120" } },
      { id: "payment", name: "Stripe / Payment Gateway", type: "EXTERNAL", latencyMs: 0, status: "UNREACHED", metrics: { httpCode: "N/A", p99: "N/A" } }
    ],
    sampleTransaction: {
      traceId: "TX-40192-ISCHEMIA",
      endpoint: "POST /api/v2/checkout/process",
      userId: "cust_481023",
      timestamp: "21:40:04.119",
      totalDurationMs: 3950,
      httpStatus: 504,
      structuralMatch: false,
      performanceMatch: false,
      semanticMatch: true,
      goldenDiff: "PERFORMANCE DEVIATION: Hop 7 (PostgreSQL) latency 3,820ms vs Baseline 18ms (+21,122%). Connection pool saturated.",
      hops: [
        { hop: 1, node: "Client Browser", durationMs: 8, status: "OK", detail: "Payload serialized (3.4 KB), trace context attached." },
        { hop: 2, node: "Cloudflare WAF", durationMs: 14, status: "OK", detail: "TLS pass-through OK." },
        { hop: 3, node: "F5 Load Balancer", durationMs: 12, status: "OK", detail: "Layer-7 dispatched to App Pod #8." },
        { hop: 4, node: "OAuth2 Token Svc", durationMs: 28, status: "OK", detail: "Token verified." },
        { hop: 5, node: "WebSphere App", durationMs: 70, status: "OK", detail: "Acquiring database connection from `jdbc/CustomerDS`..." },
        { hop: 6, node: "Kafka Broker", durationMs: 16, status: "OK", detail: "Pre-order audit logged." },
        { hop: 7, node: "PostgreSQL Cluster", durationMs: 3820, status: "CRITICAL", detail: "🛑 BLOCKAGE: `HikariPool-1` exhausted (Max: 100). Query stalled on table lock: `SELECT * FROM inventory WHERE id = $1 FOR UPDATE`." },
        { hop: 8, node: "Stripe Gateway", durationMs: 0, status: "UNREACHED", detail: "Transaction aborted before payment invocation." }
      ]
    },
    rootCause: {
      title: "Database Connection Pool Starvation & Row Lock Contention",
      node: "PostgreSQL Cluster (port 5432) -> WebSphere App Pool",
      confidence: 94.0,
      detectedAt: "21:40:04",
      symptoms: [
        "Normal DB Latency: 18ms | Observed: 3,820ms (+21,122%)",
        "Connection Pool Utilization: 98% (98/100 active connections)",
        "Unindexed `FOR UPDATE` query holding exclusive row lock >3.5s",
        "WebSphere worker thread pool near exhaustion (198/200)"
      ],
      causalityEvidence: "Deployment `app-v2.4.1` (14 minutes ago) introduced a batch inventory lock query without index on `sku_id`.",
      blastRadius: "Checkout Transactions (12,438 requests affected)"
    },
    firstAid: {
      actionName: "Auto-Scale DB Read Replica & Terminate Stalled Lock Session",
      riskLevel: "LOW (Safe Automated Remediation)",
      description: "Instantly terminates blocking PID #99142, routes read traffic to Read Replica Pool (Node 2), and bumps pool maximum capacity from 100 to 200.",
      impactEstimate: "Restores checkout throughput to 4,200 rps and normalizes latency to <150ms within 5 seconds."
    },
    telemetryRoi: {
      incidentsAnalyzed: 429,
      rcaIdentified: 392,
      avgInvestigationReductionPct: 74,
      engineerHoursSaved: 1256,
      downtimeAvoidedHours: 18.9,
      automatedRemediations: 87
    }
  },

  PAYMENT_504_TIMEOUT: {
    id: "SCENARIO_PAYMENT_TIMEOUT",
    name: "3rd-Party Payment Gateway Silent 504 Timeout",
    badge: "EXTERNAL ARTERY RUPTURE",
    badgeClass: "badge-critical",
    status: "CRITICAL",
    description: "External payment vendor API latency surged to 5,000ms, triggering upstream HTTP 504 Gateway Timeouts.",
    overallHealth: 71.5,
    avgLatencyMs: 5120,
    throughputRps: 1850,
    activeAnomalies: 1,
    systemLoadPct: 78,
    nodes: [
      { id: "client", name: "Client Browser / iOS", type: "CLIENT", latencyMs: 8, status: "OK", metrics: { cpu: "12%", queue: "0" } },
      { id: "waf", name: "Cloudflare WAF / CDN", type: "GATEWAY", latencyMs: 12, status: "OK", metrics: { blocked: "0.01%", cacheHit: "94%" } },
      { id: "lb", name: "F5 Ingress Load Balancer", type: "LB", latencyMs: 10, status: "OK", metrics: { activeConns: "15.1k", rps: "1.8k" } },
      { id: "auth", name: "OAuth2 / Token Service", type: "AUTH", latencyMs: 22, status: "OK", metrics: { jwtVerifyMs: "1.1ms", tokenCache: "99.2%" } },
      { id: "app", name: "WebSphere / Core App", type: "APP", latencyMs: 5040, status: "CRITICAL", metrics: { jvmHeap: "62%", activeThreads: "185/200" } },
      { id: "kafka", name: "Kafka Event Broker", type: "BROKER", latencyMs: 14, status: "OK", metrics: { lag: "12", throughput: "8MB/s" } },
      { id: "db", name: "PostgreSQL / DB Cluster", type: "DATABASE", latencyMs: 20, status: "OK", metrics: { connPool: "36/100", lockWaitMs: "0ms", qps: "620" } },
      { id: "payment", name: "Stripe / Payment Gateway", type: "EXTERNAL", latencyMs: 5000, status: "CRITICAL", metrics: { httpCode: "504 TIMEOUT", p99: "5.2s 🛑" } }
    ],
    sampleTransaction: {
      traceId: "TX-88319-RUPTURE",
      endpoint: "POST /api/v2/checkout/process",
      userId: "cust_109283",
      timestamp: "21:40:40.892",
      totalDurationMs: 5120,
      httpStatus: 504,
      structuralMatch: true,
      performanceMatch: false,
      semanticMatch: false,
      goldenDiff: "PERFORMANCE & SEMANTIC DEVIATION: Hop 8 (Stripe Gateway) timed out after 5,000ms (Baseline: 78ms). Returned HTTP 504.",
      hops: [
        { hop: 1, node: "Client Browser", durationMs: 8, status: "OK", detail: "Request initiated." },
        { hop: 2, node: "Cloudflare WAF", durationMs: 12, status: "OK", detail: "Traffic validated." },
        { hop: 3, node: "F5 Load Balancer", durationMs: 10, status: "OK", detail: "Dispatched to App cluster." },
        { hop: 4, node: "OAuth2 Token Svc", durationMs: 22, status: "OK", detail: "Auth verified." },
        { hop: 5, node: "WebSphere App", durationMs: 48, status: "OK", detail: "Order prepared, calling payment gateway..." },
        { hop: 6, node: "Kafka Broker", durationMs: 14, status: "OK", detail: "Audit event emitted." },
        { hop: 7, node: "PostgreSQL Cluster", durationMs: 20, status: "OK", detail: "DB write succeeded." },
        { hop: 8, node: "Stripe Gateway", durationMs: 5000, status: "CRITICAL", detail: "🛑 TIMEOUT: External vendor `api.stripe.com/v1/charges` socket timeout after 5000ms without response." }
      ]
    },
    rootCause: {
      title: "Downstream 3rd-Party Payment Gateway Latency Spike & Socket Timeout",
      node: "External Vendor -> api.stripe.com/v1/charges",
      confidence: 96.2,
      detectedAt: "21:40:40",
      symptoms: [
        "Normal Payment Latency: 78ms | Observed: 5,000ms (Socket Hangup)",
        "Failure Rate at External Hop: 84.6% of checkout requests",
        "Internal App Server thread pool backing up awaiting socket responses"
      ],
      causalityEvidence: "External vendor status page reporting global BGP routing incident in US-East region.",
      blastRadius: "Payment Checkout Gateway (8,420 transactions impacted)"
    },
    firstAid: {
      actionName: "Trigger Circuit Breaker & Switch to Secondary Payment Gateway (Adyen)",
      riskLevel: "LOW (Instant Safe Failover)",
      description: "Opens circuit breaker on primary payment endpoint, rerouting all transactions to backup processor `Adyen Payments API`.",
      impactEstimate: "Immediately drops checkout error rate from 84.6% to 0.02% and recovers latency to 110ms."
    },
    telemetryRoi: {
      incidentsAnalyzed: 429,
      rcaIdentified: 392,
      avgInvestigationReductionPct: 74,
      engineerHoursSaved: 1258,
      downtimeAvoidedHours: 19.2,
      automatedRemediations: 88
    }
  },

  BAD_DEPLOYMENT_AUTH: {
    id: "SCENARIO_BAD_DEPLOY",
    name: "Bad Deployment: Dropped Authorization Scope Header",
    badge: "SEMANTIC MUTATION (AUTH 401)",
    badgeClass: "badge-critical",
    status: "CRITICAL",
    description: "Release v3.1.0 dropped the downstream `X-Vitalis-Auth-Scope` header, causing all internal microservice calls to be rejected with 401.",
    overallHealth: 58.1,
    avgLatencyMs: 82,
    throughputRps: 840,
    activeAnomalies: 1,
    systemLoadPct: 22,
    nodes: [
      { id: "client", name: "Client Browser / iOS", type: "CLIENT", latencyMs: 8, status: "OK", metrics: { cpu: "12%", queue: "0" } },
      { id: "waf", name: "Cloudflare WAF / CDN", type: "GATEWAY", latencyMs: 12, status: "OK", metrics: { blocked: "0.01%", cacheHit: "94%" } },
      { id: "lb", name: "F5 Ingress Load Balancer", type: "LB", latencyMs: 10, status: "OK", metrics: { activeConns: "12.1k", rps: "840" } },
      { id: "auth", name: "OAuth2 / Token Service", type: "AUTH", latencyMs: 24, status: "OK", metrics: { jwtVerifyMs: "1.2ms", tokenCache: "99.1%" } },
      { id: "app", name: "WebSphere / Core App", type: "APP", latencyMs: 28, status: "CRITICAL", metrics: { jvmHeap: "34%", activeThreads: "18/200" } },
      { id: "kafka", name: "Kafka Event Broker", type: "BROKER", latencyMs: 0, status: "UNREACHED", metrics: { lag: "0", throughput: "0MB/s" } },
      { id: "db", name: "PostgreSQL / DB Cluster", type: "DATABASE", latencyMs: 0, status: "UNREACHED", metrics: { connPool: "12/100", lockWaitMs: "0ms", qps: "0" } },
      { id: "payment", name: "Stripe / Payment Gateway", type: "EXTERNAL", latencyMs: 0, status: "UNREACHED", metrics: { httpCode: "N/A", p99: "N/A" } }
    ],
    sampleTransaction: {
      traceId: "TX-77401-MUTATION",
      endpoint: "POST /api/v2/checkout/process",
      userId: "cust_559218",
      timestamp: "21:41:10.041",
      totalDurationMs: 82,
      httpStatus: 401,
      structuralMatch: false,
      performanceMatch: true,
      semanticMatch: false,
      goldenDiff: "SEMANTIC MUTATION: Expected header `X-Vitalis-Auth-Scope: payments:write` was STRIPPED at Hop 5 (WebSphere App). Sub-request rejected with 401.",
      hops: [
        { hop: 1, node: "Client Browser", durationMs: 8, status: "OK", detail: "Request initiated with Bearer token." },
        { hop: 2, node: "Cloudflare WAF", durationMs: 12, status: "OK", detail: "Traffic validated." },
        { hop: 3, node: "F5 Load Balancer", durationMs: 10, status: "OK", detail: "Dispatched to WebSphere." },
        { hop: 4, node: "OAuth2 Token Svc", durationMs: 24, status: "OK", detail: "Token verified, scopes passed to ingress context." },
        { hop: 5, node: "WebSphere App", durationMs: 28, status: "CRITICAL", detail: "🛑 PAYLOAD DROP: Filter `AuthFilterV3` discarded header `X-Vitalis-Auth-Scope`. Sub-request rejected with HTTP 401 Unauthorized." },
        { hop: 6, node: "Kafka Broker", durationMs: 0, status: "UNREACHED", detail: "Aborted." },
        { hop: 7, node: "PostgreSQL Cluster", durationMs: 0, status: "UNREACHED", detail: "Aborted." },
        { hop: 8, node: "Stripe Gateway", durationMs: 0, status: "UNREACHED", detail: "Aborted." }
      ]
    },
    rootCause: {
      title: "Header Filtering Regression in Recent Microservice Deployment",
      node: "WebSphere Core App (v3.1.0) -> Downstream Interceptor",
      confidence: 99.2,
      detectedAt: "21:41:10",
      symptoms: [
        "HTTP 401 Unauthorized spike on 100% of checkout attempts",
        "Semantic Diff shows `X-Vitalis-Auth-Scope` present in Hop 4 but missing in Hop 5",
        "Correlated with deployment of container build #4182 (12m ago)"
      ],
      causalityEvidence: "Git commit `8a4f91e` in repo `core-checkout-service` introduced strict header whitelist omitting auth scope.",
      blastRadius: "All authenticated API transactions"
    },
    firstAid: {
      actionName: "Automated Canary Rollback to Stable Release v3.0.9",
      riskLevel: "MEDIUM (Human Approval Recommended)",
      description: "Executes automated zero-downtime rolling rollback in Kubernetes/OpenShift to image tag `v3.0.9`.",
      impactEstimate: "Restores 100% transaction success rate in 45 seconds."
    },
    telemetryRoi: {
      incidentsAnalyzed: 429,
      rcaIdentified: 392,
      avgInvestigationReductionPct: 74,
      engineerHoursSaved: 1262,
      downtimeAvoidedHours: 19.5,
      automatedRemediations: 88
    }
  },

  START_OF_DAY_CHECK: {
    id: "SCENARIO_SOD",
    name: "Start-of-Day (SOD) 6:00 AM Pre-Market Flight Check",
    badge: "SOD PRE-MARKET AUDIT",
    badgeClass: "badge-degraded",
    status: "DEGRADED",
    description: "Automated 6:00 AM synthetic pulse identified an expired SSL certificate on internal reporting microservice before business hours open.",
    overallHealth: 88.4,
    avgLatencyMs: 210,
    throughputRps: 500,
    activeAnomalies: 1,
    systemLoadPct: 15,
    nodes: [
      { id: "client", name: "Synthetic Pulse Bot", type: "CLIENT", latencyMs: 6, status: "OK", metrics: { cpu: "4%", queue: "0" } },
      { id: "waf", name: "Cloudflare WAF / CDN", type: "GATEWAY", latencyMs: 10, status: "OK", metrics: { blocked: "0%", cacheHit: "99%" } },
      { id: "lb", name: "F5 Ingress Load Balancer", type: "LB", latencyMs: 8, status: "OK", metrics: { activeConns: "1.2k", rps: "500" } },
      { id: "auth", name: "OAuth2 / Token Service", type: "AUTH", latencyMs: 20, status: "OK", metrics: { jwtVerifyMs: "1.0ms", tokenCache: "99.8%" } },
      { id: "app", name: "WebSphere / Core App", type: "APP", latencyMs: 38, status: "OK", metrics: { jvmHeap: "28%", activeThreads: "22/200" } },
      { id: "kafka", name: "Kafka Event Broker", type: "BROKER", latencyMs: 12, status: "OK", metrics: { lag: "0", throughput: "1MB/s" } },
      { id: "db", name: "PostgreSQL / DB Cluster", type: "DATABASE", latencyMs: 16, status: "OK", metrics: { connPool: "14/100", lockWaitMs: "0ms", qps: "150" } },
      { id: "payment", name: "Internal Report Microservice", type: "EXTERNAL", latencyMs: 100, status: "CRITICAL", metrics: { certStatus: "EXPIRED ⚠️", httpCode: "SSL_ERR" } }
    ],
    sampleTransaction: {
      traceId: "SOD-PULSE-060000",
      endpoint: "GET /api/v1/reports/eod-summary",
      userId: "synthetic_sod_probe",
      timestamp: "06:00:00.012",
      totalDurationMs: 210,
      httpStatus: 502,
      structuralMatch: true,
      performanceMatch: true,
      semanticMatch: false,
      goldenDiff: "SOD WARNING: Hop 8 SSL Handshake failed. X.509 Certificate expired at 04:00 AM UTC.",
      hops: [
        { hop: 1, node: "Synthetic Bot", durationMs: 6, status: "OK", detail: "Fired Start-of-Day Golden Journey." },
        { hop: 2, node: "Cloudflare WAF", durationMs: 10, status: "OK", detail: "Route validated." },
        { hop: 3, node: "F5 Load Balancer", durationMs: 8, status: "OK", detail: "Internal gateway route OK." },
        { hop: 4, node: "OAuth2 Token Svc", durationMs: 20, status: "OK", detail: "Service account token valid." },
        { hop: 5, node: "WebSphere App", durationMs: 38, status: "OK", detail: "Report request dispatched." },
        { hop: 6, node: "Kafka Broker", durationMs: 12, status: "OK", detail: "SOD heartbeat logged." },
        { hop: 7, node: "PostgreSQL Cluster", durationMs: 16, status: "OK", detail: "Read query succeeded." },
        { hop: 8, node: "Report Service", durationMs: 100, status: "CRITICAL", detail: "🛑 SSL HANDSHAKE ERROR: Certificate `report-service.internal.corp` expired 2 hours ago." }
      ]
    },
    rootCause: {
      title: "Start-of-Day Early Warning: Expired Internal TLS Certificate",
      node: "Report Microservice (port 8443) -> TLS Ingress",
      confidence: 99.4,
      detectedAt: "06:00:00",
      symptoms: [
        "Internal TLS Handshake failure: `CERT_HAS_EXPIRED`",
        "Detected 2 hours prior to 08:00 AM market/business open",
        "Prevents 100% of morning managerial statement generation"
      ],
      causalityEvidence: "Auto-renewal cron job on Kubernetes cert-manager failed due to API rate limit at 04:00 AM.",
      blastRadius: "Executive Financial Reports & Morning Statements"
    },
    firstAid: {
      actionName: "Auto-Rotate TLS Secret & Reload Envoy Proxy Pods",
      riskLevel: "LOW (Safe Pre-Business Action)",
      description: "Generates renewed 90-day Let's Encrypt / Vault certificate and reloads internal gateway cert secret.",
      impactEstimate: "Completely neutralizes morning outage risk 2 hours before real business users arrive."
    },
    telemetryRoi: {
      incidentsAnalyzed: 429,
      rcaIdentified: 393,
      avgInvestigationReductionPct: 74,
      engineerHoursSaved: 1266,
      downtimeAvoidedHours: 20.1,
      automatedRemediations: 89
    }
  }
};
