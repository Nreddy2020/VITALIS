# VITALIS — What It Actually Is, and What Is Actually Feasible

**Date:** 2026-09-09
**Purpose:** Settle the thesis and the feasibility question before any more building.
Written after reviewing the 16 concept images and the generic problem statement.

---

## 1. Your thesis, as I understand it

Stripped of technology names, you are saying one thing:

> **The request is the unit of truth — not the component.**
>
> Every application, whatever it is built from, exists to take a request and return an
> output. So follow the request. If it is healthy, say nothing and stay green. If it
> deviates, catch it *at the point of deviation*, prove what caused it, and show the whole
> journey in one place.

That is a genuinely coherent product thesis, and it is **not** technology-specific. Every
statement you made — faster recovery, fewer downtimes, avoided escalations, migration and
compatibility confidence — follows from that one idea. They are not separate features; they
are consequences of having request-scoped truth instead of component-scoped alerts.

The concept images express the same thesis. Where they overreach is in *how much* can be
truthfully known per request, which §4 covers.

---

## 2. What makes it technology-agnostic: the four-tier model

This is the part that answers "not specific to one technology." Any technology on earth
needs exactly two things answered, and nothing else:

1. **Can I get evidence out of it?**
2. **Can identity (the trace id) travel through it?**

Those two questions produce four tiers, and every system falls into one:

| Tier | Evidence? | Identity? | What VITALIS does | Examples |
|---|---|---|---|---|
| **A** | Native OTel | Yes, natively | **Zero adapter code.** It already works. | Any Java/.NET/Node/Python/Go app with OTel auto-instrumentation, service meshes, modern gateways |
| **B** | Monitoring surface | Yes — via a field the app can stamp | Small adapter, ~200 lines, same contract | Postgres (`application_name`), DB2 (`CLIENT_APPLNAME`), Oracle (`CLIENT_INFO`), SQL Server (`program_name`), MySQL, MQ (`MQMD CorrelId`), Kafka/RabbitMQ (headers) |
| **C** | Monitoring surface | **No** — cannot carry a trace id | Correlate by time + 5-tuple. Label `CORRELATED`, never `OBSERVED`. Never claim deterministic attribution. | Firewalls, DNS, load balancers, network flow, WAF |
| **D** | None usable | No | Report an explicit **gap**. Show the blind spot rather than hiding it. | Closed appliances, legacy black boxes, third-party SaaS |

**Tier C and D are the product, not the embarrassment.** Every observability tool shows you
what it can see. Almost none show you what they are blind to. A dashboard that says
*"hops 1–4 OBSERVED, hop 5 CORRELATED by time only, hop 6 UNKNOWN — no telemetry"* is more
useful to an engineer at 3am than one that quietly renders six confident green ticks.

That discipline is already enforced in the code and is the hardest thing for a competitor to
copy, because it is a values choice rather than a feature.

---

## 3. Feasibility verdict

### ✅ Already built and proven (11 test suites passing)
- OTLP ingestion; multi-hop request assembly
- Golden-baseline diff and **first point of deviation**
- Provenance on every claim: `OBSERVED` / `CORRELATED` / `INFERRED` / `UNKNOWN`
- SHA-256 hash-chained evidence ledger
- Change→request correlation (real git history), that can honestly say *"no change correlates"*
- Vulnerability→request exposure ("which live requests traversed the affected component")
- Governed remediation: real Ed25519 approval, two-person rule, execution off by default
- **Trace-context propagation into a database** — proven against live Postgres: two sessions,
  each with its own real trace id, one blocking the other, and the adapter recovers the
  *blocked request's own id* from the database

### ✅ Feasible, ordinary engineering, needs your environment
- OTel agents on the pilot journey (zero code change for Java/.NET/Node)
- One Tier B adapter per backend that matters
- Dashboard build-out
- CI/CD webhook and scanner feeds

### ⚠️ Feasible, but requires a deliberate design decision — **and this is the big one**
**You cannot keep full-fidelity evidence for every request at production volume.**

At 1,000 requests/second with the per-hop detail your images show, you are generating on the
order of terabytes per day. Every APM vendor solves this the same way, and so must you:
**tail-based sampling** — buffer the trace, decide *after* it completes, keep 100% of anything
that deviated and a small percentage of the healthy ones. The industry reports 60–95% cost
reduction from exactly this technique.

This maps perfectly onto your "green pipeline" idea and actually *strengthens* it:

> Healthy requests → counted, sampled, and shown as green in aggregate.
> Deviating requests → captured in full, permanently, with every hop.

