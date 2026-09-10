# 00 — START HERE

> **Current pilot correction (2026-09-10): historical exclusivity claims in 00/01/03/17/18 are not established facts. A bounded boundary evaluator and console view now exist. AppDynamics is the primary organizational tool. Fresh FIN backend health capture and a second live Node HTTP stack were exercised; full mobile visibility, deployment attestation, live incompatible database incidents and comparative operator value remain unproven.** See [28](28_Request_Compatibility_Pilot.md) for step-by-step implementation, actual validation, limits and the comparison procedure.

**If you are a person or an agent picking up VITALIS, this is the entry point. Read this file
completely before opening anything else, running anything, or writing a line of code.**

Last updated: 2026-09-10

Architecture-led continuation: [31](31_Target_Architecture.md) is the current
module/trust/evidence architecture; [32](32_Implementation_Plan.md) is the prioritized
implementation plan; [33](33_Investigation_Implementation.md) records changes and
tests. A/B/C, D1 and [D2 storage recovery](34_Storage_Recovery_D2.md) are implemented
and verified locally. [D3 exact retries](35_Idempotent_Ingestion_D3.md) is also verified;
repeated exports keep stable evidence counts and conflicting variants stay unknown.
The rest of D and production readiness remain open. These documents supersede old sequencing and aspirational capability
claims. No production deployment or remediation has been performed.

Mobile pilot update: [29](29_Mobile_Origin_Pilot.md) records three verified isolated
mobile → backend requests, each with a Mongo CLIENT span. This proves that bounded
path only. Database SERVER spans, deployment attestation and production incident
diagnosis remain gaps. The single-operator dashboard is a long-term product outcome.

---

## 1. What this project is, in thirty seconds

**VITALIS follows a *request* — not a component — and tells you the truth about what happened to it,
including what it could not see.**

Every application takes a request and returns an output. VITALIS follows that request across every
hop, stays silent when it is healthy, and catches it at the point of deviation when it is not.

**The one thing that makes it different from every APM tool:** it is explicit about what it does
*not* know. `UNKNOWN` is a first-class answer. Gaps are shown on screen, never rendered green.

---

## 2. Read in this order

| # | Document | Why, and when to stop |
|---|---|---|
| **01** | **`01_CHARTER_read_this_first.md`** | **Non-optional.** The intention in the owner's own words, the five non-negotiables, the drift check, and the corrections on record. If you read only one file, read this. |
| 02 | `02_Thesis_and_Feasibility.md` | What is being built, the four-tier model that makes it technology-agnostic, and an honest verdict on what is and is not feasible. |
| 03 | `03_Competitive_Reality.md` | Researched market position. **Read before writing any pitch.** Contains the positioning decision that everything else depends on. |
| 04 | `04_Scene_Review.md` | Review of the 25 concept screens — which ideas are strongest, which claims will not survive scrutiny. |
| 05 | `05_Generalized_Architecture.md` | Why IBM middleware is only an example, and how any technology is onboarded. |
| 06 | `06_Architecture_Business_Case.md` | The business argument and the nine-plane architecture. |
| 07 | `07_Implementation_Roadmap.md` | The original staged plan. **Note:** the build order in `03` supersedes the sequencing here. |
| 08 | `08_Security_Assessment.md` | Security posture, verified against the code. Several findings here have since been fixed — see 10–19, 21, and 23–27. |
| 09 | `09_Internal_Adoption_Proposal.md` | How to propose this **inside an organisation that already owns APM tooling**, and the three preconditions to verify first. Strategy, not a completion log — §10 lists what it does not know. |
| 10–19, 21, 23–27 | Stage completion logs, in order | **What is actually built and proven.** Every claim has real test output behind it. `17`–`18` are the compatibility-drift capability; **`19`, `21`, `24`, `25` and `26` each record a drift or fabrication caught in this project and the gates that now prevent it — read all five before extending anything. `27` §6 lists how each of the seven was found, and none was found by reading code.** (`20` and `22` are runbooks; stage logs resume at `21` and `23`.) |
| 20 | `20_Handover_Runbook_your_actions.md` | What the owner needs to do next, and what only they can do. |
| 22 | `22_Onboarding_Any_Service_Runbook.md` | **How to point any OpenTelemetry service at VITALIS with zero code changes.** Verified for Python; commands for Java, Node and the Collector. |
| 30 | `30_Video_Production_Brief.md` | Reference material for the product film. |
| — | `../engine/adapters/ADAPTER_CONTRACT.md` | Read before writing any adapter. |

