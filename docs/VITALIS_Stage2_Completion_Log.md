# VITALIS Stage 2 Completion Log — The Operational Console

**Date:** 2026-09-08
**Scope:** Replace the cinematic canvas demo with a real operational dashboard driven entirely by
live engine data, per Stage 2 of [[VITALIS_Implementation_Roadmap]].

Follows [[VITALIS_Stage0_Completion_Log]] (security hardening) and
[[VITALIS_Stage1_Completion_Log]] (real instrumentation adapters). As with those stages,
everything below was actually run and verified — including in a real browser — not asserted.

## The finding that justified the stage

A grep of the original front end for `fetch(`, `XMLHttpRequest`, `EventSource`, `WebSocket`,
`/api/`, and the server's own address returned **zero matches** across `index.html` and `app.js`.
The old GUI made no network calls at all: every number, every hop, every narrative line — including
the transaction id `TX-847392` — was hardcoded. It was a convincing product film, not a view of
the system.

## What was built

### 1. Two new server endpoints the GUI actually needs

| Endpoint | Why it had to exist |
|---|---|
| `GET /api/traces` | Lists every trace the engine actually holds (id, hop count, total duration, worst status, services, slowest hop). Without it a UI can only render a trace whose id you already know — precisely why the old front end had its transaction id baked in. |
| `GET /api/stream` | Server-Sent Events. `ingestOtelSpans()` now notifies subscribers when real spans land, so the console updates from actual ingestion rather than a polling timer. |

A deliberate security decision worth recording: the console consumes the stream with
`fetch()` + `ReadableStream`, **not** `EventSource`. `EventSource` cannot set request headers,
which would have forced the API key into the query string — where it lands in access logs, proxy
logs and browser history. Streaming over `fetch` keeps the Stage 0 header-based auth model intact
and introduces no new credential-exposure path.

### 2. The rebuilt console (`index.html`)

Renders only what was ingested. With an empty engine it says *"No telemetry ingested yet"* and
shows the exact `curl` to send a span, instead of falling back to demo data. It provides:

- **Ingested Requests** — the real fleet list, slowest first (an operator opens the worst request,
  not the first one).
- **Request Journey** — hop-by-hop timeline scaled to the slowest hop, with the first non-OK hop
  explicitly flagged `FIRST DEVIATION`.
- **Evidence & Why** — ranked candidates with the scoring arithmetic, and every evidence line
  tagged `OBSERVED` / `CORRELATED` / `INFERRED` / `UNKNOWN`. The tag is **read from the engine's
  own wording**, not guessed by the UI, so the interface cannot silently upgrade an inference into
  a fact.
- **What Next** — the remediation lifecycle as a stepper that deliberately stops at `APPROVAL`,
  with a standing note that nothing executes automatically and this console never calls a
  control-plane API.
- **Persona switcher** — filters the *same real data* (Executive hides engineering internals; the
  scoring arithmetic shows only for App Engineer) rather than swapping in a different scripted
  story per persona, which is what the old prototype did.

The previous cinematic demo is **preserved unchanged as `demo_cinematic.html`** — it is the asset
the product video and presentation storyboards were built from, and it is still openable directly.
It is simply no longer what the server serves at `/`.

### 3. Browser-level verification (`tests/verify_stage2_gui_gates.js`)

Drives a real Chromium browser via Playwright against a real running server and **real Postgres
lock contention** (a real transaction holding a real row lock, a second real connection genuinely
blocked behind it, observed by the Stage 1 Postgres adapter).

**Result, actually run:**
```
--- [GATE G1] Empty engine -> honest empty state, not demo data ---
> Empty state visible: true ("No telemetry ingested yet")
> Detail panel correctly hidden: true
RESULT GATE G1: [PASS]

--- [GATE G2] Real Postgres lock contention -> live UI update, no reload ---
> Real Postgres block in place: pid 2966 blocked by pid 2965
> Adapter reported real observation: {"blockedPid":2966,"blockingPid":2965,
    "lockWaitMs":1617,"queryFingerprint":"UPDATE inventory_items SET qty = qty - N
    WHERE sku_id = N;","connectionPoolSaturationPct":9}
> UI updated live over SSE with no reload (single navigation entry): true
> Renders the real trace id ingested just now: true
> Renders the real holding-lock PID #2965 observed in Postgres: true
RESULT GATE G2: [PASS]

--- [GATE G3] Old hardcoded demo values appear nowhere ---
> "TX-847392" absent: true | "2,100ms" absent: true | "99142" absent: true
RESULT GATE G3: [PASS]

--- [GATE G4] Missing evidence renders as an explicit UNKNOWN tag ---
> UNKNOWN-tagged evidence lines rendered: 2
> CPU utilization shown as UNKNOWN (Postgres cannot report it): true
RESULT GATE G4: [PASS]

OVERALL: ALL STAGE 2 GUI GATES PASSED
```

Gate G2 is the important one: the browser never navigated or reloaded between the empty state and
the populated state (`performance.getEntriesByType('navigation').length === 1`). The DOM showing
real Postgres PID #2965 is the *same document* that a moment earlier honestly reported having no
data. Screenshots are committed at `artifacts/stage2-gui-empty.png` and
`artifacts/stage2-gui-live.png`.

## Regression check

All prior suites re-run after the server changes: Alpha Gates 1–4 PASS (Gate 4 still exactly
93.7%), all Stage 0 security gates PASS, both Stage 1 evidence gates PASS, Stage 1 OTel SDK proof
PASS, Stage 1 Postgres adapter gate PASS. Alpha Gate 5's `socket hang up` failure remains
unchanged — it was proven pre-existing during Stage 0 and is still out of scope.

## What Stage 2 does NOT claim

- **The roadmap's React/Vue migration was not done.** The console is framework-free, matching the
  project's existing zero-build-step setup. That was a deliberate call: a build toolchain would
  have added real complexity while proving nothing about the thing that actually needed proving —
  that the UI shows real data. Adopting a framework remains a legitimate team decision when more
  than one engineer works on this front end, and nothing here blocks it.
- **Only three of the nine modules are rebuilt** (Request Journey, Evidence & Why, What Next),
  plus the fleet list. Incidents, Changes, RTI, and Systems still exist only in the cinematic demo
  and need real data sources from Stage 3 before they can be rebuilt honestly.
- **No real WebSphere/DB2/MQ data.** Unchanged from Stage 1: that needs infrastructure access this
  environment does not have.

## Files delivered to E:\VITALIS

`index.html` (rebuilt console), `demo_cinematic.html` (preserved demo), `server.js`
(`listTraces()`, subscriber mechanism, `/api/traces`, `/api/stream`), `package.json`
(`test:stage2-gui`), `README.md` (Stage 2 section, updated Quickstart and structure),
`tests/verify_stage2_gui_gates.js`, and both screenshots under `artifacts/`.

## Suggested next step

Stage 3 (network/edge correlation + change intelligence) per the roadmap, or rebuilding the
remaining GUI modules as their real data sources come online.
