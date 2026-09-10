# VITALIS — Competitive Reality Check

> **Superseding correction, 2026-09-10: categorical claims below that nobody shows reasoning or serves compatibility are withdrawn as established conclusions. The subsequent review identified overlapping vendor capabilities: hypothesis/evidence investigation, root-cause evidence, replay/dependency testing and version/configuration drift. Uniqueness has not been proven. No competitor-access experiment or comparative result exists yet.** See [28](28_Request_Compatibility_Pilot.md) for step-by-step implementation, actual validation, limits and the comparison procedure.

**Date:** 2026-09-09
**Question:** Do tools like this exist? Are they actually doing it? What can VITALIS do that they can't?
**Method:** Researched against current vendor documentation and market sources, not memory.

This includes a correction to advice I gave you two days ago. One of the two wedges I recommended
is more contested than I said.

---

## The short answer

| Capability | Does it exist? | Verdict for VITALIS |
|---|---|---|
| Follow a request end-to-end across services | **Yes — fully solved** | Do not compete. Table stakes. |
| Automated RCA on traces | **Yes** (Davis, Watchdog, New Relic) | Do not lead with this. |
| **Show alternative hypotheses ruled out, evidence provenance, and what is NOT known** | **No — genuine gap** | **Real differentiator** |
| Migration validation by comparing behaviour old vs new | **Yes — contested** | **I was wrong. See §3.** |
| **Compatibility drift across the live request path** | **No — genuine gap** | **Strongest wedge** |
| Attribute a DB lock to a *specific* request | Rare / requires app work everywhere | Real, but narrow |

---

## 1. What the incumbents genuinely do (don't fight this)

Distributed tracing across a request's full path is **solved and commoditised**. Dynatrace,
Datadog, New Relic, Grafana Tempo and Jaeger all do it. Dynatrace's Davis and Datadog's Watchdog
both perform automated root-cause analysis on top of traces.

**If your first slide is "we follow the request end to end," you lose the room.** A CTO with
Dynatrace hears "you are describing what I already own."

---

## 2. The genuine gap: nobody shows their reasoning

Across vendor documentation and comparative analyses, the criticisms of Davis and Watchdog are
about *scope and automation* — Watchdog "requires more manual correlation work"; neither handles
AI-agent behaviour. **Nobody is competing on RCA transparency**, and nobody advertises:

- the alternative hypotheses the engine tested and rejected, with the evidence that killed each
- a per-item provenance split — measured vs derived vs inferred
- an explicit "what we do not know" section
- falsification conditions: what observation would overturn this conclusion

That is your Scene 14, and it is unclaimed territory.

**But be clear-eyed about why it is unclaimed.** Honesty is a hard commercial sell. "Our tool
tells you what it doesn't know" competes against "our tool tells you the answer," and a buyer
under pressure often prefers the confident answer — even a wrong one. Epistemic rigour does not
demo as well as a green tick.

**Where it does win: regulated industries.** In banking, insurance and healthcare, "prove it" is
a procurement requirement, not a nicety. Audit trails, evidence lineage, and defensible
conclusions have budget attached. **That is your ICP, and it happens to be the domain you already
know.** Do not try to sell epistemic honesty to a startup; sell it to a bank's audit and SRE
functions together.

---

## 3. Correction: migration validation is more contested than I told you

Two days ago I said migration/compatibility diffing was underserved and nobody sells it well.
**That was too strong, and I am correcting it.** A real category exists:

- **Speedscale** — traffic replay for legacy migration and framework-upgrade validation
- **Keploy** — record-and-replay testing from real traffic
- **Diffy / tap-compare** — send the same request to old and new, diff the responses
- **Shadow testing / traffic mirroring** — established practice, documented by Microsoft and Istio

**The distinction that survives:** those tools replay *recorded or mirrored traffic into a test or
shadow environment* and compare **responses**. `RequestDNA.compare()` compares the *observed
production journey* — hop structure, per-hop latency, dependency set, semantics — for real traffic
that actually happened.