**Anything in `docs/` without a number prefix predates this structure. See §6 before trusting it.**

---

## 3. Current state — what is real, right now

**Eighteen verification suites pass.** Run `npm run test:all` from the repo root to confirm the
self-contained ones. Nothing below is asserted; every item has a completion log with real output.

| Built and proven against real infrastructure | Where |
|---|---|
| OTLP ingestion and multi-hop request assembly | 10 |
| Evidence provenance — `OBSERVED` / `CORRELATED` / `INFERRED` / `UNKNOWN` | 11 |
| Real OTel SDK ingestion with zero adapter code (Tier A) | 11 |
| Live Postgres adapter — real lock contention, real attribution | 11 |
| Operational console rendering only ingested data | 12 |
| Change correlation from real git history, incl. honest "no correlation" | 13 |
| Vulnerability → which real requests are exposed | 13 |
| Governed remediation: Ed25519 approval, two-person rule, execution off by default | 14 |
| Crash durability (survives real SIGKILL), approver enrolment | 15 |
| DB2/MQ transformation logic (connection **unverified**) | 15 |
| Trace-context propagation into a database, proven end to end | 16 |
| Compatibility drift — sourced rules, refuses unsourced ones, reports its own coverage | 17 |
| Drift scoped to a real request path; deployed-vs-source mismatch detection | 18 |
| Drift engine is technology-agnostic: npm / pip / Maven, rules as data, enforced by test | 19 |
| OTLP **protobuf** ingest — real Python/Java/Go/.NET/Collector senders now work, not just JSON | 21 |
| Drift rule packs for Python (PyPI) and Java (Spring Boot) — 40 sourced rules, 3 ecosystems | 23 |
| **Deviation judged against baselines LEARNED from real healthy traffic**, not a demo fixture | 24 |
| RCA scoring: absence of evidence can no longer raise a score or pose as contradiction | 25 |
| **Request model reports only OBSERVED facts** — no invented environment, dependencies or status | 26 |
| **A real application feeds VITALIS** — Mongo hops confirmed traced; batch-shaped traces refused | 27 |

**Known gaps, stated plainly:**

- **Live DB2 and MQ connections are unverified.** No instance was reachable. The transformation
  logic is tested; the connection path is not. Each adapter ships a `selfTest()`.
- **Live remediation is disabled and should stay disabled** until the roadmap's observe-only period
  has run with SRE and security sign-off.
- **Compatibility drift is built, joined to the request path, and technology-agnostic
  (`17`, `18`, `19`, `23`).** Remaining limits: 40 sourced rules across Expo, Python and Spring Boot
  is a beginning, not good coverage, and the UNKNOWN count says so on every run. Analysis is
  direct-dependency only (no transitive resolution), bindings are declared by hand, and nothing
  renders in the console yet.
- **A real application now feeds VITALIS (`27`).** A live FastAPI + MongoDB app, instrumented with
  zero code changes, sends real OTLP; `db.system: mongodb` hops are confirmed. The first sixty
  spans it sent exposed defect #7 — proof that `09` §9's pilot is the test, not a formality.
  Still unanswered: whether operators find `UNKNOWN` trustworthy or annoying under real pressure.
- **That app's traces are malformed at the sender**: 16 requests share one trace id, all parented
  to a span that never ends. VITALIS refuses to judge them (`27`); the cause is still unidentified
  and `bisect_instrumentation.sh` exists to find it.
