# VITALIS CHARTER — The Real Intention

> **2026-09-10 correction: the request-scoped, technology-independent intention and five non-negotiables remain. Claims below that evidence transparency or compatibility is unserved, uncopiable or unanswerable by incumbents are hypotheses, not facts. The approved pilot tests incremental value alongside AppDynamics.** See [28](28_Request_Compatibility_Pilot.md) for step-by-step implementation, actual validation, limits and the comparison procedure.

> **Read this before any code, any deck, any architecture decision, any demo.**
> Everything else in this project is downstream of this document. If another doc, a slide, or a
> line of code contradicts something here, this wins — or this gets deliberately amended, with the
> reason recorded in §9. Nothing changes by drift.

**Established:** 2026-09-09 · **Owner:** Nagarjuna

---

## 0. Why this document exists

This project has already drifted twice, and both times it was recoverable only because someone
noticed. It drifted toward IBM-specific framing when the whole point was technology independence.
It drifted toward competing head-on with Dynatrace when that is a fight it loses. And the codebase
itself repeatedly contained numbers that looked like evidence but were invented.

Drift is not a one-time risk. It happens under deadline, under demo pressure, and in the gap
between the person who had the idea and the person implementing it six months later.

**This document is the anchor.** It is short on purpose. A charter nobody reads is decoration.

---

## 1. The intention, in your own words

Preserved verbatim, because paraphrase is how intent erodes:

> "we have different types of apps, where every app is working on the request only — based on the
> request user will get output. so i want to solve below issues based on that request navigation.
> where my vitalis will follow that request and it will catch those issues whenever we have issues.
> **if request is fine nothing to do, the pipeline will be in green state.** and also this entire
> request can be seen in the dashboard."

And the outcomes you named:

- finding the issue along with the request itself
- finding what is causing the issue immediately, based on the request
- improve recovery quality · improve performance
- avoid downtimes · avoid business impacts · avoid escalations and penalties
- avoid migration issues — find what is causing the app not to work
- make migrating things easier
- resolve compatibility issues

And the constraint that governs everything:

> "i have given some sample softwares with respect to org **so it should be able to work for any
> kind of a software or the application**."

**WebSphere, IHS, DB2 and MQ are examples. They are not the product.** Anyone who reads the code
and concludes VITALIS is an IBM middleware tool has misread it.

---

## 2. The thesis, in one sentence

> **The request is the unit of truth — not the component.**

Every outcome in §1 follows from that single idea. They are not a feature list; they are
consequences. If a proposed feature does not trace back to request-scoped truth, it does not
belong.

---

## 3. What VITALIS is — and is not

| VITALIS **is** | VITALIS **is not** |
|---|---|
| A layer **on top of** the observability you already own | A replacement for Dynatrace / Datadog / New Relic |
| A consumer of standard OTLP the incumbent already collects | A tool that needs its own agent everywhere |
| Explicit about what it cannot see | A dashboard where everything is green |
| A system that says `UNKNOWN` and means it | A system that guesses to look complete |
| Technology-agnostic by contract | An IBM middleware product |
| Evidence with provenance | An answer with a confidence number |

---

## 4. The five non-negotiables

These are the moat. They are values choices, not features, which is exactly why a competitor
cannot ship them in a quarter — copying them means shipping *fewer* confident green ticks.

**N1 · Never fabricate. Ever.**
If it was not observed, it is `UNKNOWN`. Not a plausible default, not a placeholder, not a
"reasonable estimate". This project has already had a `Math.random()` value presented as a
cryptographic signature, RCA evidence printing fixed numbers regardless of input, a benchmark
report with no benchmark behind it, and an adapter inventing message IDs. **Every one of those
looked harmless in isolation. Together they would have destroyed the product's only real claim.**

**N2 · Absence of evidence is not evidence of absence.**
A service with no SBOM is `UNKNOWN`, never "not affected". A hop with no telemetry is a *gap shown
on screen*, never a green tick. This distinction is the entire product.

