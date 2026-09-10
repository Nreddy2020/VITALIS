# D2 — storage visibility, writer exclusion and bounds

## Acceptance criteria recorded before implementation

1. Corrupt snapshot, invalid complete journal frame and torn final frame are visible
   through authenticated storage status and the actual operator console. Intact
   observations remain inspectable; affected files are preserved. Recovery-required
   state refuses new mutations and compaction rather than silently rewriting damage.
2. Two actual server processes cannot write one data directory simultaneously. The
   losing process reports a concrete writer-lock error and does not change evidence.
   The winner continues operating. Graceful stop and forced termination release the
   operating-system lock so a later process can recover without guessing a stale PID.
3. Explicit trace-count, observation-count, serialized-trace-byte, journal-byte and
   auxiliary-signal limits are enforced before publication, including across restart.
   Rejection names the exhausted limit and does not partially commit the batch.
   Runtime bounds are configuration, not measured production capacity claims.
4. A retention horizon marks old locally received evidence as REVIEW_REQUIRED;
   unknown receive times are held. There is no automatic deletion or purge endpoint.
   All evidence is held, including evidence that may later belong to a case. This
   non-destructive policy satisfies the present preservation instruction; automatic
   case-aware purge remains a later explicitly authorized repository feature.
5. Startup reading is bounded. A file over its configured limit is preserved and
   reported as blocked for recovery/configuration review, not loaded without limit.
6. Relevant existing restart, journal, ingestion, investigation and browser checks
   pass. New checks include real concurrent processes, actual corrupt files, quota
   rejection and restart, retention reporting and UI behavior. Record failures and
   corrections before marking D2 complete or starting a dependent stage.

Scope: current isolated VITALIS worktree and disposable test data only. Original
E:\VITALIS, FIN source/data/emulator, recorded capture evidence and production systems
remain untouched. Defaults must be generous enough for the existing local capture,
but never unlimited. A rejected write is preferable to unannounced evidence removal.

## Implemented decisions and recovery procedure

`engine/storage/storage_policy.js` owns file inspection, admission, retention status
and an exclusive process lock. Authenticated `GET /api/storage` and the console
expose the same recovery state, usage, configured limits and last rejection. Invalid
frames include their filename, line and SHA-256; raw damaged content is not rendered.
Up to 30 issue details are returned with the complete issue count. Intact records
remain readable unless loading them would exceed the configured memory-data bound.
No write, snapshot compaction or shutdown flush overwrites damaged evidence.

The writer lock is a held SQLite `BEGIN IMMEDIATE` transaction in `writer-lock.sqlite`.
It stores no trace data. This uses [Node's built-in SQLite API](https://nodejs.org/api/sqlite.html)
and [SQLite's file locking](https://www.sqlite.org/lockingv3.html), verified with actual
Node 24.14.1 processes on Windows. That runtime emits an experimental SQLite warning.
Use a dedicated local filesystem directory and one server instance per process;
network filesystem locking and non-cooperating external file writers are outside
this contract. A crash releases the OS lock. Never delete the lock file to bypass a
running writer. No package installation or database migration was required.

| Environment setting | Default | What it bounds |
| --- | ---: | --- |
| `VITALIS_MAX_TRACES` | 10,000 | Retained trace IDs |
| `VITALIS_MAX_SPANS` | 100,000 | Retained span observations, including conflicts |
| `VITALIS_MAX_TRACE_BYTES` | 32 MiB | Serialized trace map / snapshot input |
| `VITALIS_MAX_JOURNAL_BYTES` | 16 MiB | Journal file and proposed append |
| `VITALIS_MAX_STORAGE_BYTES` | 128 MiB | Flat regular files in the dedicated directory, reserving a full replacement snapshot |
| `VITALIS_MAX_AUX_BYTES` | 8 MiB | Each correlation snapshot or combined in-memory metrics/logs |
| `VITALIS_MAX_AUX_RECORDS` | 10,000 | Combined top-level metrics/log resource records |
| `VITALIS_RETENTION_MS` | 2,592,000,000 | 30-day local receive-age review horizon |

Limits must be positive safe integers. They are admission settings, not a benchmark
or total process RSS measurement. Directory quota does not recursively inventory
unrelated subdirectories. Metrics/logs remain bounded but non-durable. Correlation
updates stage a candidate and persist before publication, so rejection cannot leave
a partial in-memory change. Evidence past its horizon or with unknown receive age is
held; no automatic deletion, case purge or data migration endpoint was added.

On `RECOVERY_REQUIRED`, preserve copies of the cited files first. Inspect the cited
frames in an isolated copy, recover from an independently verified backup or repair
the copy, and validate it with the same status/ingestion/restart checks before any
replacement is authorized. The product does not guess which corrupt bytes to erase.
On capacity rejection, review `/api/storage` and configured capacity; do not blindly
retry or remove evidence. An I/O-path failure retains D1's retryable 503 after the
underlying path problem is fixed. Corruption/capacity 503 responses identify their
required prerequisite. `/health` remains liveness; `/api/storage` is storage health.

## Verification and deliberate tightening of D1

`verify_storage_policy.js`: 12 passing checks with actual HTTP servers, independent
writer processes, forced process death, real corrupt files, quota rejection before
publication, restart and retention holds. `verify_storage_console.js`: four passing
Chrome checks. Both saved screenshots were visually inspected: recovery is visible
even with zero loaded requests; quota reason and held evidence remain readable.
Reports/screenshots are in `artifacts/storage-d2`.

D1 previously recovered intact records and allowed appending after a torn tail. D2
intentionally tightens that policy: intact evidence is readable but new writes are
503 until recovery. The earlier journal check was strengthened to assert rejection
and exact preservation of the damaged bytes. Removed the unused legacy replay
function that silently skipped invalid frames. No acceptance criterion was dropped.

Existing verification also passes: all 17 pilot regression suites, 12 investigation
checks, eight journal checks, and browser modes (five investigation, four mobile
replay, three health replay, four controlled fixture checks). Test fixtures and fault
injection are labeled. Host power loss, production load, replicated recovery and
automatic case-aware purge remain unverified/unfinished. Admission currently scans
bounded files synchronously; throughput must be measured before production use.

Review packaging: `tests/build_pilot_review.py E:\VITALIS --storage` creates a
combined 44-file bundle in `artifacts/storage-d2`; older bundles remain separate.
Only `git apply --check` is authorized against the original checkout, not applying it.
D2 is complete for the acceptance scope above. D3 exact retry admission is next.
