# 🩸 VITALIS — Master Architectural Specification v1.0
## The IT Circulatory Intelligence Platform (ICOA)
> **Tagline:** *"Every request has a story. Vitalis makes that story visible, understandable, and actionable."*

---

## 1. Executive Summary & Foundational Invariants

### 1.1 The Core Mission
Modern IT enterprises run thousands of decoupled microservices, WebSphere/JBoss application servers, database clusters, Kafka queues, and third-party SaaS APIs. Existing tools (APM, SIEM, ITSM, CMDB) generate isolated metrics, logs, and alerts without causal correlation.

**Vitalis does not replace existing monitoring tools.** It sits **above** them as the **Request Intelligence, Evidence Graph, and Causal Reasoning Layer**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EXISTING MONITORING                              │
│       APM Tool               Log Aggregator           Infra Monitor         │
│     (Dynatrace)                 (Splunk)               (Prometheus)         │
│          │                          │                        │              │
│          ▼                          ▼                        ▼              │
│        Traces                      Logs                   Metrics           │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Telemetry Stream (OTel / eBPF)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                   VITALIS                                   │
│                        THE IT CIRCULATORY BRAIN                             │
│                                                                             │
│   [ 🫀 HEART ]       Request Pulse & SOD Synthetic Business Journeys        │
│   [ 🧬 NERVOUS ]     OpenTelemetry & eBPF Multi-Layer Sensory Fabric        │
│   [ 🧠 BRAIN ]       Evidence Graph, Golden Path Diff & Causal Reasoning    │
│   [ 💉 IMMUNE ]      First-Aid Hub, Policy Engine & Rollback Safety         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 The Absolute Architectural Invariant
> **VITALIS MUST NEVER BECOME A DEPENDENCY OF THE BUSINESS TRANSACTION IT OBSERVES.**
- If Vitalis collectors or storage clusters experience an outage, the business application continues at 100% capacity without latency degradation.
- Telemetry collection operates out-of-band using non-blocking asynchronous ring buffers, kernel eBPF probes, and UDP/gRPC collectors with graceful backpressure shedding.

---

## 2. The 9-Plane Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. EXPERIENCE PLANE                                                         │
│    • The IT Body (Executive Vitality)  • Transparent Request Trace View     │
│    • Global Request Explorer           • "Why?" Causal Explanation View     │
│    • "What Next?" Action Hub           • SOD 06:00 AM Flight Deck           │
│    • Living Evidence Graph Canvas      • Real Telemetry ROI Dashboard       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. INTELLIGENCE PLANE (Request Intelligence Engine - RIE)                   │
│    • 3-Tier Golden Baseline Evaluator  • Anomaly & Stenosis Detection       │
│    • Causal Root-Cause Inference Engine• Blast Radius & Business Impact Est.│
│    • Evidence-Grounded AI Reasoning    • Early Degradation Prediction       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. EVIDENCE GRAPH PLANE                                                     │
│    • Entity Graph: Request ─▶ Service ─▶ Pod ─▶ Node ─▶ DB ─▶ External API │
│    • Event Graph: Changes ─▶ Configs ─▶ Deploys ─▶ Contention ─▶ Failures   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. KNOWLEDGE PLANE                                                          │
│    • Service & API Catalog             • CMDB Topology & Network Routes     │
│    • Team Ownership Registry           • SLO / Error Budget Contracts       │
│    • Historical Incident Memory Base   • Verified Runbook Repository        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. CONTROL & REMEDIATION PLANE (The Immune System)                          │
│    • Risk Assessment Matrix            • Human-in-the-Loop Approval Gates   │
│    • Automated Circuit Breakers        • Fallback Route Dispatcher          │
│    • Rolling Canary Rollback Trigger   • Post-Action Verification & Rollback│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. OBSERVABILITY FABRIC PLANE                                               │
│    • Traces (W3C TraceContext)         • Deep Metrics (CPU, Memory, Sockets)│
│    • Structured Log DNA Streams        • Continuous Profiling (CPU/Memory)  │
│    • Database Query Profiler & Locks   • Network Flow & Socket Latency      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. COLLECTION & SENSOR PLANE                                                │
│    • OpenTelemetry (OTel) Collectors   • Linux Kernel eBPF Socket Probes    │
│    • JVM / WebSphere / JBoss Bytecode  • Ingress / Envoy / Istio Sidecars   │
│    • Database Sockets & Query Adapters • Message Broker (Kafka/MQ) Sniffers │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 8. DATA PLANE                                                               │
│    • Kafka (Event & Telemetry Streaming) • ClickHouse (Columnar Trace Store)│
│    • PostgreSQL (Config, Rules, Metadata)• Redis (Hot State & Active Pulses)│
│    • Graph DB (Evidence & Dependency)    • S3/Blob (Long-Term Trace Archive)│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 9. ENTERPRISE IT ENVIRONMENT                                                │
│    • Cloud (AWS, Azure, GCP)           • On-Premise VMs & Bare Metal        │
│    • Kubernetes & Red Hat OpenShift    • WebSphere, IHS, WebLogic, JBoss    │
│    • Oracle, DB2, PostgreSQL, MySQL    • Apache Kafka & IBM MQ              │
│    • Third-Party Payment & Vendor APIs • Mainframes & Core Banking Systems  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 4 Chambers of Vitalis

