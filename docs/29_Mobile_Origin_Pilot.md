# Mobile-origin vertical slice — implementation/evidence log

Continuation of 28. No production deployment, push or changes to original FIN are
authorized. FIN is a proving app; application-specific code stays in the harness.

## Step 1: choose a real flow and coordinate

Read current FIN API, auth, runtime config, GlobalFinanceContext and inflation route
and service. Life Events is local storage, so it is not used to demonstrate network
flow. FIN startup already reads inflation through its API wrapper, FastAPI route
and Mongo find/aggregate operations. Both frontend simulation and backend fallback
rates exist; a UI number is not evidence of a database value or a real market rate.

The owning task confirmed its audit is read-only and that original Metro8081/8082,
FIN source/.env and app data must remain unchanged. An isolated copy/runtime is
appropriate. No login or account credentials are needed for the public read route.

## Step 2: generic opt-in fetch observer

Added `engine/ingestion/fetch_observer.js`: injected fetch, secure RNG, routing
allowlist, clock and exporter. It adds W3C traceparent to selected string-URL fetches
and exports actual request status/timestamps under a configured safe route label.
It never exports URL/query, body or credentials. It preserves existing tracing,
does not consume Request objects, and does not fail the app when export fails.
Those unsupported paths report gaps; there is no automatic claim of all fetch coverage.

## Step 3: isolated application and backend boundary

`tests/prepare_fin_mobile.py` copied 654 source/configuration/assets files into
`artifacts/mobile-pilot/fin-isolated` and recorded their original SHA256 hashes.
The disposable directory is gitignored. Only the copy has a separate app name,
local entry point, allowlisted fetch instrumentation and backend origin 8362.
Application imports of AsyncStorage, SecureStore and FileSystem are redirected
to in-memory stubs in that copy. Original credentials and `.env` are not copied.
The original project and its Metro servers on 8081/8082 remain separate.

`tests/capture_fin_mobile_backend.py` loads the real local backend using its
existing environment without printing credentials, rejects nonlocal Mongo URLs,
and exposes only GET health/inflation reads on 8362. Its local receiver on 8370
records raw OTLP batches and hashes. It expires after 900 seconds or a stop file.
Runtime package versions and Mongo buildInfo are context, not artifact attestation
or request-linked Mongo SERVER spans. The host health check is not mobile evidence.

## Step 4: loading failure and screenshot interpretation

The first dependency setup reused original dependency directories through junctions,
except NativeWind and CSS interop, which were copied to keep generated caches local.
Metro first produced a cross-drive entry URL; a local `index.js` corrected that URL.
The subsequent bundle still failed resolving `expo-router/entry`. Adding the
original dependency directory to watchFolders did not resolve the failure.

The user's attached screenshot shows the separate app's splash screen labelled
“FIN VITALIS isolated capture.” It establishes which app was launched, not a
successful bundle, mobile request, trace or database result. No successful mobile
capture is claimed at this stage. The dependency correction uses a physical copy
of dependencies in the disposable project to remove the cross-drive junction path.

At 2026-09-10T11:04:31.873Z, verification checked all 654 original source hashes:
zero changed (`artifacts/mobile-pilot/original-source-verification.json`). After
the FIN owner resumed Family fixes, Expo Go was reopened at the original 8082
URL successfully. The owner was notified that the emulator was free. Further
native testing requires coordination with that task; original storage is preserved.

## Step 5: dependency correction, actual capture and verification

Replaced the disposable project's cross-drive dependency junction setup with a
physical dependency copy; the previous directory was retained as
`node_modules-junctions`, not deleted. `tests/prepare_fin_mobile_dependencies.ps1`
reproduces the physical copy into an absent destination without modifying source
dependencies. The preparation script now sets empty watchFolders. Metro on 8083
compiled the Android bundle: HTTP 200, 25,532,968 characters in the host bundle
check (`bundle-check.json`). Device Hermes compilation subsequently succeeded too.

The FIN owner granted a brief emulator window. A stale launch did not fetch the
corrected bundle. Explicit `exp://127.0.0.1:8083/--/` root launch began device
compilation and loaded the isolated dashboard. No storage was cleared. Existing
Expo Go warnings about notifications and unavailable native SMS support appeared;
those capabilities are outside this read-flow test and are not certified.

Fresh `run-002` captured eight raw OTLP batches. Startup/shutdown Mongo spans are
separate traces and are not mobile requests. Three mobile JSON spans and their
backend protobuf spans join by exact trace ID and parentSpanId:

| Mobile request | Trace ID | Verified result |
| --- | --- | --- |
| GET /api/inflation/current | c4b6bfebbdf71a25e26d910fb1681aab | 8 spans; mobile/backend HTTP 200; Mongo find |
| GET /api/inflation/categories | 3aed136713d6d55078921aa63bc0b3c6 | 8 spans; mobile/backend HTTP 200; Mongo aggregate |
| GET /api/inflation/personalized/{user_id} | 3899a7f8ce7f48b498b01bdd140d2d2a | 8 spans; mobile/backend HTTP 200; Mongo find |