You get the "nothing to do when it's fine" behaviour you described, and the storage bill stops
being the thing that kills the project in month four. **Design this in now, not later** — it
affects the ingestion architecture.

### ❌ Not feasible as drawn — four corrections worth making before you present this

These are in the images, and a sharp CTO will find them. Better you find them first.

**1. DNS is not per-request.** Your Scene 2 shows a 300-second TTL. That means one resolution
serves every request in that five-minute window. "DNS took 23ms for TX-847392" is true for the
*first* request only; for the next ten thousand it is a 0ms cache hit. Showing per-request DNS
timing implies a measurement that does not exist.

**2. TLS handshakes are not per-request.** Your own Scene 4 image shows `Session Resumption:
Resumed` — you have already drawn the case that contradicts per-request handshake data. With
HTTP keep-alive, one handshake serves many requests on the same connection.

**3. Firewall decisions are per-connection, not per-request.** Your Scene 3 shows
`Connection State: NEW`. A stateful firewall evaluates the *connection*, then passes
subsequent packets without re-evaluating. Many requests ride one already-approved connection.

> **The fix for all three is the same, and it makes the product better:** treat these as
> **connection-scoped context attached to the request**, not per-request measurements. Show
> *"this request rode connection C-4471, established at 10:15:29 with TLS 1.3, allowed by
> firewall rule FW-ALLOW-PAYMENT-443"* — accurate, still valuable, and it survives scrutiny.

**4. Two numbers in the images cannot be produced by anything that exists.**
`Confidence Score (initial): 100%` at request birth is not a measurement of anything, and
*"System predicts normal behavior for next 1 hour"* requires a trained model with historical
data you will not have on day one. The current confidence score is a hand-tuned point-scoring
formula — defensible as a heuristic, indefensible if presented as a calibrated probability or
as AI. Label it as what it is.

---

## 4. The honest competitive position

**Following a request end to end is not novel.** Distributed tracing is table stakes: Dynatrace,
Datadog, New Relic, Jaeger and Grafana Tempo all do it, and Dynatrace's Davis and Datadog's
Watchdog both do automated trace-based root-cause analysis. If you pitch "we follow the request"
to a CTO who already owns Dynatrace, you will lose the room in ninety seconds.

**What is genuinely underserved — and where your four differentiators actually live:**

1. **The ends of the journey.** APM covers app-to-app. DNS, firewall, load balancer, TLS,
   queue depth at the moment the message sat there, and *which request held the database lock*
   are blind spots or component-level metrics in every mainstream tool.
2. **Attribution into non-OTel systems.** Dynatrace can tell you the database was slow. It
   generally cannot tell you *which specific request* held the lock that blocked *this specific
   customer*. That is the Stage 8 propagation work, and it is proven.
3. **Provenance discipline.** No mainstream tool distinguishes measured from inferred. They
   present a root cause; they do not tell you how confident to be or what they could not see.
4. **Migration and compatibility diffing.** `RequestDNA.compare()` — capture a request's full
   shape on the old stack, replay on the new, and flag every structural, latency, semantic or
   dependency regression automatically. **Nobody sells this well**, it maps directly to two of
   your stated goals, and you already have the primitive built. If I had to pick one thing to
   lead the pitch with, it would be this — it is a concrete, ownable wedge rather than a
   better-mousetrap claim against Dynatrace.

---

## 5. So: is it feasible?

**Yes — with one architectural decision and four honesty corrections.**

- The thesis is sound and technology-agnostic.
- The engine is built and proven against real infrastructure.
- The four-tier model means any technology can be onboarded, and the ones that cannot be
  fully seen are reported as gaps rather than faked.
- Tail-based sampling resolves the volume problem and matches your "green pipeline" idea.
- The four image corrections make the product *more* credible, not less.

**What it is not:** a system that captures every field of every hop of every request at 100%
fidelity forever, or one that predicts the next hour from day one. Those are the two claims in
the images that will not survive contact with a competent reviewer.

**What it is:** a request-truth layer that sits above your existing tools, attributes
infrastructure events to individual business requests, is explicit about what it does not know,
and can prove a migration did not change behaviour. That is a real product, and it is buildable
from where the code stands today.

---

## 6. Recommended next decision

Pick the wedge before building more:

- **Wedge A — Migration & compatibility assurance.** Most ownable, least competition, uses a
  primitive already built, and needs no 24×7 production deployment to demonstrate value.
- **Wedge B — Request-attributed infrastructure RCA.** Strongest technical differentiator,
  proven end to end, but competes directly with entrenched APM budgets.

They share the same engine, so choosing one does not throw the other away — it only decides
what the demo, the pilot, and the first slide lead with.
