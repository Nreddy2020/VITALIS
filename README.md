# 🩸 VITALIS — The Request Truth Engine

Current implementation baseline: [architecture](docs/31_Target_Architecture.md),
[phased plan](docs/32_Implementation_Plan.md) and [change/verification log](docs/33_Investigation_Implementation.md).
The console now includes an investigation worklist, root-span timing and diagnostic
steps tied to explicit evidence gaps. Durable ingestion rejects failed journal
writes before publishing evidence. [Storage recovery and capacity](docs/34_Storage_Recovery_D2.md)
now include an exclusive process lock, bounded admission and visible recovery holds.
Use Node 24.14.1 or later with built-in `node:sqlite` available (tested on 24.14.1).
Production readiness remains unfinished.

[Exact export retries](docs/35_Idempotent_Ingestion_D3.md) now preserve counts, age
and revisions while retaining conflicts. The [local capacity measurement](docs/36_Local_Capacity_D4.md)
recovered all 2,000 acknowledged observations after a process stop. These are
bounded local checks; the complete plan remains in progress.

Current local pilot: [implementation, validation and runbook](docs/28_Request_Compatibility_Pilot.md).
Run `npm run pilot` for labeled controlled fixtures in the operator console on
http://127.0.0.1:4358 (local demo key: `local-pilot-test`). `npm run test:pilot`
checks observed boundaries, deployed identity evidence, sourced rules and unknowns.
Actual FIN health capture and a separate live Node HTTP stack are documented;
whole-application compatibility and competitive superiority are not established.
The [mobile-origin pilot](docs/29_Mobile_Origin_Pilot.md) now verifies three real
isolated FIN mobile requests through the backend to Mongo CLIENT spans. Run
`npm run pilot:mobile` for the labeled recording, or `npm run test:pilot-mobile`
to verify its raw capture hashes and parent links. Database SERVER visibility and
artifact identity remain unknown; the inflation backend used fallback data.
## The IT Circulatory Intelligence Platform

> **"Every request has a story. VITALIS makes that story visible, understandable, and actionable."**  
> **Core Architectural Invariant:** *VITALIS observes production; production NEVER depends on VITALIS.*

---

## 📍 New here? Start at [`docs/00_START_HERE.md`](docs/00_START_HERE.md)

**If you are a person or an agent picking this project up, read `docs/00_START_HERE.md` before
anything else.** It gives the reading order (`00` → `30`), what is actually built and proven right
now, the known gaps, and the failure modes that have already happened in this repository. The rest
of this README assumes you have read it.

---

## ⚓ Before you change anything — the intention

**The request is the unit of truth — not the component.**

Every application takes a request and returns an output. VITALIS follows *that request*, stays
silent when it is healthy, and catches it at the point of deviation when it is not. Every claimed
benefit — faster recovery, fewer downtimes, avoided escalations, migration and compatibility
confidence — is a consequence of that one idea, not a separate feature.

**WebSphere, IHS, DB2 and MQ are examples in this repository. They are not the product.** VITALIS
is technology-agnostic by contract (see `engine/adapters/ADAPTER_CONTRACT.md`). If you read this
code and conclude it is an IBM middleware tool, you have misread it.

### The five non-negotiables

1. **Never fabricate.** If it was not observed, it is `UNKNOWN` — not a plausible default, not a
   placeholder, not a reasonable estimate.
2. **Absence of evidence is not evidence of absence.** A service with no SBOM is `UNKNOWN`, never
   "not affected". A hop with no telemetry is a gap shown on screen, never a green tick.
3. **Provenance on every claim** — `OBSERVED` / `CORRELATED` / `INFERRED` / `UNKNOWN`. An inference
   is never dressed as a measurement.
4. **Show the gaps, especially in the demo.** The pressure to make every panel green will be real
   and constant. Resisting it is the product.
5. **Everything fails closed.** Missing approver, unknown action, unset flag, unmeasured outcome —
   each stops the machine rather than defaulting to something permissive.

