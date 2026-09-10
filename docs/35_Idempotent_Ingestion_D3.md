# D3 — exact retained-evidence retries

## Acceptance criteria recorded before implementation

1. Exact retained-evidence retries, including repeats within one HTTP batch, add no
   journal bytes or observations, consume no new quota, preserve original receive
   age and investigation revision, and emit no new-evidence event or baseline sample.
2. Identity is trace ID plus span ID plus all retained sanitized evidence. Ignore
   only local receive time and its legacy derived observation time. Object key and
   span attribute order do not change identity; ordered attribute-value arrays do.
   A comparison is scoped to retained evidence, not raw payload equality or sender
   attestation. Do not retain raw secrets or claim dedup covers discarded OTLP fields.
3. Changed evidence with the same IDs remains a separate conflicting observation;
   no last-write-wins overwrite. Its investigation remains uncertain and changes
   revision. Retrying each conflicting variant independently is idempotent.
4. Actual HTTP concurrent retries and retries after graceful and forced-process
   restart remain idempotent. Legacy snapshot/journal observations are preserved;
   compare them conservatively without silently migrating or deleting historical rows.
5. Validate the whole input before dedup/publication. Mixed duplicate/new batches
   admit all new evidence atomically or reject it without partial changes. A pure
   retry at quota succeeds; damaged storage still refuses ingestion with recovery
   status, even when the incoming evidence is already in memory.
6. Return additive `duplicateSpans` and `conflictingSpans` counts alongside
   `ingestedSpans`. Only accepted new observations count as ingested. The actual
   console and an original FIN capture replay must retain stable observation count
   and revision after retries. Prior ingestion, recovery, investigation and browser
   verification must pass before progressing to a dependent repository/case stage.

Scope: isolated worktree and disposable test stores. No data purge, migration,
production action, FIN source modification or emulator dependency.

## Implementation and contract

`engine/storage/observation_identity.js` provides pure canonical comparison and
batch selection. It builds indexes only for touched traces, keeps all retained
sanitized fields, sorts object keys and top-level attribute entries, and excludes
only `receivedAt` and legacy `observedAt`. Ordered value arrays remain ordered.
Full canonical strings are compared; no digest-only equality or new persisted index
is needed. Missing historical fields remain missing, so uncertain old observations
are conservatively retained rather than declared equal to a richer new export.

Ingestion stages and validates every row before selecting additions. Only additions
enter D2 quota admission and D1 durable append; then memory, baseline learning and
subscription events update. A pure retry checks recovery health and returns without
append, snapshot scheduling, age refresh or new-evidence notification. Mixed batches
reserve only their additions and still fail atomically. The existing single writer
and synchronous admission/append/publication sequence serialize concurrent requests.

Successful responses add `duplicateSpans` and `conflictingSpans` to `ingestedSpans`.
For example, one new span repeated three times returns 1 ingested, 2 duplicates and
0 conflicts. A new changed variant with the same trace/span IDs returns 1 ingested,
0 duplicates and 1 conflict. A later retry of either variant returns 0 ingested,
1 duplicate and 0 new conflicts. Counts cover this submitted batch only. Discarded
OTLP events, scope fields and resource fields are not covered by this retained-data
identity; no raw-payload or source-attestation claim is made.

Investigation engine version is now 1.1.0. Its conflict comparison and revision use
the same retained-evidence identity, so a legacy duration/status difference cannot
hide behind otherwise identical normalized request facts. Timing conclusions still
require original timestamps. Historical rows are neither migrated nor purged.
The version change intentionally changes earlier investigation revisions once.

## Verification and correction from visual inspection

Nine checks in `verify_idempotent_ingestion.js` pass: exact and within-batch retries
at quota; stable journal/snapshot bytes, age and revision; canonical attribute order;
ordered-array/version conflicts; timestamp-free restart; 12 concurrent HTTP retries;
forced pre-snapshot process termination; mixed quota/malformed atomicity; recovery
hold; historical-row preservation; original FIN JSON/protobuf capture replay; no
extra subscription event or baseline observation. Several acceptance scenarios are
grouped into each named check. Reports live in `artifacts/storage-d3`.

Four actual Chrome checks pass. First browser attempt timed out because the test
looked for a visible conflict reason inside a collapsed details element. The test
now opens Evidence gaps through the UI; the assertion was not weakened. Screenshot
review then found the old baseline panel describing same-ID variants as independent
requests and inferring a sender context defect. `baseline_learner.js` now refuses
baseline comparison for duplicate IDs, gives an ambiguity reason and removes an
earlier partial sample when late conflicting/error evidence makes it unlearnable.
Added API, UI and sample-removal assertions, which pass. Both final screenshots were
visually inspected. No production cause or successful business repair is inferred.

All 17 prior pilot regression suites, 12 investigation, 12 storage-policy and eight
journal checks pass. Existing Chrome modes also pass: D2 storage (4), investigation
(5), mobile replay (4), health replay (3) and controlled fixtures (4). Baseline and
no-fabrication suites were rerun after the screenshot-driven baseline correction.
Actual original FIN capture bytes keep their hashes and replay without inflation:
28 retained observations across seven traces, including three mobile requests with
eight spans each. This is replay of recorded local traffic, not a new mobile run.

D3 is complete for this scope. Next repository requirement is a reproducible local
capacity/recovery measurement before choosing a broader storage migration. Automatic
case-aware purge, persistent cases, external integrations and production readiness
remain open. Current synchronous bounded scans are not a throughput guarantee.
