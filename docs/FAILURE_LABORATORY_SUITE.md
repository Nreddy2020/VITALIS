# 🧪 VITALIS FAILURE LABORATORY — Test Suite & Verification Matrix (20 Scenarios)

> **Definition of Success:**  
> *"A VITALIS scenario is considered successful only when the platform can detect the abnormality, reconstruct the affected request, identify the affected hop, present supporting and contradicting evidence, estimate impact, provide an explainable root-cause candidate, recommend a controlled action, verify recovery, and remain non-blocking to the business transaction."*

---

## 1. The 5 Alpha Engineering Gates (Phase 1B)

| Gate | Name | Technical Verification Criteria |
|---|---|---|
| **Gate 1** | **Real Telemetry Ingestion** | Real Java/Node/Python application sends OTLP to `POST /v1/traces`, `POST /v1/metrics`, `POST /v1/logs`. |
| **Gate 2** | **Multi-Hop Trace Reconstruction** | Vitalis reconstructs complete journey: `Client` ─▶ `WAF` ─▶ `F5-LB` ─▶ `Auth` ─▶ `WebSphere` ─▶ `Database` ─▶ `Response` from real spans. |
| **Gate 3** | **Failure & Deviation Detection** | Injected DB latency (18ms ─▶ 2,800ms) is caught automatically via the 3-Tier Baseline Validator. |
| **Gate 4** | **Evidence-Grounded Diagnosis** | RIE produces ranked Root Cause Candidates with confidence percentages, supporting facts, contradicting facts, and change correlations without guessing. |
| **Gate 5** | **Production Safety & Offline Immunity** | When the Vitalis Collector/Server is killed (`SIGKILL`), the business transaction continues without interruption or latency degradation. |

---

## 2. The 12-Point Acceptance Gate for Every Failure Scenario

For every failure scenario injected into Vitalis, the engine must satisfy all 12 criteria without exception:

1. **Detection**: Recognized latency/status/schema deviation within $<1.5\text{s}$.
2. **Localization**: Pinpointed exact failing component $Hop_N$ on the circulatory path.
3. **Correlation**: Associated the failure with in-flight W3C TraceContext and upstream calls.
4. **Evidence Gathering**: Captured immutable telemetry facts (connection pools, locks, JVM state, status codes).
5. **Baseline Comparison**: Explicitly diffed against Structural, Performance, and Semantic Golden Baselines.
6. **Affected Requests**: Quantified total affected transactions ($N$ requests).
7. **Blast Radius**: Computed impacted business capability (e.g., *Payments & Checkout* vs *Reports*).
8. **Change Correlation**: Linked failure with recent git commits, config changes, or certificate updates.
9. **Candidate Scoring**: Evaluated candidate causes with confidence percentages, supporting facts, and contradicting evidence.
10. **Human Explanation**: Generated plain-language causal narrative in both Executive and Engineer modes.
11. **Action Recommendation**: Prescribed risk-evaluated first-aid runbook with rollback safety guardrail.
12. **Zero-Production Impact**: Proved that failure of the telemetry probe or collector did not degrade client traffic.

---

## 3. The 20 Enterprise Failure Scenarios

| # | Scenario Name | Target Component | Injected Anomaly | Acceptance Verification |
|---|---|---|---|---|
| **01** | **Database Latency Spike** | PostgreSQL / Oracle | Added 2,800ms query wait | Located Hop 7, diffed +2,100% latency, alerted before timeout. |
| **02** | **DB Row Lock Contention** | Database Table Lock | Exclusive `FOR UPDATE` lock held $>3.5\text{s}$ | Highlighted blocking PID #99142, correlated with batch transaction. |
| **03** | **Connection Pool Exhaustion** | WebSphere $\rightarrow$ DB DataSource | Pool utilization at 98/100 | Identified connection wait latency (2,100ms) vs query execution (12ms). |
| **04** | **WebSphere Thread Exhaustion** | WebSphere JVM Worker Pool | Saturated worker threads (198/200) | Localized thread queue buildup at Hop 5. |
| **05** | **JVM GC Pause / Pressure** | JVM Heap Memory | Stop-the-world Major GC pause (4.2s) | Captured heap saturation (92%) and pause duration watermark. |
| **06** | **Network Socket Latency** | F5 $\rightarrow$ WebSphere link | Simulated 350ms TCP latency | Isolated network transport time vs internal compute duration. |
| **07** | **Network Packet Loss** | Ingress Gateway Socket | 15% TCP packet drop | Highlighted TCP retransmission count and socket queue depth. |
| **08** | **TLS Certificate Expiry** | Internal Envoy / Service | Expired X.509 SSL Certificate | **Start-of-Day (SOD) 06:00 AM pulse** flagged cert 2 hours before market open. |
| **09** | **Header Mutation / Scope Drop**| Microservice Filter | Dropped `X-Vitalis-Auth-Scope` | Semantic Baseline diff flagged missing header at Hop 5 (Auth 401). |
| **10** | **Authentication Token Expiry** | OAuth2 Token Service | Injected expired JWT signature | Caught 401 Unauthorized at Hop 4 with token expiration claim diff. |
| **11** | **Kafka Consumer Lag Spike** | Event Bus Consumer Group | Consumer lag $>50,000$ messages | Highlighted queue buffer backup and partition delay. |
| **12** | **IBM MQ Message Backlog** | MQ Channel / Queue Manager | Saturated MQ channel queue depth | Flagged message put/get wait time and channel buffer contention. |
| **13** | **External API 504 Timeout** | 3rd-Party Payment API | Socket hung up after 5,000ms | Flagged external vendor hop, prescribed instant Adyen failover. |
| **14** | **Bad Deployment Regression** | Container Image v3.1.0 | Code regression introduced slow loop | Correlated failure spike with deployment build #4182 (14m ago). |
| **15** | **Configuration Drift** | Environment Variable | Database max pool size set to 5 | Flagged config diff vs Golden Baseline template. |
| **16** | **Internal DNS Failure** | CoreDNS / Bind | Resolving `db.internal.corp` failed | Pinpointed NXDOMAIN error code at socket layer before application call. |
| **17** | **Pod CrashLoopBackOff** | Kubernetes Workload | Pod exited with code 137 (OOMKilled) | Captured container memory spike and restart event. |
| **18** | **Node Resource Pressure** | Kubernetes Worker Node | Node CPU at 99% / Disk I/O stall | Disassociated node-level CPU from application-level lock wait. |
| **19** | **Service Unavailable (503)** | Microservice Cluster | Zero healthy endpoints in upstream pool | Highlighted routing table vacancy at API gateway layer. |
| **20** | **Cascading Dependency Meltdown**| Multi-Tier Chain | Slowdown in Auth cascading to 5 services | Traced causal origin back to root dependency rather than symptoms. |
