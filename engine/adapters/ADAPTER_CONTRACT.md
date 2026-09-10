# VITALIS Sensory Adapter Contract

Every adapter in this directory — regardless of what technology it observes — produces the
same shape. This is what makes VITALIS work for any stack, not just the IBM middleware stack
used as this project's original example (see docs/VITALIS_Generalized_Architecture_and_Value.md
in the project knowledge base for the full reasoning).

## Two tiers

**Tier A — already generic, no adapter needed.** Anything instrumented with OpenTelemetry can
POST directly to `/v1/traces`, `/v1/metrics`, `/v1/logs` in standard OTLP-over-HTTP-JSON shape.
`tests/verify_stage1_otel_sdk_proof.js` proves this against the real `@opentelemetry/sdk-trace-node`
package, not a hand-shaped fixture — if it speaks real OTel, VITALIS already understands it.

**Tier B — needs a small adapter, same contract.** A technology that doesn't speak OTel natively
(a legacy system, a network appliance, a database whose monitoring surface is proprietary) needs
something that queries or receives its native telemetry and re-emits it as one OTel span per hop,
POSTed to `/v1/traces` like anything else. `postgres_adapter.js` is a real, working example of
this — it queries Postgres's own `pg_stat_activity`/`pg_locks` system views over a live
connection and emits genuine span attributes. `tests/verify_stage1_postgres_adapter_gate.js`
proves it end-to-end against a live Postgres instance: it opens a real transaction that takes a
row lock, opens a second real connection that genuinely blocks behind it (confirmed via
Postgres's own `pg_blocking_pids()`, not simulated), runs the adapter against that live blocked
state, and confirms VITALIS's RCA engine reports the real PID/wait-time/query fingerprint it
observed — run it with `npm run test:stage1-pg` against a reachable Postgres instance.

## The attribute contract for a "database" hop

`server.js`'s RCA engine (`evaluateTrace`) recognizes a span as a "database" hop three ways, in
this order: (1) the standard OTel semantic-convention attribute `db.system` is present on the
span itself — this is the correct signal for a real single-process application, where every span
shares one resource-level `service.name` (the app's own name) and only the span's own attributes
identify it as a DB call; (2) the hop's `service` name contains "db" or "postgres" — for a
separately-named hop, like this project's Tier B adapter spans (`service.name: "Postgres"`) or a
demo fixture; (3) the span `name` contains "db" or "query", as a last-resort fallback. This
three-way check was itself found and fixed during Stage 1 by `tests/verify_stage1_otel_sdk_proof.js`
— the original version only checked `service`, which silently missed every real single-process
OTel application. Populate whichever attributes your database/monitoring surface can actually
observe — **never fabricate one you can't**. A missing attribute renders as an explicit `UNKNOWN`
in the evidence output; VITALIS's whole credibility rests on that distinction between "observed"
and "not observed" ever being honest.

| Attribute key | Type | Meaning |
|---|---|---|
| `db.lock_wait_ms` | int | How long the blocked query waited on a lock, in ms |
| `db.connection_pool.saturation_pct` | int (0–100) | Active connections as a percentage of the pool/connection limit |
| `db.holding_lock_pid` | int | The backend/session id holding the blocking lock |
| `db.query.fingerprint` | string | A normalized identifier for the query shape (not the raw query text, to avoid leaking literal parameter values — see engine/privacy_sanitizer.js) |
| `db.cpu_utilization_pct` | int (0–100) | Database server CPU at time of observation, if your monitoring surface exposes it |

Postgres, for example, has no built-in per-session CPU percentage without extensions like
`pg_stat_kcache` — `postgres_adapter.js` deliberately omits `db.cpu_utilization_pct` rather than
guessing, and the RCA output correctly shows that field as `UNKNOWN`. DB2 exposes most of these
directly through `MON_GET_*` table functions and event monitors (see
docs/VITALIS_Implementation_Roadmap.md, Stage 1) — a `db2_adapter.js` built against a real DB2
instance would populate the full set.

## Writing a new adapter

1. Query or receive your system's native telemetry however it's actually exposed (a monitoring
   view, an API, a log stream, an accounting message).
2. Map whatever you can honestly observe onto the attribute names above (or, for a non-database
   system, define an equivalent small table like this one and document it here).
3. Emit one OTel span per hop/event, POSTed to `/v1/traces` using the same wire shape every other
   adapter and the real OTel SDK both already use.
4. Never populate a field you didn't actually observe. Leave it out.
