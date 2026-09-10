# 27 — Stage 17 Completion Log: A Trace Is Not Always A Request

**Date:** 2026-09-10
**Status:** Fixed and verified against real telemetry. Gate B9 added; 18 suites pass.
**Run it:** `npm run test:stage14`

**This is the first defect found by real production-shaped telemetry rather than by a test.**

---

## 1. The milestone that produced it

`00` §3 listed the largest gap in the project as *"no real application feeds VITALIS
continuously"*. That gap is now closed: a real FastAPI + MongoDB application, instrumented with
zero code changes via `opentelemetry-instrument`, sent real OTLP protobuf into VITALIS on the
owner's machine.

It also answered the question `22` §3 had left open with reasoning rather than evidence:
**`db.system: mongodb` — Mongo calls are traced.** pymongo's instrumentation hooks the driver's
`CommandListener` rather than wrapping a cursor, so it captures commands regardless of which API
the application uses, and motor delegates to pymongo. Previously argued; now observed.

And then the first real data immediately broke an assumption the whole engine rests on.

---

## 2. The defect

16 HTTP requests arrived under **one trace id**:

```
TRACE 23c0e640…  —  1 span    python -m uvicorn                       4101ms
TRACE 0a373d6a…  —  60 spans  9x admin.ping, 18x GET / http send,
                              9x GET /, 16x GET /health http send, 8x GET /health
```

Inspecting the 60-span trace:

```
spans                     : 60
with parentSpanId         : 60
parent NOT in this trace  : 18      <- 18 independent request roots
distinct external parents : 1       -> '3437b99b1f72534f'
```

Every request root shares one parent — a span that was **never exported**, because it has not
ended. Something in that application holds an OpenTelemetry context open for the process lifetime,
so each incoming request is adopted as its child instead of starting a new trace.

**VITALIS silently collapsed all 16 into a single 4-second "request."** Worse, it would have
learned that blob as a baseline sample, poisoning the baseline for every genuine request on those
routes — the exact failure `24` §4 had just been fixed to prevent, arriving through a different door.

---

## 3. Why the cause is not stated here

Two hypotheses were tested and both were wrong:

1. **`asyncio` instrumentation** — installed it, ran an equivalent FastAPI app: 6 requests, 6 clean
   traces. Not reproduced.
2. **`click` instrumentation** (uvicorn's CLI is click-based, and that stray `python -m uvicorn`
   span looked like a CLI wrapper) — pinned uvicorn to the same `0.24.0` and click 8.5.0: 6
   requests, 6 clean traces. Not reproduced.

So the cause is specific to that application and **is not recorded here as a finding**, because it
is not one. `bisect_instrumentation.sh` exists to settle it with data: it disables each
instrumentation in turn and reports which restores one-trace-per-request.

The remaining hypothesis, untested at the time of writing: the async `startup()` hook. That app
runs `MongoDB.connect()` inside `@app.on_event("startup")`, which executes in the ASGI lifespan. A
context entered there and never exited stays current for the whole event loop — exactly the
observed shape. **Stated as a hypothesis, not a conclusion.**

---

## 4. The fix — which is VITALIS's regardless of cause

Whatever the sender is doing, VITALIS must not invent a request that does not exist.

`traceShape(hops)` reports `spanCount`, `rootCount`, the roots, and any external parent ids. A root
is a span whose parent is not present in the trace.

**`rootCount > 1` means this is not one request.** Consequences:

- `requestKey()` returns `null` — no identity, so nothing to compare against
- `observe()` refuses it — **it can never enter a baseline**
- `compare()` returns `UNKNOWN` with the shape spelled out

Against the real trace:

```
YOUR real trace  -> spans 60 | roots 18 | external parents [ '3437b99b1f72534f' ]
requestKey       -> null   (correctly refused)
observe()        -> null   (NOT learned — baseline protected)
```

And the verdict it now gives, verbatim:

> *this trace id carries 18 independent request roots across 60 spans — it is a batch, not a
> request, so no request-level verdict is possible. Every root shares the parent span
> 3437b99b1f72534f, which was never ingested: something in the sender holds an OpenTelemetry
> context open, so each request is adopted as its child. Fix it at the sender; VITALIS will not
> guess where one request ends and the next begins.*

**Splitting the batch by root was considered and rejected.** It would be guessing: those 60 spans
might be 18 requests, or one request that fanned out, and nothing in the data distinguishes them.
Inventing a split would manufacture 18 request records that never existed — the same class of
error as every fabrication in `24`, `25` and `26`. Refusing is the only honest option, and naming
the external parent gives the operator the one fact they need to fix it upstream.

**Gate B9** builds a trace with the real shape — 18 roots, one absent parent — and asserts it is
never learned from, that an unrelated baseline's p95 is untouched, and that the verdict is UNKNOWN.

---

## 5. Two smaller things the same session produced

**Stale logs read as current evidence.** A previous run's failure sitting in
`finlife-backend.log` was mistaken for the current run's — the backend had not started yet that
time. `onboard_finlife.sh` now truncates its logs at startup. Old evidence presenting as current
evidence is the same mistake in miniature.

**A diagnostic that misdirected.** The onboarding script's secrets check wrapped `load_dotenv()` in
`except Exception: pass`, so a `.env` that could not be *parsed* reported as *"all three secrets
missing"* — sending the owner to look for the wrong problem entirely. It now reports the decode
error and detects the encoding (UTF-16 BOM, stray NUL bytes) directly. Testing that fix caught a
second bug: `load_dotenv()` with no arguments raises `AssertionError` when run from stdin, so the
check would have reported a phantom error even on a healthy file.

Both are the same lesson as the engine defects: **a message that misdirects is worse than no
message.**

---

## 6. Where the tally stands

| # | Fabrication or drift | Found by |
|---|---|---|
| 1 | IBM middleware scope | The owner asking why |
| 2 | Expo folder layout in the engine (`19`) | The owner challenging generality |
| 3 | JavaScript-only OTLP ingest (`21`) | Running a real Python app |
| 4 | Deviation judged against a demo path (`24`) | Chasing an odd empty result |
| 5 | Hardcoded `/18` divisor; score raised by missing evidence (`24`, `25`) | Reading the rendered screen |
| 6 | Invented dependencies, environment, deploy time, HTTP status (`26`) | Re-checking a claim just made |
| 7 | 16 requests silently merged into one (this) | **Real telemetry from a real app** |

Six were found in the harness or by the owner. The seventh needed a real application, and it
appeared in the first sixty spans it sent. That is the strongest argument in this whole document
for `09` §9's position: **the pilot is not a formality, it is the test.**
