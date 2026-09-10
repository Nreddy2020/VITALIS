# Architecture-led implementation plan

Baseline: [31 — target architecture](31_Target_Architecture.md), 2026-09-10.
The user's instruction is to establish the architecture, then implement against
it without allowing an isolated integration problem to stop independent work.
All work stays local; original FIN, its data and development servers are separate.

## Required gate for every stage

Before implementation, record concrete acceptance criteria. Implement the stage,
run checks appropriate to its scope (including actual API/UI/integration behavior
where relevant), inspect results, fix failures and record evidence/limitations.
Proceed to the next dependent stage only after those criteria pass. Code-only or
mocked checks cannot establish runtime behavior, pending verification is not
completion, and acceptance scope must not be silently reduced. A blocked stage
records the exact missing prerequisite; only independent work may continue.
This is a verification gate, not a routine user-permission checkpoint.

| Phase | Deliverable | Exit evidence | Dependency / fallback |
| --- | --- | --- | --- |
| A — architecture | Module boundaries, evidence contract, trust/failure model, migration decisions | 31 and this plan linked from project entry point | Completed before code changes |
| B — request investigation | Preserve raw timing/status, deterministic pure investigation, gaps and diagnostic steps | Exact timing; malformed/conflicting/partial inputs remain unknown; no business-success inference | Current OTLP API; original recordings for offline replay |
| C — operator workflow | Paginated request worklist, facts and next-evidence panels, no synthetic recovery progress | Real HTTP error and success requests; browser rendering/XSS/unknown checks; original replay regression | B; existing console, no UI framework migration |
| D — evidence repository | Transactional append, exact retry dedup, conflicts retained, atomic persistence, bounded retention and capacity | Crash, disk-full, concurrent ingestion, restart and purge gates | B/C contracts; choose storage after measured local workload |
| E — cases and verification | Durable case state and decisions; structured journey contract; matched before/after evidence | Revisions prevent lost updates; incompatible captures refuse comparison; no auto-closure | D; local controlled repair experiment before external integrations |
| F — deployment/monitoring integrations | Attributed build/deploy inventory, source-specific read-only connectors, AppDynamics comparison | One authorized export/integration tested with known ground truth | Access/config required; continue E and contract tests while pending |
| G — production readiness | SSO/roles, tenant/source isolation, TLS, retention, recovery/load/security runbooks | Measured limits, independent operational review, explicit deployment authorization | D–F; cannot be inferred from local test pass |
| H — governed repair | Reviewable proposal, scoped authorization, canary/rollback, fresh verification | Authorized narrow action tested with full audit and failure recovery | G plus explicit action authorization; disabled for current work |

## Current implementation batch

Complete A, B and C as one reviewable local increment. Do not start production,
vendor-account changes or remediation. Use additive API contracts so existing
compatibility and raw trace consumers continue working. Record every implementation
change, rationale, failed test and correction in [33](33_Investigation_Implementation.md).

Acceptance checks:

1. Parallel/nested spans cannot inflate root response duration; no timing means null.
2. Missing/duplicate/conflicting identity does not create a request-level conclusion.
3. Explicit errors and HTTP status are referenced to actual spans; HTTP 200 never
   means the business operation is verified. No child-error-to-root-failure shortcut.
4. Every missing evidence class has a concrete next collection/review step; absence
   does not invent permission or expertise blockers.
5. New endpoints require existing authentication, bound responses, and return clear
   bad-query/not-found errors. Input text cannot become executable UI content.
6. Recorded FIN mobile requests and independent live Node requests exercise the
   same generic investigation implementation. Fixtures prove adversarial semantics.
7. Existing compatibility, security, ingestion, durability and browser modes retain
   their passing checks. Completion reports name skipped external checks honestly.
8. Start the verified local dashboard for review and package changes against the
   imported baseline; do not apply to original checkout, commit or push implicitly.

## Blocker policy

Progress 2026-09-10: A/B/C, D1 (durable acknowledgment and atomic snapshot) and
D2 (visible recovery, writer exclusion, capacity and preservation policy) implemented
and verified. D2 adds 12 actual API/process checks and four browser checks; the
17-suite regressions, 12 investigation and eight journal checks and all four prior
browser modes pass. See [34](34_Storage_Recovery_D2.md). Full D/E/F/G/H remain open.

D3 is also complete: [35](35_Idempotent_Ingestion_D3.md) records nine API/process
checks and four browser checks. Exact retained-evidence retries preserve storage,
age and revisions; changed same-ID variants remain conflicts. All preceding checks
pass. Next increment D4: reproducible local workload, memory/latency/capacity/recovery
measurement to inform the repository migration decision. Record acceptance and
limits before implementing the harness; no vendor/emulator dependency. Full D
still includes migration/recovery operations and eventual authorized case-aware purge.

D4 is now measured and verified in [36](36_Local_Capacity_D4.md): 200 batches / 2,000
spans at 10 concurrent clients; exact retries add zero; new evidence is refused at
quota; forced restart preserves all evidence and revisions. Retain the local
single-writer store for now. The next independent increment is the case revision
and case/evidence repository contract from E. Persistent cases require their own
atomic-write/recovery/quota/stale-update gate; production and automatic purge remain
outside the completed local repository slices. The complete plan is not yet finished.

Make a bounded attempt, preserve diagnostic evidence, then use an independent
reproduction or the contract boundary. Record a blocker as DATA, CAPABILITY,
PERMISSION or EXPERTISE only with evidence; unknown cause stays stated as unknown.
An inaccessible vendor account blocks that connector, not the architecture,
repository or operator workflow. A test failure blocks the affected exit criterion;
it cannot be bypassed by deleting or weakening the assertion. Mark phases complete
only with the concrete result. Phase D is the next dependency after this batch.