Backend output explicitly reported missing RBI/overall data and a fallback response
twice. Therefore this is actual network/database query evidence, not proof of live
inflation data. Request bodies and responses were not captured by the mobile wrapper.
Mongo buildInfo reported 7.0.28; backend packages included PyMongo 4.6.1 and FastAPI
0.104.1. Those are runtime context only, not identity-bound compatibility evidence.

`tests/verify_fin_mobile_capture.js` ingests each original JSON/protobuf batch into
the actual VITALIS API after SHA256 validation. It verifies all three exact
mobile CLIENT → backend SERVER links, Mongo CLIENT membership in each tree, HTTP
200 at both observed endpoints, expected mobile boundary OBSERVED_BOUNDARY,
database SERVER boundary UNKNOWN, zero checked compatibility boundaries and zero
causal candidates. Results: `run-002/mobile-capture-tests.json`, PASS.

`tests/verify_relationship_console.js --mobile` verifies the recording label,
observed boundary, explicit database gap, no green compatibility elements and no
browser JavaScript errors. Four checks passed. Screenshot:
`artifacts/mobile-pilot/console-mobile-capture.png`. `mobile-captured.png` shows the
loaded isolated FIN dashboard; its empty in-memory layout is not evidence that
original user data was removed. The trace evidence, not that screenshot, proves
the actual network requests. The generic wrapper's eight independent checks pass.

## Step 6: shutdown, handoff and reproduction

Restored original `exp://127.0.0.1:8082/--/` with `am start -W`, status OK and Expo
ExperienceActivity confirmed. The FIN owner was notified and took the emulator
for Family validation. No more emulator interaction was performed. Original FIN
source is now being changed by its own task, so later differences against the
earlier 654-file snapshot must not be attributed to this pilot. Original Metro
8081/8082 and app storage were preserved. The isolated backend was stopped through
its control file and reported eight batches; isolated Metro 8083 was stopped.

The local VITALIS console can replay the captured data without FIN, Mongo, WSL or
an emulator: `npm run pilot:mobile`, open http://127.0.0.1:4358, connect with local
demo key `local-pilot-test`. This is labeled replay, not production/live collection.
`npm run test:pilot-mobile` verifies the raw recording; `npm run
test:pilot-mobile-console` verifies presentation (requires Playwright and Chrome).
`npm run test:fetch-observer` checks the portable wrapper independently.

For a new capture, prepare a fresh isolated snapshot and physical dependencies,
start Metro 8083 and the read-only backend harness with a fresh output directory,
coordinate emulator ownership, set only pilot reverse ports 8083/8362/8370 and
launch its explicit root URL. Restore 8082 and stop pilot services after capture.
The receiver is loopback-only and unauthenticated for this local prototype;
production ingestion/access control, durable export queues and wider route coverage
are not delivered. Expected interactions are attributed operator declarations,
not discovery or evidence of unobserved peers. The legacy timeline displays ingest
order and summed observed span durations, not a verified critical-path latency.

Final checks: eight wrapper gates, 34 relationship gates, the three-request mobile
capture check, four mobile dashboard checks, three existing health replay checks
and four fixture dashboard checks passed. The broader 17-suite baseline from [28]
was not rerun in this slice; the changed replay modes and new evidence paths were
tested directly. `tests/build_pilot_review.py E:\VITALIS --mobile` packages 31
combined pilot files into `artifacts/mobile-pilot/implementation.patch`, verifying
the imported original baseline hashes. `git apply --check` against E:\VITALIS
passed; the patch was not applied, committed or pushed. The earlier pilot patch
remains separate. Final result is recorded in `artifacts/mobile-pilot/completion.json`.
The labeled recording console is intentionally available on 4358 for review; no
mobile capture services remain active. This slice is complete within the stated
limits, with no production action or autonomous repair performed.

## Product outcome and remaining roadmap

The user's long-term outcome is one VITALIS dashboard from which a single operator
can monitor production applications, investigate incidents and queries, and resolve
functional and performance problems with less dependence on colleagues. This is a
direction, not an achieved capability or a guarantee of eliminating human support.
The core stays application-independent; FIN is a proving application. AppDynamics
is the organization's primary monitoring system, with few other tools. Superiority
or replacement value requires an actual comparison using authorized access.

This capture slice contributes request-boundary evidence. It does not implement
production incident detection, journey impact measurement, verified deployment
identity, guided repairs or post-fix verification. The roadmap must connect those
steps: detect a problem, identify the affected journey and observed impact, collect
request/deployment evidence, disclose gaps, offer evidence-backed diagnostic and
repair steps, and verify the same journey after an authorized fix. Hypotheses must
remain separate from observed facts. Missing permissions, source data or specialist
expertise must be distinguished from missing tool functionality. Production changes
and autonomous remediation are outside this authorization.

`tests/verify_fetch_observer.js` exercises errors, privacy, existing trace context,
allowlisting, invalid identity generation and a real Node HTTP request as the second
runtime context. This same module is loaded in the isolated mobile application.