This repository has already contained a `Math.random()` value presented as a cryptographic
signature, RCA evidence printing fixed numbers regardless of input, a benchmark report with no
benchmark behind it, and an adapter inventing message IDs. Each looked harmless alone. Together
they would have destroyed the only claim this product actually has.

**Before adding anything, ask:** can every number on this screen be traced to something observed?
If we do not know something, does the screen say so — or does it quietly render green?

> The full charter — positioning, build order, what must never be claimed, and the corrections on
> record — is `docs/01_CHARTER_read_this_first.md`. **Read it before any significant change.**

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
8. **`8. RTI`**: 7-Dimension Request Truth Index Matrix. *(The 98.7% figure previously quoted here
   came from an artifact file with no generating code — it was never measured. The RTI model exists
   in `engine/truth_model.js`; any coverage number should come from running it against your own
   telemetry.)*
9. **`9. SYSTEMS`**: Live circulatory particle topology & OTel/eBPF infrastructure nodes.

---

## 🧪 Verification & Acceptance Test Suites

VITALIS includes a suite of automated engineering test harnesses:

| Command | Test Suite | Description |
| :--- | :--- | :--- |
| `npm run test` | **Alpha Gates 1–5** | Validates OTLP ingestion, multi-hop reconstruction, baseline deviation, explainable scoring, and offline safety. |
| `npm run test:security` | **Stage 0 Security Gates** | Auth, oversized-payload rejection, PII/secret redaction, and disk persistence surviving a real process kill. |
| `npm run test:stage1-evidence` | **Stage 1 Evidence Honesty Gates** | Proves RCA evidence cites real ingested attribute values and renders missing ones as explicit `UNKNOWN`, never fabricated. |
| `npm run test:stage1-otel` | **Stage 1 Tier A Proof** | Proves the real `@opentelemetry/sdk-trace-node` package can talk to VITALIS with zero adapter code — no infrastructure required beyond Node. |
| `npm run test:stage1-pg` | **Stage 1 Tier B Proof** | Proves `engine/adapters/postgres_adapter.js` against a **live Postgres instance**: opens a real row lock, a real second connection genuinely blocks behind it, and the adapter/RCA pipeline reports it honestly. Requires `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` pointing at a reachable Postgres. |
| `npm run test:stage4` | **Stage 4 Governance Gates** | The harshest suite in the project, because remediation is the only thing that can call a real control-plane API. Exploits the quarantined original module to prove its six defects were real, then proves each is closed: real Ed25519 approval, tampered/forged/replayed/expired approvals rejected, RBAC enforced, allowlist and risk class enforced, illegal transitions refused, execution off by default, outcomes measured with automatic rollback, and the two-person rule (including that the same person signing twice does not satisfy it). Self-contained; included in `test:all`. |
| `npm run test:stage5` | **Stage 5 Durability & Enrolment** | Kills a REAL server process with SIGKILL and proves change events, component inventories and advisories all survive; proves the approver enrolment round-trip, that enrolment refuses private keys/roleless/unattributable input, that revocation takes effect while the record is retained, and that a pluggable external verifier is genuinely used. Self-contained; in `test:all`. |
| `npm run test:stage6` | **Stage 6 IBM Adapters** | Proves the DB2 and MQ normalizers no longer fabricate, and that the raw-telemetry → OTel transformation is correct (DB2 `MON_GET_*` rows, real MQSC output). **Does not** prove live DB2/MQ connectivity — no instance was reachable. Self-contained; in `test:all`. |
| `npm run test:stage3` | **Stage 3 Correlation Gates** | Creates a **real git repo with real commits** and reads them with real `git log`; installs a **real vulnerable dependency** and runs a **real `npm audit`** against the real registry. Proves change correlation, that it can honestly say "no change correlates", real advisory ingestion, request-level exposure mapping, and that a service with no SBOM is `UNKNOWN` rather than "safe". Needs npm registry access. |
| `npm run test:stage8` | **Stage 8 Propagation** | Proves trace-context propagation end-to-end against a **live Postgres**: two sessions each stamp a different real trace id on their connection, one genuinely blocks the other, and the adapter recovers the blocked session's *own* trace id from the database — ignoring the id the caller passed in. Also proves MQMD CorrelId and W3C traceparent round-trips, and that an unpropagated session is reported UNATTRIBUTED rather than given a borrowed id. Requires a reachable Postgres. |
| `npm run test:stage2-gui` | **Stage 2 GUI Gates** | Drives the console in a **real Chromium browser** (Playwright) against real Postgres lock contention: proves the honest empty state, a live SSE update with no page reload, the absence of the old hardcoded demo values, and `UNKNOWN` rendering for unreported evidence. Writes screenshots to `artifacts/`. Requires `npm i -D playwright` plus a reachable Postgres. |