- The GitHub repo is public. It must be made private before any push.
- **Internal deployment is under consideration** — see `09`. Nothing in `09` has been verified
  against the target organisation; its §10 lists the open questions.

---

## 4. Before you build anything — the five non-negotiables

Full detail in `01`. The short form, because these get violated by accident:

1. **Never fabricate.** Not observed → `UNKNOWN`. Not a plausible default, not a placeholder.
2. **Absence of evidence is not evidence of absence.** No SBOM → `UNKNOWN`, never "not affected".
3. **Provenance on every claim.** An inference is never dressed as a measurement.
4. **Show the gaps, especially in the demo.** Resisting the urge to render green *is* the product.
5. **Everything fails closed.** Missing approver, unknown action, unset flag → stop, never default.

This repository has already contained a `Math.random()` value presented as a cryptographic
signature, RCA evidence printing fixed numbers regardless of input, a benchmark report with no
benchmark, an adapter inventing message IDs, deviation measured against a hardcoded IBM demo path
(`24`), a latency ratio computed by dividing by a hardcoded 18, a confidence score that went UP when
evidence was missing (`25`), and a request model that told every real Python service it ran on
WebSphere 9.0.5 with an IBM JDK and had returned HTTP 504 (`26`). **Each looked harmless alone, and
the test suite was green through all of them.**

---

## 5. If you are an AI agent picking this up

Specific failure modes that have already happened here:

- **Do not narrow the scope to whatever application is in front of you.** This has now happened
  FOUR times: toward IBM middleware (`01` §9); toward Expo/React Native, with one application's
  folder layout hardcoded in the engine (`19`); toward JavaScript, with the OTLP ingest accepting
  only the encoding its own tests used (`21`); and worst, deviation being judged against a
  hardcoded IBM demo path, so 100% of real traffic was flagged as deviating and told operators
  their request should have gone through WebSphere (`24`). Each time the code worked perfectly on what was in front of it. **A claim of generality
  is worth nothing until something outside the original example has been run through it** — so
  before claiming any capability is technology-agnostic, name which second technology you actually
  executed against. `npm run test:stage11` now fails if application-specific strings reappear in
  the drift engine core.
- **Do not treat a "go ahead" as confirmation of your own framing.** If you proposed the direction
  and the owner agreed, that is agreement — not independent validation. Recorded in `01` §9.
- **Verify before asserting.** Run the code. Exploit the bug. Check the arithmetic. Multiple
  defects in this codebase were found only by executing things that "obviously" worked.
- **A silent empty result is not a pass.** Postgres stopped mid-run twice and produced empty output
  easily mistaken for success.
- **Every artifact must have a suite that produces it.** Eleven npm scripts once pointed at test
  files that never existed, and `artifacts/` held `PASS` reports for suites with no code.

---

## 6. Archive — predates the charter, contains superseded claims

These files remain in `docs/` for history. **They were written before the charter and contain
claims the charter now forbids** — unmeasured performance figures, RTI coverage percentages with no
generating code, and references to test suites that do not exist in the repository.

`VITALIS_EXECUTIVE_PRESENTATION.md` · `ENTERPRISE_READINESS_GATES.md` ·
`BETA_1A_FIRST_TRANSACTION_SPEC.md` · `BETA_2_ENGINEERING_PLAN.md` · `BETA_EXIT_CRITERIA.md` ·
`VITALIS_BETA_SPECIFICATION.md` · `FAILURE_LABORATORY_SUITE.md` · `ICOA_MASTER_SPECIFICATION.md` ·
`CINEMATIC_PRODUCT_STORYBOARD.md`

**Do not quote figures from these without tracing them to a test that produces them.** Where they
conflict with 01–27, the numbered documents win.

---

## 7. The sentence this project leads with

> **Your observability tool tells you what broke. VITALIS tells you what it could not see, what it
> ruled out, and what would change its mind — and it catches the version drift that makes every
> component look healthy while the request fails.**

Not *"we follow the request end to end."* That is table stakes, and it invites a comparison with
Dynatrace that this project loses. See `03`.
