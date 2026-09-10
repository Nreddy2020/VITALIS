# 21 — Stage 12 Completion Log: OTLP Protobuf Ingestion

**Date:** 2026-09-09
**Status:** Built and verified by execution. 7/7 gates pass; all 15 suites pass.
**Run it:** `npm run test:stage12`
**Artifacts:** `artifacts/stage12-otlp-encoding-gate-report.json`

> **Numbering note:** stage completion logs run `10`–`19` and continue at `21`. `20` is the
> handover runbook, kept at that number so existing references stay valid.

---

## 1. The defect

**VITALIS could not ingest OTLP from Python, Java, Go, .NET, or the OpenTelemetry Collector.**

`server.js` accumulated the POST body as a JavaScript string (`body += chunk`) and `JSON.parse`d
it. Every one of those senders defaults to `http/protobuf`. String concatenation coerces each
chunk through UTF-8, corrupting binary before it is ever parsed — so the payload was destroyed,
`JSON.parse` failed, and the sender received a bare HTTP 400.

This was not a missing feature. It sat directly underneath the project's central claim:

> *"VITALIS ingests **standard OTLP**. It does not need its own agent. It can consume telemetry the
> incumbent already collects."* — `03` §5

That claim is the basis of the Tier A model (`02`), the additive-layer positioning that makes the
commercial story work (`03` §5), and the internal adoption argument (`09` §3.1). **It was only ever
true for JavaScript senders.**

---

## 2. How it was found

Not by reading the code. By running a real FastAPI application under `opentelemetry-instrument`
and watching what happened:

```
Failed to export span batch code: 400, reason: Bad Request
```

The plan for the session was to instrument a real application, because `00` §3 listed *"nothing
real has ever fed VITALIS continuously"* as the largest remaining gap. The first attempt to close
it hit this immediately.

**This is the same root cause as `19`.** Everything had been proven with JavaScript senders — the
OTel Node SDK in Stage 1, hand-built JSON in every subsequent test — so the ingest path was shaped
by JavaScript without anyone deciding it should be. Two stages ago the drift engine had one
application's folder layout baked in. Here the ingest had one language's encoding baked in. Same
failure, different floor.

---

## 3. The fix

**`engine/ingestion/otlp_protobuf.js`** — a decoder for the OTLP trace schema, written against the
protobuf wire format directly rather than pulling in a protobuf runtime and the OTLP `.proto`
files for one message type.

It emits **exactly the shape the JSON path produces**, so ingestion downstream is identical and
neither encoding is privileged. `int64` values are emitted as strings, matching the OTLP/JSON
specification, so an attribute decoded from protobuf and the same attribute decoded from JSON are
indistinguishable.

**`server.js`** now collects `Buffer` chunks instead of concatenating a string, and branches on
`Content-Type`.

It also **fails loudly and specifically.** The old response was `{"status":"INVALID_OTLP_PAYLOAD"}`
with a parser message — which is exactly why this survived: "Bad Request" tells an operator whose
spans are vanishing nothing at all. The response now carries the encoding used, the Content-Type
received, the byte count, and a hint naming the likely cause. Silent or undiagnosable span loss is
the worst failure mode an observability tool can have.

---

## 4. Verified against real bytes, not synthetic ones

`tests/fixtures/otlp_python_real.bin` — 1216 bytes captured off the wire from a real FastAPI app
under `opentelemetry-instrument` (opentelemetry-sdk 1.44.0, instrumentation 0.65b0), sent as
`application/x-protobuf`.

This matters. **A decoder tested only against bytes it produced itself proves it is
self-consistent, not that it can read what the OpenTelemetry SDKs actually emit** — which is the
only property anyone cares about. The fixture is committed, with provenance recorded in
`tests/fixtures/README.md`.

---

## 5. The gates

| Gate | What it proves | Result |
|---|---|---|
| E1 | Real Python-SDK protobuf decodes; resource identity intact | PASS |
| E2 | Spans decode: hex ids, timestamps, typed attributes, one trace | PASS |
| E3 | **LIVE** — real bytes POSTed over HTTP are ingested and assembled, `service.version` surviving into the hop | PASS |
| E4 | Protobuf mislabelled as JSON yields a **diagnosable** error naming the encoding | PASS |
| E5 | Corrupt and truncated protobuf fail closed — 400, and **nothing partial is ingested** | PASS |
| E6 | The OTLP/JSON path still works identically — no regression | PASS |
| E7 | Protobuf on a signal with no protobuf schema returns 415 explicitly, never a silent accept | PASS |

E5 is the one worth dwelling on. A partially-decoded trace is more dangerous than a rejected one:
it looks like a small trace rather than a broken payload, and it would quietly corrupt every
downstream conclusion. The decoder throws on malformed input and the gate asserts the trace count
is unchanged afterwards.

**End-to-end evidence** — the same unmodified Python app against the patched server:

```
export errors : 0
traces        : 2, 3 hops each, service "finlife-api"
serviceVersion: 1.0.1     deploymentEnvironment: local
```

Those last two feed the deployed-vs-source check from `18` §1 directly.

---

## 6. What this unlocks

Tier A now genuinely means what `02` says it means: **point any OpenTelemetry-instrumented service
at VITALIS and it works, with no code change to that service and no VITALIS-specific SDK.**

Concretely: `opentelemetry-instrument uvicorn main:app` for Python, `-javaagent` for Java — which
is what a WebSphere/JBoss estate actually needs — or an `otlphttp` exporter added to an existing
OpenTelemetry Collector, which is the shape that matters for adoption alongside an incumbent stack
(`09` §3.3).

`22` is the runbook.

---

## 7. Limits, stated plainly

- **Traces only.** Metrics and logs have no protobuf decoder; they accept JSON and return 415 for
  protobuf rather than pretending.
- **Span events and links are skipped.** The decoder reads them as unknown fields and drops them.
  Nothing downstream uses them yet, but a report claiming full OTLP fidelity would be wrong.
- **Nanosecond precision.** 19-digit timestamps exceed `Number.MAX_SAFE_INTEGER`, so both encodings
  lose sub-microsecond precision. The JSON path always had this; protobuf now matches it rather
  than diverging. Far below anything VITALIS reports on, but recorded rather than hidden.
- **No gRPC.** OTLP over gRPC is a different transport entirely. Senders configured for gRPC must
  switch to `http/protobuf` or route through a Collector.

---

## 8. The pattern, for whoever is next

Three stages, three drifts, all the same shape:

1. **IBM** — the engine narrowed toward DB2/MQ because that was the example (`01` §9).
2. **Expo** — the drift checker absorbed one application's folder layout (`19`).
3. **JavaScript** — the ingest accepted only the encoding its own tests happened to use (here).

Each time the code worked perfectly on what was in front of it. Each time the limitation was
invisible until something *different* was pointed at it.

**The lesson is not "be careful."** It is that a claim of generality is worth nothing until
something outside the original example has been run through it. Stage 11 added a Java ecosystem
for that reason. Stage 12 added a real Python sender for the same reason. Whatever is claimed to
work with "any technology" next should be met with: *which one, other than the one it was built
against, has actually been run?*
