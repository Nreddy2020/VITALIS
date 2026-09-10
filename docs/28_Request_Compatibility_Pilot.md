# Request compatibility pilot — implementation and evidence log

This is local, observe-only work. The authoritative baseline was E:\VITALIS at
faea430 **plus its uncommitted files**, imported into the isolated Codex worktree.
E:\VITALIS was not changed. `artifacts/pilot/imported-baseline.json` records file
hashes before pilot edits. Existing local work is part of the baseline, not claimed
as this pilot's implementation. No push or production deployment is authorized.

## Step 1 — establish baseline and read contracts

Compared both checkouts, inspected git status, and read 00 completely, then 01,
17–19, 21, 23–27, 05 and 12. The worktree lacked the newer engine and console.
Copied the authoritative working files before implementation. Independently ran
stage9 (9 gates) and stage11 (7 gates): passed. Prior documentation's test numbers
are historical claims, not validation of this pilot.

## Step 2 — relationship contract and sourced rules

Added `engine/drift/relationships.js` and `relationship_rules.json`. An edge requires
one CLIENT span with one remote SERVER child whose parentSpanId matches it. Merely
sharing a trace, service list, or ingest order creates no edge. Internal spans and
async links do not imply a supported boundary. Client spans without a unique server
observation are counted as unchecked. Missing parents, duplicate IDs, cycles and
multiple roots block relationship verdicts. A valid observed tree is not proof of
complete capture.

Rules are data, with attributed vendor URLs, sections, recorded dates and review
deadlines. Stale/future rules and unsupported versions remain UNKNOWN. Runtime
analysis is offline. The review deadline is a pilot policy (90 days here), not a
vendor guarantee. Reviewed 2026-09-10:

- [MongoDB upgrade guide](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/reference/upgrade/),
  Version 4.11 Breaking Changes: PyMongo 4.11 requires MongoDB >=4.0. Scoped to
  4.11.x only; this does not assert all newer drivers have the same minimum.
