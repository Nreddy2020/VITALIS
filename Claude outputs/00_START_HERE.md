# 00 — START HERE

**If you are a person or an agent picking up VITALIS, this is the entry point. Read this file
completely before opening anything else, running anything, or writing a line of code.**

Last updated: 2026-09-09

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
| 08 | `08_Security_Assessment.md` | Security posture, verified against the code. Several findings here have since been fixed — see 10–16. |
| 10–16 | Stage completion logs, in order | **What is actually built and proven.** Every claim has real test output behind it. |
| 20 | `20_Handover_Runbook_your_actions.md` | What the owner needs to do next, and what only they can do. |
| 30 | `30_Video_Production_Brief.md` | Reference material for the product film. |
| — | `../engine/adapters/ADAPTER_CONTRACT.md` | Read before writing any adapter. |

**Anything in `docs/` without a number prefix predates this structure. See §6 before trusting it.**

---

## 3. Current state — what is real, right now

**Eleven verification suites pass.** Run `npm run test:all` from the repo root to confirm the
self-contained ones. Nothing below is asserted; every item has a completion log with real output.

| Built and proven against real infrastructure | Where |
|---|---|
| OTLP ingestion, multi-hop request assembly, golden-baseline deviation | 10 |
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

**Known gaps, stated plainly:**

- **Live DB2 and MQ connections are unverified.** No instance was reachable. The transformation
  logic is tested; the connection path is not. Each adapter ships a `selfTest()`.
- **Live remediation is disabled and should stay disabled** until the roadmap's observe-only period
  has run with SRE and security sign-off.
- **Compatibility drift (Scene 23) is not built** — and per `03`, it is the highest-value next thing.
- The GitHub repo is public. It must be made private before any push.

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
benchmark, and an adapter inventing message IDs. **Each looked harmless alone.**

---

## 5. If you are an AI agent picking this up

Specific failure modes that have already happened here:

- **Do not narrow the scope to IBM.** WebSphere/DB2/MQ are examples. This drift happened once
  already and was caught late. See `01` §9.
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
conflict with 01–16, the numbered documents win.

---

## 7. The sentence this project leads with

> **Your observability tool tells you what broke. VITALIS tells you what it could not see, what it
> ruled out, and what would change its mind — and it catches the version drift that makes every
> component look healthy while the request fails.**

Not *"we follow the request end to end."* That is table stakes, and it invites a comparison with
Dynatrace that this project loses. See `03`.
