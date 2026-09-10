# VITALIS Stage 1 Completion Log — Real Instrumentation Adapters

**Date:** 2026-09-08
**Scope:** Prove VITALIS's "works with any stack, not just IBM middleware" claim against real,
live infrastructure — not fixtures, not mocks, not hand-shaped JSON.

This follows [[VITALIS_Stage0_Completion_Log]] (security hardening) and
[[VITALIS_Generalized_Architecture_and_Value]] (the architectural argument this stage sets out to
verify). Everything below was actually run, with real output pasted in — not asserted.

## What was built and proven

### 1. Fixed a real bug found during this stage: evaluateTrace() missed real single-process apps

`server.js`'s RCA engine identified a "database" hop only by resource-level `service.name`
containing "db" or "postgres". That's correct for a hop reported by a separately-named adapter
(this project's own Tier B Postgres adapter, or the original IBM-middleware demo fixture), but it
silently misses the realistic case: a single real application instrumented with OpenTelemetry,
where every span shares ONE resource-level service name (the app's own name, e.g.
`"checkout-app"`) and only the span's own attributes identify it as a database call. This was
caught by the Tier A proof test itself (see below) — the first version of that test failed for
exactly this reason.

**Fix:** `evaluateTrace()` now recognizes a DB hop three ways, most-correct first: (1) the
standard OTel semantic-convention attribute `db.system` on the span, (2) hop `service` name
containing "db"/"postgres" (backward-compatible with the existing adapters/fixtures), (3) span
`name` containing "db"/"query" as a last resort. Documented in
`engine/adapters/ADAPTER_CONTRACT.md`.

Re-ran all prior gates after this fix to confirm no regression: Alpha Gate 4 still yields exactly
93.7% confidence (unchanged), all 4 Stage 0 security gates still pass, both Stage 1 evidence
honesty gates still pass.

### 2. Tier A proof — real OpenTelemetry SDK, zero adapter code (`tests/verify_stage1_otel_sdk_proof.js`)

Uses the actual `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, and
`@opentelemetry/resources` npm packages — the same libraries a real Node.js application uses — to
build a `NodeTracerProvider`, generate real spans for a `checkout-request` → `inventory-db-query`
call chain, and export them over real HTTP to a live VITALIS server's `/v1/traces` endpoint.

**Result, actually run:**
```
--- [GATE T1] Real OTel SDK spans export successfully to VITALIS's OTLP endpoint ---
> Real OTel SDK generated traceId: 1d15fdcc40998181294732e9a328a595
> GET /api/traces/... status: 200
> Hops VITALIS recognized: checkout-app:inventory-db-query, checkout-app:checkout-request
RESULT GATE [realOtelSpansIngestedWithZeroAdapterCode]: [PASS]

--- [GATE T2] Real OTel span attributes (db.lock_wait_ms etc.) survive into VITALIS's RCA evidence ---
> Cites the real db.lock_wait_ms=2400 value sent via the actual OTel SDK: true
RESULT GATE [realOtelAttributesReachRcaEngine]: [PASS]

OVERALL: ALL STAGE 1 OTEL SDK PROOF GATES PASSED
```

No adapter code exists between the real OTel SDK and VITALIS — the wire protocol alone is what
made this work, once the bug above was fixed.

### 3. Tier B proof — real Postgres adapter against genuine lock contention (`tests/verify_stage1_postgres_adapter_gate.js`)

`engine/adapters/postgres_adapter.js` queries live Postgres system catalogs
(`pg_stat_activity`, `pg_locks`, `pg_blocking_pids()`) and emits real OTel spans. The automated
gate:

1. Opens a **real** transaction (`BEGIN; SELECT ... FOR UPDATE`) that takes a real row lock.
2. Opens a **second real connection** that issues an `UPDATE` on the same row, which genuinely
   blocks inside Postgres.
3. Verifies via Postgres's own `pg_blocking_pids()` — not application-level bookkeeping — that
   the block is real.
4. Runs the actual adapter (`observeOnce`/`pollAndReport`) against this live state and POSTs the
   resulting span to a running, Stage-0-hardened VITALIS server.
5. Releases the lock, then GETs the trace back from VITALIS and asserts the RCA evidence cites
   the real backend PID, real wait time, and real query fingerprint — and that
   `db.cpu_utilization_pct` (which Postgres core cannot expose without extensions, and which this
   adapter deliberately never sends) renders as an explicit `UNKNOWN`, never a guessed number.

**Result, actually run:**
```
> Postgres itself confirms pid 2213 is blocked by pid 2212: true
RESULT GATE [pgConfirmsRealBlock]: [PASS]
> Adapter observation: {"blockedPid":2213,"blockingPid":2212,"lockWaitMs":1538,...}
RESULT GATE [adapterObservesRealBlock]: [PASS]
> POST /v1/traces result: {"status":200,"data":"{\"status\":\"SUCCESS\",\"ingestedSpans\":1}"}
RESULT GATE [adapterReportsToVitalis]: [PASS]
> RCA candidate cites holding-lock PID #2212, real 1542ms wait, real query fingerprint;
  db.cpu_utilization_pct: UNKNOWN — sensory adapter did not report it
RESULT GATE [rcaCitesRealEvidenceAndHonestUnknown]: [PASS]

OVERALL: ALL STAGE 1 POSTGRES ADAPTER GATES PASSED
```

## What Stage 1 does NOT claim

No real WebSphere, DB2, or MQ instance is reachable from this development environment — there are
no credentials, hostnames, or network path to the user's actual infrastructure. A `db2_adapter.js`
or `mq_adapter.js` built and proven the same rigorous way against real DB2/MQ requires the user's
own environment access; this stage proves the *pattern* generalizes to a real, live database of
the same general kind (lock contention, connection pool saturation, query identification), not
that DB2/MQ specifically have been touched.

## New scripts / dependencies

- `npm run test:stage1-evidence`, `test:stage1-otel` (self-contained, in `test:all`),
  `test:stage1-pg` (requires reachable Postgres, intentionally not in `test:all`).
- New real dependencies: `pg`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/resources`,
  `@opentelemetry/semantic-conventions`, `@opentelemetry/exporter-trace-otlp-http`,
  `@opentelemetry/api`.

## Files delivered to E:\VITALIS

`server.js` (db-hop matching fix), `package.json`/`package-lock.json` (new deps/scripts),
`README.md` (Stage 1 section + test table), `engine/adapters/ADAPTER_CONTRACT.md` (updated),
`engine/adapters/postgres_adapter.js` (new), `tests/verify_stage1_evidence_gates.js`,
`tests/verify_stage1_otel_sdk_proof.js`, `tests/verify_stage1_postgres_adapter_gate.js` (all new).

## Suggested next step

Stage 2 (GUI rebuild) per [[VITALIS_Implementation_Roadmap]], or a real `db2_adapter.js`/
`mq_adapter.js` once the user can provide reachable DB2/MQ infrastructure or credentials.