> **Only the suites listed above exist.** Earlier revisions of this README advertised an ERG 1.0
> gate set, a scenario orchestrator and a BETA-1A black-box runner, and `package.json` had npm
> scripts for them — but those test files were never in the repository, so the scripts failed with
> MODULE_NOT_FOUND. The dead scripts and rows have been removed rather than left to imply coverage
> that does not exist. `artifacts/performance-benchmark-report.json` came from the same place: it
> reports a 100K spans/sec figure that no code in this repository produces, and should be deleted
> rather than quoted.

---

## 📁 Repository Structure

```
VITALIS/
├── index.html                               # Stage 2 operational console — live, real-data only
├── demo_cinematic.html                      # Preserved cinematic demo (video/presentation asset)
├── app.js                                   # Canvas Particle Engine (used by the cinematic demo)
├── styles.css                               # Glassmorphism & Cyber-Medical Styling
├── server.js                                # OTLP Ingestion + GUI API (/v1/*, /api/traces, /api/stream)
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
├── docs/                                    # Read in number order. 00 is the entry point.
│   ├── 00_START_HERE.md                     # ← START HERE. Reading order + current state
│   ├── 01_CHARTER_read_this_first.md        # Intention, non-negotiables, corrections on record
│   ├── 02_Thesis_and_Feasibility.md         # What is built, the four-tier model, honest verdict
│   ├── 03_Competitive_Reality.md            # Researched market position + positioning decision
│   ├── 04_Scene_Review.md                   # Review of the 25 concept screens
│   ├── 05_Generalized_Architecture.md       # Why IBM middleware is only an example
│   ├── 06_Architecture_Business_Case.md     # Business argument, nine-plane architecture
│   ├── 07_Implementation_Roadmap.md         # Original staged plan (03 supersedes sequencing)
│   ├── 08_Security_Assessment.md            # Security posture, verified against the code
│   ├── 10_Stage0_Security_Hardening.md      # ┐
│   ├── 11_Stage1_Real_Adapters.md           # │
│   ├── 12_Stage2_Console.md                 # │ Completion logs — what is actually
│   ├── 13_Stage3_Change_and_Vulnerability.md# │ built and proven, with real test output
│   ├── 14_Stage4_Governed_Remediation.md    # │
│   ├── 15_Stage5-7_Durability_IBM_Fleet.md  # │
│   ├── 16_Stage8_Trace_Propagation.md       # ┘
│   ├── 20_Handover_Runbook_your_actions.md  # What only the owner can do next
│   ├── 30_Video_Production_Brief.md         # Product film reference material
│   └── (unnumbered files)                   # ARCHIVE — pre-charter, superseded claims. See 00 §6
│
├── tests/                                   # Every file here is a real, runnable suite
│   ├── verify_alpha_gates.js                # Alpha Gates 1-5
│   ├── verify_security_gates.js             # Stage 0 security
│   ├── verify_stage1_evidence_gates.js      # Evidence honesty
│   ├── verify_stage1_otel_sdk_proof.js      # Tier A — real OTel SDK
│   ├── verify_stage1_postgres_adapter_gate.js # Tier B — live Postgres
│   ├── verify_stage2_gui_gates.js           # Console, real browser
│   ├── verify_stage3_correlation_gates.js   # Change + vulnerability correlation
│   ├── verify_stage4_governance_gates.js    # Governed remediation
│   ├── verify_stage5_durability_gates.js    # Crash durability + approver enrolment
│   ├── verify_stage6_ibm_adapter_gates.js   # DB2/MQ transformation
│   └── verify_stage8_propagation_gates.js   # Trace-context propagation into a database
│
└── artifacts/                               # Reports written BY the suites above
    ├── alpha-gate-report.json
    ├── security-gate-report.json
    ├── stage1-*.json, stage2-*.json, ... stage6-*.json
    └── stage2/3/7-gui-*.png                 # Screenshots captured by the browser gates
```