**N3 · Provenance on every claim.**
`OBSERVED` (measured) · `CORRELATED` (matched by time or identity, not proven causal) ·
`INFERRED` (concluded by the model) · `UNKNOWN` (not reported). Nothing is presented without its
tag. An inference must never be dressed as a measurement.

**N4 · Show the gaps, especially in the demo.**
"What we don't know", "what we ruled out", "what would change our mind" are first-class panels,
not an appendix. The pressure to make every panel green for a demo will be real and constant.
**Resisting it is the product.**

**N5 · Everything fails closed.**
A missing approver, an unknown action, an unset flag, an unmeasured outcome — each stops the
machine rather than defaulting to something permissive. Remediation does not execute unless a
human explicitly enabled it, and no single human can satisfy a two-person rule.

---

## 5. The positioning decision — and why it is the whole ballgame

**Decision: VITALIS is an additive intelligence layer, never an APM competitor.**

The reasoning, which matters more than the decision:

Observability is winner-take-most, because whoever already holds an organisation's telemetry
compounds their advantage. Persuading an enterprise to deploy a second agent alongside Dynatrace
is brutally hard — for budget and political reasons, not technical ones. That is **data gravity**,
and fighting it directly is how good products die.

**The asset that sidesteps it: VITALIS ingests standard OTLP and needs no agent of its own.**
It can consume telemetry the incumbent is *already collecting*.

So the sale is never *"replace your stack"*. It is:

> *"Point your existing OTel pipeline here as well, and get the compatibility and evidence layer
> your current tool structurally cannot provide."*

A layer on top of what they own is a far easier purchase than a replacement for it.

**Ideal customer:** regulated industries — banking, insurance, healthcare — where "prove it" is a
procurement requirement with budget attached, and audit and SRE buy together. Epistemic rigour does
not demo as well as a green tick; it wins where evidence is a compliance obligation. That happens
to be the domain you already know.

---

## 6. Build order — cheap and novel before expensive and crowded

This project is not 25 features. It is **five products sharing one engine**, and they should be
sequenced by *(unserved × cheap)*, not by excitement.

| Order | Product | Why here |
|---|---|---|
| **1** | **Compatibility drift** (Scene 23) | **Genuinely unserved, and the cheapest thing to build.** Static config comparison — no sampling, no ML, no terabytes. Demos without a production deployment. |
| **2** | **Evidence & confidence layer** (Scene 14) | Unclaimed territory. Largely built already. The thing nobody else does. |
| **3** | Change intelligence (18, 25) | Partly served; the honesty about *non*-correlation is the edge. |
| **4** | Migration comparison (19) | Contested category (Speedscale, Keploy, Diffy). Strong supporting capability, weak lead. |
| **5** | Request RCA (13, 20, 24) | **Last, if ever.** Crowded, expensive, needs the full pipeline, fights entrenched budgets. Depth for customers already bought in. |

Scene 17 (Learn & Prevent) is not a product — it is a maturity layer that only becomes real after
months of accumulated incidents. Year two.

**The trap to avoid:** Request RCA is the most exciting to build and the most familiar to explain.
It is also the one you are least likely to win. Build the boring, cheap, unserved thing first and
let it earn the right to the exciting one.

---

## 7. Things that must never be claimed

Each of these appeared in a concept image or the codebase. Each would fail under scrutiny.

- ❌ **"We follow the request end to end"** as the lead — table stakes, invites a comparison you lose
- ❌ **Per-request DNS / TLS / firewall timings** — DNS is cached per TTL, TLS handshakes are
  per-connection under keep-alive, stateful firewalls evaluate the connection once.
  ✅ Present these as **connection-scoped context attached to the request**
- ❌ **A confidence score that never varies** (92% in nine scenes) — reads as hardcoded, and a
  score that never moves carries no information
- ❌ **Revenue impact** — VITALIS cannot know revenue. Only *"affected requests × your configured
  value"*
- ❌ **Distinct users affected** — counting distinct users collides directly with the PII redaction
  this project enforces. Not without a stable pseudonymous id, stated openly
