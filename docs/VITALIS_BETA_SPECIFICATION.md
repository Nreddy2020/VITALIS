# 🧬 VITALIS BETA — Real Enterprise Request Truth Specification (v2.0)

> **Mission Statement:**  
> *"Take the validated VITALIS intelligence engine and prove it against real heterogeneous enterprise infrastructure (WebSphere, IHS, F5, IBM MQ, DB2, Postgres, Kubernetes/OpenShift, OTel + eBPF convergence), real telemetry, real scale, real failures, and real operational conditions—while preserving the absolute invariant that VITALIS can fail without taking the business transaction down."*

---

## 1. Heterogeneous Enterprise Reference Architecture

VITALIS BETA evaluates real heterogeneous enterprise stacks combining legacy middleware, core enterprise databases, and modern cloud-native services in a single business request path:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   VITALIS BETA HETEROGENEOUS TOPOLOGY                       │
│                                                                             │
│                            [ CLIENT APPLICATION ]                           │
│                                      │                                      │
│                                      ▼                                      │
│                           [ F5 BIG-IP / INGRESS ]                           │
│                                      │                                      │
│                                      ▼                                      │
│                           [ IBM HTTP SERVER (IHS) ]                         │
│                                      │                                      │
│                                      ▼                                      │
│                           [ WEBSPHERE APPLICATION ]                         │
│                                      │                                      │
│                      ┌───────────────┴───────────────┐                      │
│                      ▼                               ▼                      │
│                [ IBM MQ / KAFKA ]             [ REST / gRPC API ]           │
│                      │                               │                      │
│                      ▼                               ▼                      │
│               [ IBM DB2 / ORACLE ]            [ POSTGRESQL CLUSTER ]        │
│                      │                               │                      │
│                      └───────────────┬───────────────┘                      │
│                                      ▼                                      │
│                          [ EXTERNAL PAYMENT GATEWAY ]                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 7-Stage Epistemic Trust Model

Every piece of data, diagnosis, and action in VITALIS is strictly labeled with its provenance to ensure 100% auditable enterprise trust:

$$\text{OBSERVED} \longrightarrow \text{CORRELATED} \longrightarrow \text{INFERRED} \longrightarrow \text{RECOMMENDED} \longrightarrow \text{APPROVED} \longrightarrow \text{EXECUTED} \longrightarrow \text{VERIFIED}$$

| Epistemic Stage | Provenance Definition | Example |
| :--- | :--- | :--- |
| **1. OBSERVED** | Raw, immutable telemetry collected directly from OTel / eBPF probes. | `DB latency = 3,982ms`, `HTTP Status = 504`, `Thread Count = 198/200`. |
| **2. CORRELATED** | Multiple direct observations deterministically linked via W3C TraceContext. | `Span DB-Query` linked to `TraceId TX-847392` and `Deployment v2.4.1`. |
| **3. INFERRED** | Deductive causal reasoning derived from the Evidence Graph. | `Candidate: DB2 Lock Contention (Confidence: 93.7%)`. |
| **4. RECOMMENDED**| Prescribed mitigation runbook based on policy and blast radius. | `Action: Terminate PID #99142 and scale read replica pool`. |
| **5. APPROVED** | Cryptographically signed human-in-the-loop authorization. | `Approved by sre-lead@bank.corp (Ticket INC-40192)`. |
| **6. EXECUTED** | Physical command or API call dispatched to remediate the node. | `Dispatched F5 Route Toggle / Pod Scaler API`. |
| **7. VERIFIED** | Closed-loop confirmation that post-action telemetry matches baseline. | `DB latency returned to 14ms; Error rate dropped to 0.00%`. |

---

## 3. Production Truth vs. Synthetic Truth Tagging

Every observation ingested by VITALIS carries an immutable `source_type`:

```json
{
  "traceId": "TX-847392",
  "evidence": {
    "dbLatencyMs": { "value": 3982, "source_type": "REAL" },
    "cpuUtilization": { "value": 62, "source_type": "REAL" },
    "deploymentVersion": { "value": "v2.4.1", "source_type": "REAL" },
    "goldenBaseline": { "value": 18, "source_type": "LEARNED" },
    "rcaCandidate": { "value": "DB2 Lock Contention", "source_type": "INFERRED" },
    "sodPulse": { "value": "Pre-Market 06:00 Check", "source_type": "SYNTHETIC" }
  }
}
```

---

## 4. The Request Truth Index (RTI)

The **Request Truth Index (RTI)** measures the mathematical percentage of a business transaction that VITALIS can observe, explain, and prove across 7 core dimensions:

$$\text{RTI} = \frac{\text{Structural} + \text{Performance} + \text{Semantic} + \text{Dependency} + \text{Infrastructure} + \text{Change} + \text{Causal}}{7}$$

### Enterprise Journey RTI Matrix:

| Business Journey | Structural | Performance | Semantic | Dependency | Infra | Change | Causal | **Weighted RTI** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Payments & Checkout (40%)** | 100% | 99.2% | 100% | 98.4% | 99.0% | 100% | 96.0% | **99.2%** |
| **User Authentication (30%)** | 100% | 98.4% | 100% | 97.2% | 98.0% | 100% | 96.2% | **97.8%** |
| **Catalog & Orders (20%)** | 100% | 99.0% | 100% | 98.0% | 98.5% | 100% | 95.0% | **98.0%** |
| **Statements & Reports (10%)** | 94.0%| 91.2% | 92.0% | 90.0% | 93.0% | 95.0% | 87.0% | **91.4%** |
| **Enterprise Overall Weighted RTI**| **99.4%** | **98.5%** | **99.2%** | **97.3%** | **98.0%** | **99.5%** | **95.2%** | **98.1%** |

---

## 5. eBPF + OpenTelemetry Convergence Model

```
                 BUSINESS REQUEST
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
 [ OpenTelemetry ]               [ Linux eBPF ]
  • Application Spans             • Socket TCP Retransmissions
  • W3C TraceContext              • Kernel Network Round-Trip
  • Business Semantics            • Process Lineage & Sockets
  • Service Attributes            • DB Connection Pool Waits
        │                               │
        └───────────────┬───────────────┘
                        ▼
            [ UNIFIED EVIDENCE GRAPH ]
```

---

## 6. Change Intelligence Engine

Connects temporal change events to downstream request deviations and customer impact:

$$\text{CHANGE (Deploy v2.4.1 @ 10:01)} \longrightarrow \text{QUERY DEVIATION (Q-847 @ 10:08)} \longrightarrow \text{POOL SATURATION (85\% @ 10:09)} \longrightarrow \text{CHECKOUT TIMEOUT (@ 10:10)}$$

---

## 7. The VITALIS BETA Invariant
> **VITALIS MUST NEVER BECOME A DEPENDENCY OF THE BUSINESS TRANSACTION IT OBSERVES.**
- Telemetry runs out-of-band via kernel eBPF ring buffers and non-blocking OTel UDP/gRPC channels.
- If VITALIS is terminated (`SIGKILL`), client transactions continue at 100% throughput with zero disruption.