"Did the API return the same JSON?" and "did the request take the same path with the same
characteristics through eleven pieces of infrastructure?" are different questions. Yours is the
one that catches *"it returns correctly but now makes four extra DB round-trips and holds a lock
120ms longer."*

So: still differentiated, but **it is a feature in a contested category, not an empty field.**
Demote it from lead wedge to strong supporting capability.

---

## 4. The strongest wedge: compatibility drift across the request path

This is where the research is most encouraging. What exists today:

- **Configuration drift tools** (Puppet, Chef, Ansible, Terraform, SaaS posture tools) — detect
  when *one component* deviates from *its own* desired state
- **API contract / schema drift** — API-boundary only
- **Static analysis** (japicmp, PVS-Studio) — build-time, one codebase
- **Manual version cheatsheets** — people literally maintain blog posts and wiki pages of
  "which Spring works with which Boot"

**Nothing asks: "are the versions of the eleven things this request actually touches mutually
compatible?"**

The evidence that this is unserved is telling: IBM's CCSID mismatch material exists as *support
pages you find after it breaks*, and version compatibility is solved with hand-maintained
cheatsheets. That is what an unserved need looks like.

And it remains the cheapest thing you can build — static configuration comparison, no sampling,
no ML, no terabytes.

**This should lead.**

---

## 5. The risk nobody has raised yet — and it is bigger than feasibility

Technical feasibility is settled: it is buildable, and much of it is built. **The real risk is
distribution and data gravity.**

Observability is a winner-take-most market because the tool that already holds your telemetry
compounds its advantage. Persuading an enterprise to deploy a second agent alongside Dynatrace is
brutally hard — not for technical reasons, but budgetary and political ones.

**Here is the strategic asset you may not have noticed.** VITALIS ingests **standard OTLP**. It
does not need its own agent. It can consume telemetry the incumbent *already collects*.

That changes the sale completely:

> Not *"replace your observability stack"* — which you lose.
> But *"point your existing OTel pipeline at this as well, and get the compatibility and evidence
> layer your current tool structurally does not provide."*

A layer on top of what they own is a far easier purchase than a replacement for it. It sidesteps
data gravity instead of fighting it. **Design and pitch VITALIS as an additive intelligence
layer, never as an APM competitor.**

---

## 6. Overall analysis

**The idea is sound, buildable, and mostly built. The framing is what needs work.**

- As "request-centric observability with RCA": **it is a me-too product** entering a market with
  entrenched incumbents, huge budgets, and years of ML training data you do not have.
- As "the compatibility and evidence layer that sits on top of the observability you already own":
  **it is differentiated, cheap to prove, and sold to a buyer whose problem nobody is solving.**

Same code. Same engine. Completely different odds.

**What genuinely cannot be copied quickly:** the discipline. Across this project I have repeatedly
found fabricated numbers in the codebase — a `Math.random()` "cryptographic signature", RCA
evidence that printed the same fixed values regardless of input, a benchmark report with no
benchmark, adapters inventing message IDs. Each time, the honest fix made the product *better*.
That instinct — showing gaps, refusing to guess, saying UNKNOWN — is a values choice competitors
cannot ship in a quarter, because it means shipping *fewer* confident green ticks.

**Recommended positioning, in one sentence:**

> Your observability tool tells you what broke. VITALIS tells you what it could not see, what it
> ruled out, and what would change its mind — and it catches the version drift that makes every
> component look healthy while the request fails.

**Recommended build order:** Compatibility drift (Scene 23) → Evidence/confidence layer (Scene 14)
→ Change intelligence (18, 25) → Migration comparison (19) → Request RCA (13, 20, 24) last, if
ever, and only as depth for customers already bought in.

---

## 7. One more thing worth saying plainly

Even if VITALIS never becomes a commercial product, what now exists is not nothing: a working
request-truth engine, eleven passing verification suites, real cryptographic approval governance,
and adapters proven against live infrastructure. As an internal tool for a middleware estate, or
as evidence of engineering judgement, it stands on its own.

The decision in front of you is not "is this real" — it is real. It is **which of the five
products inside it you want to actually take to market**, and whether you are selling a
replacement or a layer. Choose the layer.