> **Every artifact must have a suite that produces it.** The repository previously carried
> `erg-gate-report.json`, `chaos-resilience-report.json`, `privacy-audit-report.json`,
> `performance-benchmark-report.json` and five `beta-*/` evidence folders — all asserting `PASS`
> and citing precise metrics, none with any generating code in the repository. They read as
> measured evidence and were not. They have been removed. If you want those claims back, write the
> suite first and let it write the report.

---

## 🔐 Configuration (Stage 0 security hardening)

Every ingestion and API endpoint now requires an API key. Copy `.env.example` to `.env`
(already gitignored) and set at least:

```bash
VITALIS_API_KEY=choose-a-real-secret-here
```

If `VITALIS_API_KEY` is left unset, the server generates a random key at boot and prints
it once to the console — fine for a solo local demo, not fine for anything another
person or system can reach. See `docs/08_Security_Assessment.md`
and `docs/07_Implementation_Roadmap.md` (Stage 0) for the full rationale.

Send the key on every request to a protected endpoint:

```bash
curl -H "x-vitalis-api-key: $VITALIS_API_KEY" http://localhost:4318/health
```

(`/health` itself is intentionally public, for load balancers and uptime checks.)

## 🔌 Stage 1: real instrumentation adapters

`engine/adapters/ADAPTER_CONTRACT.md` documents how VITALIS generalizes beyond this project's
original IBM-middleware demo stack to any real technology, in two tiers:

- **Tier A — zero adapter code.** Anything already instrumented with real OpenTelemetry can POST
  straight to `/v1/traces`. Proven against the actual `@opentelemetry/sdk-trace-node` package
  (not a hand-shaped fixture) by `npm run test:stage1-otel`.
- **Tier B — a small adapter, same contract.** `engine/adapters/postgres_adapter.js` is a real,
  working example: it queries live Postgres system views (`pg_stat_activity`, `pg_locks`,
  `pg_blocking_pids()`) for genuine lock contention and connection-pool saturation, and reports
  it as a standard OTel span. Proven end-to-end — real row lock, a real second connection
  genuinely blocking behind it, real RCA output — by `npm run test:stage1-pg` against a reachable
  Postgres instance.

Both proofs also cover a real bug they found and fixed: `evaluateTrace()` originally identified a
"database" hop only by its resource-level `service.name`, which silently missed any real
single-process application (one OTel resource, many internal spans distinguished by span
attributes, not separate service names). It now also checks the standard `db.system` semantic
attribute and the span name, so both Tier A and Tier B traffic are recognized correctly — see
`ADAPTER_CONTRACT.md` for the full detail.

No real WebSphere/DB2/MQ instance is reachable from this development environment, so a
`db2_adapter.js`/`mq_adapter.js` built the same way against your actual infrastructure is Stage 1
work still ahead — the Postgres adapter proves the pattern works against a real, live database
of the same general kind.

## 🖥️ Stage 2: the operational console

`index.html` is the production console. It is wired to the live engine and renders **only what
was actually ingested** — there is no hardcoded transaction, no scripted narrative, and no
simulated metric anywhere in it. With an empty engine it says so plainly rather than showing
demo data.