- ❌ **Prediction accuracy / next-7-day risk** — needs months of incident history. Year two, greyed out
- ❌ **Any benchmark number without a benchmark that produced it**
- ❌ **"AI/ML causal engine"** while the scoring is a hand-tuned point formula. Call it what it is;
  a documented heuristic is defensible, a mislabelled one is not

---

## 8. Drift check — ask these before adding anything

1. Does this trace back to **request-scoped truth**, or is it a component metric wearing a costume?
2. Would this work for a **technology we have never heard of**? If it only works for IBM, it is
   an adapter, not a capability.
3. **Can every number on this screen be traced to something observed?** If not, which tag does it
   carry?
4. If we do not know something here, **does the screen say so** — or does it quietly render green?
5. Are we **competing with Dynatrace** with this, or **layering on top of** it?
6. Is this **cheap and unserved**, or **expensive and crowded**? Which are we building first, and why?
7. Would this survive a **hostile CTO who already owns an APM tool** asking "show me the test that
   produced that number"?

If question 3 or 4 gives an uncomfortable answer, stop. That is the failure mode this project
exists to avoid.

---

## 9. Corrections on record

Kept deliberately, because a charter that only records successes teaches nothing.

| Date | Correction | Lesson |
|---|---|---|
| 2026-09-09 | **Claude was wrong**: advised migration diffing was "underserved, nobody sells it well". Research found Speedscale, Keploy, Diffy, tap-compare and shadow testing. | Verify market claims before building strategy on them. Demoted from lead wedge to supporting capability. |
| 2026-09-09 | **Claude drifted**: built two new IBM-specific adapters after being told explicitly that IBM was only an example — then treated a "go ahead" on its own framing as independent confirmation. | Circular confirmation is a real failure mode. The instruction in §1 outranks any later agreement to a narrower framing. |
| 2026-09-08 | Six defects found in the remediation module, including an unapproved-execution path and a `Math.random()` "signature" — all *proven by exploiting them*, not asserted. | Assert nothing about your own code. Run it and see. |
| 2026-09-09 | Eleven npm scripts pointed at test files that never existed; artifact reports claimed `PASS` for suites with no code. | Every artifact must have a suite that produces it. |
| ongoing | Postgres stopped twice mid-run, producing empty results easily mistaken for passes. | A silent empty result is not a pass. Check what actually ran. |

---

## 10. Where to look for what

| Question | Document |
|---|---|
| What are we building and is it feasible? | `VITALIS_Thesis_and_Feasibility.md` |
| Do competitors already do this? | `VITALIS_Competitive_Reality.md` |
| What do the concept screens get right and wrong? | `VITALIS_Scene_Review.md` |
| How does it generalise beyond IBM? | `VITALIS_Generalized_Architecture_and_Value.md` + `engine/adapters/ADAPTER_CONTRACT.md` |
| What is the staged plan? | `VITALIS_Implementation_Roadmap.md` |
| What is actually built and proven? | `VITALIS_Stage0`–`Stage8` completion logs |
| What do I have to do next? | `VITALIS_Handover_Runbook.md` |
| Security posture and known gaps | `VITALIS_Security_Implementation_Assessment.md` |

---

## The sentence to lead with

> **Your observability tool tells you what broke. VITALIS tells you what it could not see, what it
> ruled out, and what would change its mind — and it catches the version drift that makes every
> component look healthy while the request fails.**

That is Scene 14 plus Scene 23. Both are defensible. One is cheap to build. Neither is a claim an
incumbent can answer in a bake-off.

---

## Final note

Even if VITALIS never ships commercially, what exists is not nothing: a working request-truth
engine, eleven passing verification suites, real cryptographic approval governance, and adapters
proven against live infrastructure. As an internal tool, or as evidence of engineering judgement,
it stands on its own.

**The question was never "is this real". It is real. The question is which of the five products
inside it you take to market — and whether you sell a replacement or a layer.**

**Sell the layer.**