- [pgJDBC connection parameters](https://jdbc.postgresql.org/documentation/use/),
  sslNegotiation: direct TLS requires PostgreSQL >=17. Pilot client scope is
  42.7.7 only, and the connection setting must be observed on the client span.

These are prerequisite checks. A violation is not a causal diagnosis; satisfying
one is not a whole-boundary or whole-request compatibility assertion.

## Step 3 — deployment evidence

The ingest path now retains OTLP span kind and a custom resource attribute,
`vitalis.artifact.digest`, only if it is a SHA-256 digest. Set
`VITALIS_BUILD_INVENTORY` to a JSON array of build records. Each record has service,
artifactDigest, declaredVersion, declaredBy, evidence (a build/SBOM reference), and
packages [{name, declared, resolved}]. Package names are ecosystem-qualified.

DEPLOYED resource version/digest, DECLARED source version, and RESOLVED build
inventory packages stay separate. Exact digest matching is CORRELATED evidence,
**not cryptographic attestation**: this pilot trusts the authenticated collector
and operator-provided inventory. The ingestion API key does not authenticate each
workload's claims. No signature or image/SBOM generation pipeline is implemented.
Absent digests, ambiguous inventory, version mismatch or unresolvable package
versions block evaluation. Reusing a version string does not prove artifact identity.

## Step 4 — operator view

Reused the existing Request Journey console, adding boundary coverage, actual span
links, per-rule verdicts and vendor sources, unchecked observations, per-span build
evidence and an expandable JSON report. Unknowns are amber, never green. The report
contains evaluation time and hashes of inputs/rules for reproducibility; source
documents are linked, not archived snapshots. No remediation call is added.

## Step 5 — counterexample tests and refinements

Added 34 gates in `tests/verify_relationship_pilot.js`, recording full outputs in
`artifacts/pilot/relationship-tests.json`. Tested real sourced incompatible version
pairings as **controlled fixtures**, missing/wrong digests despite equal version
strings, declared/deployed mismatch, missing/ranged/prerelease resolved versions,
duplicate inventories/packages, unowned evidence, off-path exclusion, co-presence,
absent peers, malformed/cyclic/multiple-root traces, invalid timestamps/IDs,
stale/future/unsourced rules, connection settings, expected-hop gaps, deterministic
hashes and live OTLP HTTP/API behavior.

Testing/review tightened the contract: a client span must report
`vitalis.client.package` matching the qualified rule package. A package being
installed is not proof it made the call. Java's direct TLS setting is the custom
span attribute `vitalis.connection.sslNegotiation`; absent stays UNKNOWN. These
custom attributes need trustworthy instrumentation; ordinary OTLP does not provide
them automatically. The generic core contains no FIN paths or service names.

An expected-hop inventory is optional configuration, never an edge generator:
use `{builds: [...], expectedInteractions: [{from, to, declaredBy, evidence}]}`.
Absent expectations mean capture completeness is unknown. Missing expected
boundaries remain UNKNOWN even when some prerequisite checks succeed.

The legacy `analyseRequest()` library accepts optional fourth-argument
`{inventories, rules, now, expectedInteractions}` and returns `relationshipReport`
separately from source-manifest component findings. Its old CLI JSON includes that
report, with UNKNOWN identity by default. It does not automatically turn source
manifests into trustworthy build inventories. The console uses the new report.

## Step 6 — fresh real FIN capture

Coordinated with the active Life Events task, which requested no Metro/emulator
restarts. Read FIN backend configuration and health route. WSL read access initially
failed under the sandbox; an approved escalation provided read-only runtime access.
No backend listener was running there; MongoDB was listening locally.

`tests/capture_fin_health.py` imported the actual FIN backend through its existing
Python venv, with bytecode writing disabled, on isolated loopback port 8361. Explicit
FastAPI/PyMongo instrumentation lived only in the harness. It loaded existing local
configuration without printing secrets, refused a non-local database, called only
`/health` (MongoDB ping), captured genuine OTLP protobuf, and stopped its own runtime.
FIN source, Metro and the emulator were not changed. This does **not** reproduce or
settle the previous all-instrumentation sender defect from 27.

Actual results: **2 HTTP 200 responses, 2 independent four-span health traces**, each
with a MongoDB CLIENT span. `tests/verify_fin_capture.js` replayed hash-checked bytes
through the real VITALIS HTTP/protobuf ingest and API. Both have valid observed trees,
zero evaluable server boundaries, one unchecked client interaction, UNKNOWN expected
mobile/database boundaries and zero causal candidates. This is not full FIN capture.

Evidence: `fin-capture-metadata.json` (time, source hash, runtime package versions,
requests and raw-byte hashes), `fin-health-otlp-*.bin`, `fin-capture-tests.json`, all
under `artifacts/pilot`. Raw capture is local pilot evidence; review/redact before
sharing it externally. No production telemetry or credentials were requested.

## Step 7 — materially different live runtime and browser verification

`tests/verify_node_live_capture.js` used the installed, locked Node OTel SDK to
instrument two actual loopback HTTP services in one process. A real request crossed
them using W3C trace context: 3 spans, one observed CLIENT -> SERVER boundary. Missing
build identity and rules correctly yielded UNKNOWN. This is a live test application,
not an incident, multi-host deployment or automatic Node instrumentation proof.
`node-live-capture-tests.json` records the result. Java/pgJDBC compatibility is tested
as rule fixtures only; no Java database incident was executed. Version-scoped pgJDBC
feature availability was also checked in the vendor's REL42.7.7 PGProperty source,
linked from the rule.

`tests/verify_relationship_console.js` drove real Chrome against the live local
server: 4 checks passed for path/verdict/provenance/source/next evidence rendering,
UNKNOWN without green elements, escaped hostile sender HTML and no JavaScript
errors. Inspected `console-violation.png` and `console-unknown.png` visually. The
timeline remains ingest-order display; the new boundary panel uses actual parent
links. Demo listener is restricted to loopback. Browser dependency is external to
production: install Playwright or use the bundled runtime via NODE_PATH.

## Step 8 — regressions, a discovered defect, and recordkeeping

Installed existing lockfile dependencies (`npm ci --ignore-scripts --no-audit
--no-fund`); first sandboxed attempt failed to write npm's user cache, then the
approved retry with a temporary cache succeeded. No dependency versions changed.

The first 17-suite regression run found a security-suite failure: a 3MB upload
sometimes received ECONNRESET instead of 413. It reproduced with the original
E:\VITALIS server as well (that suite's attempt to save an original-checkout artifact
was denied; no original source changed). Preserved the failing report and log as
`regressions-before-security-fix.json` and `security-before-fix.txt`.

Removing immediate request destruction passed once but still failed in the full
runner. The final fix discards retained body bytes at the limit, drains without
buffering until upload ends, then sends 413. A five-second deadline bounds draining
for a sender that does not finish; that timeout may still close the connection without
a clean response. No oversized body is parsed/ingested. Three successive security
suite runs and the subsequent full regression runner passed.

`tests/run_pilot_regressions.js` executes each suite independently and checks exit
codes; this avoids the original shell-dependent semicolon `test:all` chain hiding
earlier failures. Final recorded result: **17/17 suites PASS**, plus **4 browser
checks PASS**. `regressions.json` names every executed suite and its log. These do not
include the legacy live Postgres, GUI/Postgres, change/audit-network, or propagation
suites; DB2/MQ transformations are tested, live connections remain unverified.

Corrections in 00/01/03/09/17/18 supersede market and organizational overclaims;
README points here. No push, merge or change to the authoritative E: checkout.

## Run and inspect the local pilot

From this worktree:

```text
npm run test:pilot
npm run test:pilot-fin
npm run test:pilot-node
npm run test:pilot-regressions
npm run pilot
```

Open `http://127.0.0.1:4358`, enter `local-pilot-test`, select a request and read
Request Journey -> Request boundary compatibility. Fixtures are explicitly labeled.
Stop that server before running the recorded real FIN mode:

```text
npm run pilot -- --fin
```

This mode replays recorded real health telemetry, **not a live FIN session**. To
recapture, coordinate with the active FIN task and run `capture_fin_health.py` with
FIN's existing venv and backend/artifact directory arguments, then `test:pilot-fin`.
Do not use the old onboarding script blindly: it restarts runtime processes.

For real deployment evidence, populate a reviewed inventory and pass its path in
`VITALIS_BUILD_INVENTORY` to the normal server. Rules must be reviewed by their
deadline; a later run correctly changes stale results to UNKNOWN. No build identity
or rule should be invented merely to make this demo green.

## Step 9 — reviewable delivery and real-capture console

Added a separate `--fin` console mode that replays the captured bytes, labels the
capture date and limited scope, and presents operation names and parent IDs with
deployment evidence. Real Chrome verification added 3 checks for this mode; all
passed and `console-fin-capture.png` was visually inspected. Total browser checks:
**7 passed (4 fixture + 3 recorded FIN)**. A test selector initially matched both
the visible provenance label and its expanded JSON representation; it was narrowed
to the visible paragraph, then both suites passed. No product defect was hidden.

`tests/build_pilot_review.py E:\VITALIS` produces `artifacts/pilot/implementation.patch`
and `implementation-files.json` against the actual imported working baseline. It
verifies recorded import hashes before generating the diff. This separates the pilot
from all pre-existing uncommitted project work that the worktree had to import.
Generated captures, test reports and screenshots are separate evidence artifacts;
they are not represented as newly implemented source in that patch. Nothing is
applied back to E: or pushed automatically.
The resulting patch passed `git apply --check` against the authoritative E: working
checkout. This is a read-only applicability check, not an application of the patch.

## Remaining evidence needed

- No mobile-origin FIN transaction, gateway, third-party boundary or actual incident captured.
- No DB SERVER telemetry, signed build/SBOM attestation, or verified deployed inventory for FIN.
- PyMongo 4.6.1 observed in FIN is outside the new 4.11 rule scope; no inferred applicability.
- Only synchronous CLIENT -> SERVER links supported; async/opaque boundaries need adapters.
- Inventory generation, workload authentication and rule maintenance remain manual pilot work.
- AppDynamics access, operator timing measurements and comparative benefit remain unmeasured.

## Pilot application and organizational context

FIN at E:\fintech-mobile is a proving application. Its active Life Events task was
contacted before runtime work. Do not restart it or modify overlapping files without
coordination. All application-specific inventory and capture setup belongs in pilot
files, never engine service-name, framework, path or topology assumptions.

AppDynamics is the organization's primary monitoring product, with limited other
request-flow tools. The intended value is complementary compatibility evidence.
Actual AppDynamics coverage, incident data and organizational access are not yet
verified. No worldwide-first, complete visibility, zero downtime or immediate RCA
claim follows from this implementation.

## Repeatable comparison procedure — results not yet measured

Use the same consented incident or controlled request, initial evidence, expected-hop
inventory, operator experience and time limit for AppDynamics alone and AppDynamics
plus this pilot. Randomize order across operators to reduce learning effects. Record:

1. Setup minutes: export configuration, service/build binding and expected-hop inventory.
2. Time from opening evidence to a **verified explanation** linked to observations and
   vendor constraints. Record unresolved cases as censored, not successful explanations.
3. False conclusions: unsupported causal claims, wrong deployed-build attribution,
   off-path contamination and unknown evidence reported as healthy.
4. Useful unknowns: missing observations identified, whether collecting them changed
   the conclusion, and time required to obtain them.
5. Maintenance minutes per rule: source review, scope updates, fixture/regression work;
   count stale rules and inventory refresh failures.

Preserve operator notes, request IDs, immutable build references, rule versions and
screen captures. A reviewer with ground truth adjudicates explanations. Do not
fabricate competitor measurements or treat fixture pass rates as customer value.
