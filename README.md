# 🩸 VITALIS — The Request Truth Engine
## The IT Circulatory Intelligence Platform

> **"Every request has a story. VITALIS makes that story visible, understandable, and actionable."**  
> **Core Architectural Invariant:** *VITALIS observes production; production NEVER depends on VITALIS.*

---

## 🌟 Overview

**VITALIS** shifts enterprise observability from static component monitoring (CPU, logs, APM dashboards) to **Request-Centric Circulatory Intelligence**:
- **Blood** = The business transaction / API request carrying vital payload context.
- **Heart** = The central Synthetic Pulse Orchestrator pumping golden health flows (Start-of-Day checks).
- **Veins & Arteries** = The network routes, API gateways, service meshes, and message brokers.
- **Organs** = Microservices, WebSphere/JBoss application servers, database clusters, and external APIs.
- **Nervous System** = Non-intrusive eBPF sensory probes & OpenTelemetry interceptors.
- **Brain** = The Request Intelligence Engine (RIE) deterministically diffing failing transactions against Golden Baselines.
- **First-Aid** = Controlled Closed-Loop Remediation Hub with sandboxed replay and auto-rollback.

---

## 🚀 Key Modules & Architecture

```
                                VITALIS BETA-1A
                                       │
                      ┌────────────────┼────────────────┐
                      ▼                ▼                ▼
               REAL TELEMETRY     EVIDENCE GRAPH     CHANGE INTELLIGENCE
               OTel + eBPF             │                    │
                      │                ▼                    │
                      └────────► REQUEST TRUTH ◄────────────┘
                                       │
                            ┌──────────┼──────────┐
                            ▼          ▼          ▼
                           RTI        WHY      WHAT NEXT
                            │          │          │
                            └──────────┼──────────┘
                                       ▼
                                HUMAN APPROVAL
                                       │
                                       ▼
                                    ACTION
                                       │
                                       ▼
                                   VERIFY
                                       │
                                  ┌────┴────┐
                                  ▼         ▼
                                SUCCESS   ROLLBACK
```

### 1. The 9-Item Product Structure
1. **`1. IT BODY`**: Living vitality & biological domain health (Login, Payments, Orders, Checkout).
2. **`2. REQUESTS`**: The Transparent Glass Vessel comparing live hops against Golden Baselines.
3. **`3. INCIDENTS`**: Start-of-Day (SOD) pre-market flight deck & failure lab.
4. **`4. EVIDENCE`**: Evidence Truth Ledger with immutable cryptographic hashes (`sha256-...`).
5. **`5. WHY?`**: 4-Part Scientific Confidence Envelope (*What We Know*, *What We Think*, *What We Don't Know*, *What Would Change Our Mind*).
6. **`6. WHAT NEXT?`**: Decision intelligence hub with sandboxed incident replays and approved runbooks.
7. **`7. CHANGES`**: Change Intelligence timeline connecting git deploys to query anomalies.
8. **`8. RTI`**: 7-Dimension Request Truth Index Matrix ($98.7\%$ weighted truth coverage).
9. **`9. SYSTEMS`**: Live circulatory particle topology & OTel/eBPF infrastructure nodes.

---

## 🧪 Verification & Acceptance Test Suites

VITALIS includes a suite of automated engineering test harnesses:

| Command | Test Suite | Description |
| :--- | :--- | :--- |
| `npm run test` | **Alpha Gates 1–5** | Validates OTLP ingestion, multi-hop reconstruction, baseline deviation, explainable scoring, and offline safety. |
| `npm run test:runner` | **Scenario Orchestrator** | Executes all 9 core enterprise failure scenarios in batch mode. |
| `npm run test:erg` | **ERG 1.0 (Gates 6–12)** | Concurrency benchmark (100K spans/sec), cardinality guard, backpressure, security, privacy audit, and chaos. |
| `npm run test:beta` | **BETA-1A Black-Box** | End-to-end black-box transaction validation with converged OTel+eBPF, unknown failure discovery, replay, and SIGKILL zero impact. |

---

## 📁 Repository Structure

```
VITALIS/
├── index.html                               # Cinematic Living IT Body & Request GUI
├── app.js                                   # Canvas Particle Engine & Multi-Persona Controller
├── styles.css                               # Glassmorphism & Cyber-Medical Styling
├── server.js                                # Native OTLP Ingestion Server (/v1/traces, metrics, logs)
├── package.json                             # Project metadata & test scripts
├── .gitignore                               # Standard git ignore rules
│
├── engine/
│   ├── dynamic_rca_engine.js                # Multi-Factor Causal Inference & Confidence Envelope
│   ├── evidence_ledger.js                   # Cryptographic Evidence Truth Ledger
│   ├── replay_engine.js                     # Sandboxed Incident Replay Engine
│   ├── remediation_state_machine.js         # 10-State Controlled Closed-Loop Remediation
│   ├── truth_model.js                       # 7-Dimension RTI & Epistemic Trust Model
│   ├── change_intelligence.js               # Temporal & Causal Lineage Correlator
│   ├── privacy_sanitizer.js                 # In-Flight Level 0-3 Data Redactor
│   ├── cardinality_indexer.js               # 7-Tier Index Stratification Guard
│   ├── request_intelligence.js              # Request Intelligence Engine (RIE)
│   └── scenarios.js                         # Golden Baseline Datasets
│
├── docs/
│   ├── BETA_1A_FIRST_TRANSACTION_SPEC.md    # Master Beta-1A Acceptance Specification
│   ├── BETA_EXIT_CRITERIA.md                # 10 Beta Exit Gates (B1 - B10)
│   ├── CINEMATIC_PRODUCT_STORYBOARD.md      # 2:55 Cinematic Product Introduction Script
│   ├── ENTERPRISE_READINESS_GATES.md        # Enterprise Readiness Gates (ERG 1.0)
│   ├── FAILURE_LABORATORY_SUITE.md          # 20 Enterprise Failure Scenarios
│   ├── ICOA_MASTER_SPECIFICATION.md         # 9-Plane Enterprise Architecture Spec
│   └── VITALIS_BETA_SPECIFICATION.md        # Heterogeneous Reference Stack Spec
│
├── tests/
│   ├── beta_1a_validation_runner.js         # Beta-1A 10-Gate Validation Harness
│   ├── erg_validation_controller.js         # Enterprise Readiness (Gates 6-12) Harness
│   ├── verify_alpha_gates.js                # Alpha (Gates 1-5) Harness
│   ├── runner.js                            # 9-Scenario Orchestrator
│   └── simulate_otlp_client.js              # Native OTLP Test Client
│
└── artifacts/                               # Machine-Readable Audit Reports
    ├── beta-1a/                             # Complete 15-file Beta-1A evidence package
    ├── alpha-gate-report.json               # Alpha Gate Acceptance Report
    ├── erg-gate-report.json                 # ERG Gate Acceptance Report
    ├── performance-benchmark-report.json    # 100K spans/sec Benchmark Report
    ├── privacy-audit-report.json            # Adversarial Privacy Scan Report
    └── chaos-resilience-report.json         # Storage Chaos Resilience Report
```

---

## 💻 Quickstart

1. **Start the Ingestion Server**:
   ```bash
   node server.js
   ```
2. **Run Full Verification**:
   ```bash
   node tests/beta_1a_validation_runner.js
   ```
3. **Open the GUI**:
   Open [`index.html`](file:///c:/Users/nirwa/Downloads/spleenofrequest/index.html) in any modern browser to experience the Living IT Organism, Multi-Persona Switcher, and Cinematic Walkthrough.
