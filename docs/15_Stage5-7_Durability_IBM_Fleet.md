# VITALIS Stages 5–7 — Closing every outstanding gap

**Date:** 2026-09-09
**Scope:** Implement everything still open across all previous stages, without pausing for approval.

Follows [[VITALIS_Stage0_Completion_Log]] through [[VITALIS_Stage4_Completion_Log]].
**All 10 verification suites pass.**

## 1. Alpha Gate 5 — fixed after being deferred since Stage 0

Diagnosed rather than guessed. An isolated reproduction proved the cause: Node's default global
agent pools keep-alive sockets, and Gate 5 deliberately restarts the server, so a socket pooled
before the restart pointed at a dead listener.

```
sharedKeepAliveAgent=true  -> ERROR ECONNRESET
sharedKeepAliveAgent=false -> HTTP 200
```

Two changes: `stopServer()` now calls `closeIdleConnections()` (correct graceful shutdown for real
clients — it sends a FIN instead of leaving pooled sockets to rot), and the test client no longer
reuses pooled sockets across a restart. Worth recording honestly: the server fix alone did **not**
resolve it — a socket not yet returned to the free pool still races — so the client fix is what
made it deterministic. **All 5 Alpha Gates now pass for the first time.**

## 2. `/api/v2/enterprise-trace` — fabrication removed

It still passed fixed values (`executionDurationMs 3982`, `lockWaitMs 2100`, `holdingLockPid 99142`,
`connectionPoolSaturationPct 98`) for every request regardless of telemetry, and defaulted to the
demo trace id. It now requires a real `?traceId=`, 404s on an unknown one, and derives everything
from ingested spans — with absent attributes left absent. Change events come from the Stage 3
correlator instead of a hardcoded "v2.4.1, 14 minutes ago".

## 3. Durability — a real data-loss window found and closed

Writing the Stage 5 test exposed a defect I had not previously noticed: `traces.json` is written on
a 500ms debounce, so a hard crash inside that window silently lost everything ingested in it. Stage
0's S4 gate had passed only on timing.

Fixed with an append-only journal: one `appendFileSync` per HTTP batch (not per span), replayed on
startup, truncated when the snapshot is rewritten, tolerant of a torn final line after a crash.
`VITALIS_DURABLE_INGEST=false` trades it back for throughput.

Stage 3 correlation state now persists too. Previously a restart emptied the correlators, so a
changed, vulnerable system reported no changes and no exposure — absence of evidence rendered as
evidence of absence.

## 4. Approver enrolment — the last named Stage 4 gap

`engine/approver_enrolment.js`: a persistent, auditable registry plus a CLI. The approver generates
their keypair locally and hands over only the public half with a fingerprint to verify out of band.
Enrolment refuses a private key, an unparseable key, a roleless approver, and an unattributable
enrolment. Revocation takes effect immediately and the record is **retained** with its reason —
deleting it would erase the fact that the identity could once approve production changes.

Signature verification is now pluggable, and gate E4 proves the wiring by substituting an external
verifier and observing it actually get called — so an HSM, smart card or SSO signer replaces local
crypto without touching a single governance rule.

## 5. IBM DB2 and MQ adapters

The old normalizers fabricated and labelled the result `OBSERVED`. `Db2Adapter.extractEvidence({})`
returned a complete, confident picture of a database nobody had looked at (invented SQL, 99.4%
buffer hit, `PROD_BANK_DB2`). `MqAdapter` was worse: an absent message id became
`MSG-${Date.now()}-${Math.random()}` — a fake primary key for a message that may never have existed,
presented as observed. Both now report only what they were given, and downgrade provenance to
`PARTIAL` naming what is missing.

New `db2_live_adapter.js` (`MON_GET_APPL_LOCKWAIT` / `MON_GET_CONNECTION` / `MON_GET_BUFFERPOOL`)
and `mq_live_adapter.js` (MQSC `DISPLAY QSTATUS` / `QLOCAL` / `CHSTATUS`).

**Scope stated plainly, in the files and in the test output:** the transformation logic is genuinely
unit-tested against realistic DB2 rows and real MQSC text, and the de-fabrication is fully proven.
The **live connection is UNVERIFIED** — no DB2 instance or queue manager was reachable. Both ship a
`selfTest()` reporting exactly which monitoring queries your instance and privileges allow. Postgres
remains the only adapter proven end-to-end against a live database.

One judgement worth noting: MQ distinguishes a queue with depth and **zero consumers** (`FAILED` —
it cannot drain at all) from one merely busy (`DEGRADED`). Those are materially different incidents.

## 6. Fleet overview — the remaining GUI modules

`GET /api/overview` and the console's new default view: incidents grouped by the hop where each
request *first* deviated, service topology with real per-service counts and averages, and coverage.
A service with no registered SBOM shows as `SBOM UNKNOWN` — **unknown, not cleared**. Verified in a
real browser (`artifacts/stage7-gui-overview.png`).

## Verification — all 10 suites

```
PASS  Alpha gates 1-5              PASS  Stage 4 governance (15 gates)
PASS  Stage 0 security             PASS  Stage 5 durability (6 gates)
PASS  Stage 1 evidence             PASS  Stage 6 IBM adapters (8 gates)
PASS  Stage 1 OTel SDK             PASS  Stage 1 Postgres (live DB)
PASS  Stage 3 correlation          PASS  Stage 2 GUI (real browser)
```

Two incidental findings during the run, recorded because a silent empty result is easily mistaken
for a pass: Postgres stopped twice in the build sandbox (environment, not code — restarted, both
suites passed), and giving the new overview button the `.trace-btn` class made the Stage 2 GUI
test's selector ambiguous. I fixed the class rather than patching the test, since the overview
button genuinely is not a trace button.

## Still outstanding — and why

- **`powershell.exe`, `push_to_github.bat`, `push_to_github.ps1` must be deleted by hand.** No tool
  in this session can delete files on that Windows device. They are correctly gitignored and never
  pushed, but they remain in the working tree.
- **`.github/workflows/secret-scan.yml` must be placed by hand.** The remote bridge refuses to write
  CI workflow files — a sensible guardrail I did not attempt to circumvent. The file is delivered.
- **Live DB2/MQ connectivity is unverified**, as above.
- **Live remediation stays disabled.** Unchanged and correct: the roadmap's 4–8 weeks of
  observe-only running with SRE and security sign-off is a matter of elapsed operational time.