Two endpoints exist specifically to make that possible:

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/traces` | Lists every trace actually held by the engine (id, hop count, duration, status, services). Without it the UI could only display a trace whose ID you already knew — which is exactly why the old front end had `TX-847392` hardcoded. |
| `GET /api/stream` | Server-Sent Events; pushes a frame whenever real spans are ingested, so panels update live. |

The console consumes the stream with `fetch()` + `ReadableStream` rather than `EventSource`,
deliberately: `EventSource` cannot set request headers, which would have forced the API key into
the query string, where it lands in access logs, proxy logs and browser history. Streaming over
`fetch` keeps the Stage 0 header-based auth model intact with no new credential-exposure path.

The persona switcher (Executive / Operations / App Engineer) filters the *same real data* —
the Executive view hides engineering internals rather than telling a different story about the
same incident, and the scoring arithmetic is shown only to the App Engineer view.

The previous cinematic demo is preserved unchanged as **`demo_cinematic.html`** — it is the asset
the product video and presentation storyboards were built from, and it is still openable directly.
It is a narrative demo, not an operational view, and it is no longer what the server serves at `/`.

## 🔗 Stage 3: change intelligence & vulnerability exposure

Two questions no dependency scanner or monitoring tool answers on its own, because neither holds
the requests:

**"Did a change cause this?"** — `engine/adapters/git_change_adapter.js` reads real commits from a
real repository with real `git log` (a CI/CD webhook or change-management feed maps to the same
shape) and POSTs them to `/v1/changes`. `engine/change_correlator.js` then correlates them against
the *real observed time* of a request. It returns nothing when nothing qualifies — there is no
nearest-change fallback — and every match is labelled `CORRELATED`, with an explicit statement
that temporal proximity is not proof of causation.

> The previous `engine/change_intelligence.js` was a demo module that held two hardcoded change
> events, returned `hasChangeCorrelation: true` unconditionally, and ended its lookup with
> `|| this.changeEvents[0]` — so it could never fail to name a cause. Nothing referenced it; it is
> now a deprecation stub that throws.

**"Does this CVE actually affect us?"** — `engine/adapters/npm_audit_adapter.js` runs a real
`npm audit` against the real npm registry and reads the project's real installed component list,
POSTing both to `/v1/vulnerabilities` and `/v1/components`. `GET /api/impact/:advisoryId` then
answers the operational question: **which real ingested requests actually traversed a service
running the affected component.** Any scanner mapped to the same advisory shape (Trivy, Grype,
Snyk, OWASP Dependency-Check, an OSV.dev query, a vendor SBOM) plugs in identically.

A deliberate safety rule: a service seen in telemetry whose component inventory VITALIS has never
been given is reported as **`UNKNOWN` coverage, never as "not affected"**. Absence of an SBOM is
not evidence of safety, and conflating the two is how real exposure gets missed.

| Endpoint | Purpose |
| :--- | :--- |
| `POST /v1/changes` | Ingest real change events (commits, deploys, config/cert changes). |
| `POST /v1/components` | Register a service's real component inventory (SBOM slice). |
| `POST /v1/vulnerabilities` | Ingest real advisories from any scanner. |
| `GET /api/impact/:advisoryId` | Real requests exposed to one advisory. |
| `GET /api/impact` | Every ingested advisory ranked by real observed exposure. |

Both surface in the console's **Changes & Exposure** tab.

**Not built:** F5 / firewall appliance integration (`iControl REST`, flow-log 5-tuple correlation)
from the roadmap's Stage 3 — that needs real appliances, which this environment has none of.

## 🛡️ Stage 4: governed remediation (execution OFF by default)

Remediation is the only part of VITALIS that could ever call a real control-plane API, so it is
built last and gated hardest. **Nothing executes unless you explicitly turn it on**, and even then
only within a narrow allowlist.

The module this replaces was genuinely dangerous, and the replacement's test suite proves it by
exploiting it rather than asserting it. `engine/remediation_state_machine.js` had six defects:

| # | Defect | Now |
|---|---|---|
| 1 | `signature: sig-${Math.random()...}` presented as a cryptographic signature | Real Ed25519 signature, verified against a registered public key VITALIS never holds the private half of |
| 2 | `approve(operatorId = "sre-lead@bank.corp")` — approval defaulted to the SRE lead and verified nothing | Approval is cryptographically bound to a specific incident, action, target and change ticket |
| 3 | No transition guards — `execute()` ran straight from `DETECTED`, skipping approval | Legal-transition table; `EXECUTING` is reachable only from `APPROVED` |
| 4 | The tamper-evident ledger was passed in and never written to | Every transition is appended to the hash-chained ledger |
| 5 | `verifyPostAction(isHealthy = true)` — assumed success | Requires a real health-check function; anything other than an explicit healthy result rolls back |
| 6 | `assessRisk(riskLevel = "LOW")` — assumed low risk | Risk is read from the action definition; `HIGH` or irreversible actions are refused outright |

The unsafe module is quarantined: its original path now throws, and the preserved copy under
`engine/_deprecated/` exists only so gate D0 can keep proving the defects were real.

**Governing principle: every gate fails closed.** A missing approver, an unknown action, an unset
flag, an unmeasured outcome — each stops the machine rather than defaulting to something permissive.

- `engine/remediation_actions.js` is the allowlist. An action not defined there cannot be approved
  or executed no matter how valid the approval is. The first enabled actions are deliberately
  narrow and reversible (restart one named connection pool, flush one named cache). Terminating a
  database session — the action the original demo proposed *first* — is defined as `HIGH` risk and
  irreversible, so the machine will recommend it to a human and refuse to auto-execute it.
- `engine/approval_authority.js` verifies real signatures, enforces RBAC, requires a valid change
  ticket, and refuses replayed or expired approvals.
- **Two-person rule (segregation of duties).** Each action declares `minApprovals`. `MEDIUM`-risk
  actions require **two distinct humans** to each sign independently. The same person signing twice
  — even with two perfectly valid signatures and two fresh nonces — is rejected, which is the whole
  point of the control: one compromised key or one person's bad judgement must not be sufficient on
  its own. A partially-approved action stays in `AWAITING_APPROVAL` and the partial approval is
  still written to the audit ledger.
- `engine/governed_remediation.js` enforces the state machine and writes the audit trail.

To enable live execution — only after Stages 0–3 have run in observe-only mode for 4–8 weeks with
SRE and security sign-off, per the roadmap — set `VITALIS_ALLOW_REMEDIATION=true` **and** register
a real executor. With the flag unset, a perfectly valid approval still only produces a dry run, and
no control-plane function is called.


## 🧱 Durability, enrolment, IBM adapters and the fleet view

**Durability.** Ingested spans are appended synchronously to an append-only journal
(`ingest-journal.ndjson`) as well as being snapshotted to `traces.json` on a 500ms debounce. The
snapshot batching is good for throughput and bad for durability — a hard crash inside the debounce
window used to silently lose everything ingested in it. The journal closes that window: one
`appendFileSync` per HTTP batch (not per span), replayed on startup, truncated when the snapshot is
rewritten. Set `VITALIS_DURABLE_INGEST=false` to trade the durability back for throughput.
Stage 3 correlation state (change events, component inventories, advisories) now persists too —
previously a restart emptied the correlators, so a changed, vulnerable system reported no changes
and no exposure. Absence of evidence rendered as evidence of absence is exactly the failure this
project exists to prevent.

**Approver enrolment** (`engine/approver_enrolment.js`). A persistent, auditable registry of who
may approve what, plus a CLI:

```bash
# On the APPROVER's machine — the private key never leaves it
node engine/approver_enrolment.js request sre-lead@corp.com sre,sre-lead
# On the VITALIS host, after verifying the fingerprint out of band
node engine/approver_enrolment.js enrol sre-lead@corp.com ./key.pub sre,sre-lead security-admin@corp.com
node engine/approver_enrolment.js revoke sre-lead@corp.com security-admin@corp.com "left the rotation"
node engine/approver_enrolment.js list
```

Enrolment refuses a private key, an unparseable key, a roleless approver, and an enrolment nobody
is accountable for. Revocation takes effect immediately and the record is **retained** with its
reason — deleting it would erase the fact that the identity could once approve production changes.
Signature checking goes through a pluggable verifier, so an HSM, smart card or SSO-backed signing
service replaces `LocalEd25519Verifier` without touching a single governance rule.

**IBM DB2 and MQ adapters.** `engine/adapters/db2_live_adapter.js` (DB2 `MON_GET_APPL_LOCKWAIT` /
`MON_GET_CONNECTION` / `MON_GET_BUFFERPOOL`) and `engine/adapters/mq_live_adapter.js` (MQSC
`DISPLAY QSTATUS` / `QLOCAL` / `CHSTATUS`).

> **Scope, stated plainly:** the transformation logic in both is genuinely unit-tested, and the old
> fabricating normalizers are fixed. The **live connection is UNVERIFIED** — no DB2 instance and no
> queue manager was reachable where these were written. Run each adapter's `selfTest()` against your
> own infrastructure before trusting it; it reports exactly which monitoring queries your instance
> and privileges actually allow. The Postgres adapter remains the only one proven end-to-end
> against a live database.

MQ correlation depends on your application propagating the trace id through the MQMD correlation id
(or an RFH2 `usr` folder). Without that, MQ hops can be observed but not tied to a specific request,
and the adapter simply omits the linkage rather than inventing one.

**Fleet overview** (`GET /api/overview`, and the console's default view). Incidents grouped by the
hop where each request *first* deviated, service topology with real per-service hop counts and
averages, and coverage: which services VITALIS has an SBOM for. A service without one is shown as
`SBOM UNKNOWN` — **unknown, not cleared**.


## 🔗 Trace-context propagation — turning "a lock" into "*this* request"

This is the difference between observing a database hop and *attributing* it. Without propagation,
VITALIS can say a query was blocked; with it, VITALIS can say **which customer request** was blocked
and **which other request** was holding the lock.

DB2 and MQ do not carry W3C `traceparent` headers, but each exposes a field the application controls
and the monitoring surface reports back:

| System | Field the app stamps | Where VITALIS reads it back |
| :--- | :--- | :--- |
| DB2 | `CLIENT_APPLNAME` / `CLIENT_ACCTNG` | `MON_GET_CONNECTION` |
| Postgres | `application_name` | `pg_stat_activity` |
| IBM MQ | MQMD `CorrelId` (24 bytes) | queue monitoring |

`engine/trace_context.js` is the encode/decode pair for all three. In your application:

```js
const tc = require('./engine/trace_context');
// pg
new Client({ ...cfg, ...tc.dbConnectionOptionsForTrace(traceId, { appLabel: 'checkout-svc' }) });
// ibm_db — same call, driver: 'ibm_db' (CLIENTAPPLNAME / CLIENTACCTSTR)
// MQ — put tc.encodeTraceForMqCorrelId(traceId, spanId) into MQMD.CorrelId
```

The encoding is `vt=<32 hex>` prefixed by an optional short app label, and it fits inside Postgres's
63-byte `application_name` limit with room to spare. The **decode side fails closed**: a foreign,
truncated or corrupt value returns `undefined` rather than a plausible-looking trace id, because
attributing a lock to the *wrong* request is worse than admitting it is unattributed. A session that
propagates nothing is reported as unattributed — still observed, just not attributed.

Proven end-to-end against a live Postgres by `npm run test:stage8`, which is meaningful for DB2 too:
`application_name` is the exact analogue of `CLIENT_APPLNAME`, and both go through the same decode path.

## 💻 Quickstart

1. **Start the Ingestion Server**:
   ```bash
   VITALIS_API_KEY=choose-a-real-secret-here node server.js
   ```
2. **Run Full Verification** (functional gates, then Stage 0 security gates):
   ```bash
   node tests/beta_1a_validation_runner.js
   node tests/verify_security_gates.js
   ```
3. **Open the console**:
   Browse to **http://localhost:4318/** (serve it from the running server — do not open the file
   directly, or its API calls have no origin to talk to). Paste your `VITALIS_API_KEY` into the
   key field and press **Connect**. With nothing ingested yet it will honestly say so and show you
   the exact `curl` to send a span; once telemetry arrives the view populates live.

   For the narrative product walkthrough used in the video/presentation material, open
   `demo_cinematic.html` directly in a browser.
