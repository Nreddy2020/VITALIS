# Investigation implementation log

## 1. Architecture before implementation

Read the charter, verified pilot logs, generalized architecture, old roadmap, live
server/UI and adapter contract. Identified the actual served path and separately
identified legacy/demo modules containing fabricated defaults. Chose additive pure
investigation module plus existing API/UI integration; no new services or framework.
Wrote 31 and 32 before implementation. Verified the current OpenTelemetry trace and
HTTP semantics against official references linked in 31.

Current defects to address in the new path: span durations are summed in the UI,
missing timestamps can be represented by a historical 10ms default, ingestion order
is called first deviation, and the recommendation panel progresses a remediation
stepper from candidate existence alone. New evidence fields will avoid relying on
these legacy interpretations. Compatibility evaluation remains separately scoped.

## 2. Investigation contract and console

Added a pure generic investigation builder, decimal timestamp validation, explicit
OTel status retention, deterministic revisions, root-interval timing, request
identity checks, duplicate/conflict disclosure, gap classification and read-only
diagnostic steps. Added authenticated paginated worklist/detail APIs and the
investigation field on the existing trace API. Bounded analysis at 1,000 incoming
span observations and worklist pages at 100 records; global storage bounds remain
phase D work. No app/technology-specific assumption enters the new core.

The console now shows root duration separately from overlapping span sums, an
investigation worklist, gap-linked next steps and no inferred execution progress.
Legacy first-deviation text now identifies arrival order rather than causal order.
Functional business result stays unknown even when HTTP is 200.

`tests/verify_investigation.js`: 12 checks passed, including malformed/conflicting
identity, precision, errors, authentication/pagination, actual Node HTTP 500/200
requests and original FIN OTLP replay. `tests/verify_investigation_console.js`:
five browser checks passed, including escaped hostile sender text. The recorded
FIN current-inflation root is 358ms; its overlapping span sum is 401ms.

## 3. Regression failure and correction

The first 17-suite regression run passed 16 suites and failed the old FIN health
capture's OBSERVED_TREE assertion. Diagnosis: the protobuf decoder converted
uint64 nanoseconds to an unsafe JavaScript Number. The stricter timing validator
correctly refused that value. Changed protobuf timestamps to decimal strings so
both encodings retain precision; did not weaken the validator or assertion.
Reran the FIN health, FIN mobile and seven OTLP encoding gates successfully.

## 4. Next independent implementation

After B/C verification, selected phase D's first concrete defect: durable ingestion
could mutate memory and acknowledge success even when the journal append failed.
Address journal acknowledgment, batch framing and snapshot safety before claiming
broader repository, retention or production durability. Full phase D remains open.

## 5. D1 implementation and fault verification

Added `engine/storage/trace_journal.js`. Each ingest batch is one framed journal
record, flushed with fsync before acknowledgment or memory publication. Malformed
identity anywhere in a batch rejects the batch before publication. Write failure
returns HTTP 503 with retry indication; failed rollback requires recovery before
further writes in that process. Snapshot replacement writes/fsyncs a sibling file
then renames it before truncating the journal. Replay accepts legacy journal lines,
collapses exact retries and preserves same-ID conflicts. A new frame begins on a
fresh line so a torn previous tail cannot swallow a later acknowledged frame.

Fault tests first found two Windows behaviors: opening a directory for append could
return a handle, and an append-only handle could not truncate for rollback. Added
regular-file validation before writing and a separate write handle for rollback.
Those assertions stayed intact and then passed. The contract remains single writer;
multi-process access enforcement is D2, not an implicit guarantee.

`tests/verify_trace_journal.js` has eight passing checks: real blocked journal path,
successful retry, invalid later identity without partial batch commit, injected
partial ENOSPC, snapshot replacement failure, fsync failure, conflicting/torn-record
reconstruction, and acknowledged evidence recovered after real forced child-process
termination before any snapshot exists. Fault injection is labeled; it does not
claim testing a physically full disk or host power failure.

## 6. Final regression and handoff

One parallel validation attempt collided on port 4358 between the existing
relationship suite and browser harness. This was EADDRINUSE, not an assertion
failure. Changed the relationship test to an OS-assigned ephemeral port; all 34
assertions remain. The final 17-suite runner passes. All four browser modes pass:
five investigation, four mobile replay, three health replay and four fixtures.
The mobile replay test still verifies three actual recorded requests. External
Postgres, DB2/MQ connections, production access, load/power-loss tests and live
repair execution were not part of these checks.

The next ready item is D2 in 32. Current limitations: corrupted middle journal
frames are still skipped without a first-class health indicator; no writer lock,
retention/quota policy, persistent cases, comparable repair verification or
AppDynamics connector has been delivered. Local fsync is a stronger acknowledgment
boundary but adds synchronous I/O; no throughput claim is made without measurement.
FIN source/data/emulator were untouched during this implementation batch.

Review bundle: `tests/build_pilot_review.py E:\VITALIS --architecture` produced
`artifacts/investigation/implementation.patch` with 40 combined pilot files and
baseline/new-file hashes. `git apply --check` against the original E:\VITALIS
checkout passed; no patch was applied and nothing was committed or pushed.
The earlier pilot/mobile bundles remain separate. The updated local console is
available at http://127.0.0.1:4358 with demo key `local-pilot-test`, clearly labeled
as the real FIN capture replay. The architecture and console were opened for review.

## 7. D2 verified continuation

The limitations recorded in section 6 describe the D1 checkpoint. D2 now adds
visible corruption/recovery holds, actual OS writer exclusion, whole-batch capacity
admission and non-destructive retention review. Acceptance, design, runbook and
results are in [34](34_Storage_Recovery_D2.md). Twelve new process/API checks and four
browser checks pass, along with all prior regression and browser modes. The unused
silent replay function was removed. The original FIN/emulator were not used.
D3 retry deduplication is the next bounded repository increment; full D remains open.

## 8. D3 verified continuation

[35](35_Idempotent_Ingestion_D3.md) records implemented retry selection, conflict
preservation and the baseline ambiguity correction discovered in browser review.
Nine API/process checks and four browser checks pass; previous checks remain passing.
The replay retains 28 observations across seven traces; the three mobile requests
still contain eight spans each. No extra source traffic or emulator run was needed.

## 9. D4 measured continuation

[36](36_Local_Capacity_D4.md) records the bounded workload acceptance and actual
result. All 2,000 observations and investigation revisions survived a forced
process restart; retries added none and quota rejected new evidence. Ingest p95 was
164.3 ms with ten concurrent clients in this short local run. This informs the
decision to keep the existing single-writer pilot store; production capacity and
the rest of the implementation plan remain open.
