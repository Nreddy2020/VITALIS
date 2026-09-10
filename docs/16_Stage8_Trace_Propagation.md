# VITALIS Stage 8 — Trace-Context Propagation

**Date:** 2026-09-09
**Scope:** Close the gap that mattered most — a database or queue hop that is *observed* but not
*attributed* to a specific request.

**All 11 verification suites pass.**

## Why this was the last real gap

Every previous stage could say *a query was blocked*. None could say *which customer request was
blocked, and which other request was holding the lock*. Request attribution is the entire premise of
the product, so this was the one remaining thing that undercut the pitch.

Worse, the Postgres adapter had a quiet flaw I had not called out: `pollAndReport(pool, config, traceId)`
took the trace id **from whoever called it**. The attribution was therefore whatever the caller
asserted, not what the database actually knew. In a real deployment that is the difference between
evidence and assumption.

## The mechanism

DB2 and MQ do not carry W3C `traceparent` headers, but each exposes a field the application controls
and the monitoring surface reports back:

| System | App stamps | VITALIS reads back from |
|---|---|---|
| DB2 | `CLIENT_APPLNAME` / `CLIENT_ACCTNG` | `MON_GET_CONNECTION` |
| Postgres | `application_name` | `pg_stat_activity` |
| IBM MQ | MQMD `CorrelId` (24 bytes) | queue monitoring |

`engine/trace_context.js` holds the encode/decode pair for all three, plus W3C traceparent parsing.
Encoding is `vt=<32 hex>` with an optional short app label — 48 bytes with a label, inside Postgres's
63-byte `application_name` limit and far inside DB2's 255. The MQ CorrelId layout is a 4-byte `VTLS`
magic, the 16-byte trace id, then 4 bytes of span id.

**The decode side deliberately fails closed.** A foreign, truncated or corrupt value returns
`undefined`, never a plausible-looking trace id — attributing a lock to the *wrong* customer request
is worse than admitting it is unattributed. The MQ magic exists for the same reason: another
application's CorrelId is not ours to interpret.

## What changed in the adapters

- `postgres_adapter.js` now selects `application_name` for **both** sides of the lock wait and
  recovers the trace id from the database. The caller's id is demoted to a fallback used only for
  sessions that propagated nothing.
- `db2_live_adapter.js` joins `MON_GET_CONNECTION` into the lock-wait query and recovers the trace id
  from `CLIENT_APPLNAME` / `CLIENT_ACCTNG` through the same decode path.
- `mq_live_adapter.js` gains `traceIdFromMessage()` over the MQMD CorrelId.
- `server.js` RCA output now names the blocking **request** rather than only a backend PID:
  *"Blocked behind request `<id>` (backend PID #4242)"*. Where the blocking session did not
  propagate, it says so explicitly rather than staying silent.

## Verification — `tests/verify_stage8_propagation_gates.js`, actually run

```
--- [GATE P4] LIVE: the adapter recovers the blocked request's OWN trace id ---
> Blocked session stamped   : 64c1e83218908fc832953dc950e3b14a
> Adapter recovered         : 64c1e83218908fc832953dc950e3b14a  (matches: true)
> Caller's fallback id      : 6430fce1c0e4dea836cb27138618e9bd  (correctly NOT used: true)
> Blocking request named    : 665d15f963b898e771637fc8c33f67d2  (matches holder: true)
> Span landed under the real trace in VITALIS: true
> Blocking request cited in the RCA evidence: true
RESULT GATE P4: [PASS]

--- [GATE P5] LIVE: a session that propagates nothing is UNATTRIBUTED ---
> Recovered trace id        : undefined (must be undefined, not invented)
> Lock still observed anyway: true (waited 1604ms)
RESULT GATE P5: [PASS]
```

P4 is the one that matters: two real Postgres sessions each stamped a *different* real trace id, one
genuinely blocked the other, and the adapter recovered the blocked session's own id from the database
while **ignoring a deliberately wrong id passed by the caller**. P1–P3 cover the DB client-info round
trip, the 24-byte MQMD CorrelId, and W3C traceparent parsing, each with their fail-closed cases.

**Why the Postgres proof is meaningful for DB2:** `application_name` is the exact analogue of
`CLIENT_APPLNAME`, and both run through the same `decodeTraceFromDbClientInfo()`. The transport
differs; the mechanism being proven does not. The DB2 adapter's row mapping is separately unit-tested
recovering the same trace id from a realistic `CLIENT_APPLNAME` row.

## What this does NOT claim

- **Live DB2 and MQ connections remain unverified.** Unchanged from Stage 6.
- **Your applications still have to do the stamping.** VITALIS cannot inject trace context into
  someone else's connection. `dbConnectionOptionsForTrace()` makes it a one-line change per
  connection, but it is a change in your code, by your app teams.
- **Unattributed hops stay unattributed.** A legacy job that propagates nothing is reported honestly
  as such — observable, not attributable. That is the correct outcome, not a defect to paper over.

## Files delivered to E:\VITALIS

`engine/trace_context.js` (new), `engine/adapters/postgres_adapter.js`,
`engine/adapters/db2_live_adapter.js`, `engine/adapters/mq_live_adapter.js`, `server.js`,
`tests/verify_stage8_propagation_gates.js` (new), `package.json`, `README.md`.