### Chamber 1: The Heart (Request Pulse Engine)
- Emits synthetic "Golden Requests" continuously to establish operational baselines.
- Drives **Start-of-Day (SOD) 06:00 AM Flight Checks** across all critical business journeys (Login $\rightarrow$ Balance Check $\rightarrow$ Transfer $\rightarrow$ Checkout) to verify operational readiness 2 hours before market open.

### Chamber 2: The Nervous System (Sensory Fabric)
- Standardized on **OpenTelemetry (CNCF Graduated)**.
- Captures trace spans, resource attributes, database queries, network metrics, and logs with standardized semantic conventions.

### Chamber 3: The Brain (Request Intelligence Engine)
- **Deterministic First, AI Second**: AI does not hallucinate causes from raw logs. Instead, deterministic correlation models the Evidence Graph, identifies candidate causes with confidence scores ($94\%$), and AI generates human-understandable explanations and runbook steps.

### Chamber 4: The Immune System (First-Aid Engine)
- Safeguarded remediation workflow:
  $$\text{Failure} \rightarrow \text{Severity} \rightarrow \text{Confidence} \rightarrow \text{Blast Radius} \rightarrow \text{Policy Check} \rightarrow \text{Approval/Auto} \rightarrow \text{Execute} \rightarrow \text{Verify} \rightarrow \text{Rollback if Needed}$$

---

## 4. The 3 Golden Baselines

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THE 3 GOLDEN BASELINES                              │
├───────────────────────┬─────────────────────────────────────────────────────┤
│ Baseline Type         │ What It Validates                                   │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ 1. Structural         │ Expected topology path: Client ─▶ WAF ─▶ LB ─▶      │
│                       │ Auth ─▶ WebSphere ─▶ Kafka ─▶ DB ─▶ Payment         │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ 2. Performance        │ Expected latency budgets per hop (e.g. LB: 12ms,    │
│                       │ WebSphere: 45ms, DB: 18ms, Payment: 78ms).          │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ 3. Semantic           │ Expected headers (X-Auth-Scope), payload schemas,   │
│                       │ status codes, correlation IDs, and token validity.  │
└───────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 5. Enterprise Data Privacy & Sanitization Tiers

To meet strict compliance in banking, healthcare, and government systems (GDPR, HIPAA, PCI-DSS, SOC2):
- **Level 0 (Metadata Only)**: Trace ID, Spans, Service Names, Status Codes, Micro-Latencies, Dependency Graphs.
- **Level 1 (Sanitized Structural Fields)**: Schema structures, JSON keys, byte sizes, non-PII query hashes.
- **Level 2 (Controlled Payload Capture)**: Opt-in, field-level masked payloads governed by RBAC policies.
- **Level 3 (Forensic Audit Capture)**: Time-limited, encrypted at rest with hardware HSM, strictly logged for root-cause post-mortems.

---

## 6. Defensible Telemetry-Driven ROI Model

Rather than making unverified claims, Vitalis measures actual value delivered from real telemetry:

$$\text{Engineering Hours Saved} = \sum_{\text{incidents}} (\text{Historical MTTR} - \text{Vitalis MTTR}) \times \text{Staff Affected}$$
$$\text{Operational Savings} = (\text{Hours Saved} \times \text{Hourly Cost}) + \text{Downtime Revenue Protected} + \text{SLA Penalties Avoided}$$
