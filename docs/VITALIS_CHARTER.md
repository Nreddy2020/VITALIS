


# VITALIS CHARTER — The Real Intention

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


This is the question that decides whether the project is worth years of your life. Let me research it properly rather than answer from memory.

Searched the web, ran a command, used a tool · 1 note

I researched this rather than answering from memory, and it produced a correction to advice I gave you two days ago.

First, the correction. I said migration/compatibility diffing was underserved and "nobody sells this well." That was too strong. A real category exists — Speedscale, Keploy, Diffy, tap-compare, shadow testing. What survives is a narrower distinction: those replay recorded traffic into a test environment and compare responses. RequestDNA.compare() compares the observed production journey — hop structure, per-hop latency, dependencies. "Did the API return the same JSON?" and "did it take the same path through eleven pieces of infrastructure?" are different questions, and yours catches "it returns correctly but now makes four extra DB round-trips." Still differentiated — but a feature in a contested category, not an empty field. Demote it from lead wedge.

Now the honest scorecard.

Following a request end to end is fully solved by Dynatrace, Datadog, New Relic, Jaeger, Tempo. Automated RCA on traces exists too. Don't compete there.

But nobody competes on RCA transparency. The published criticisms of Davis and Watchdog are about scope and automation — not one vendor advertises alternative hypotheses ruled out, evidence provenance, or "what we don't know." Your Scene 14 is unclaimed territory.

Be clear-eyed about why it's unclaimed, though. Honesty is a hard sell. "Our tool tells you what it doesn't know" competes against "our tool tells you the answer," and a buyer under pressure often prefers the confident answer even when it's wrong. Where it does win is regulated industries — banking, insurance, healthcare — where "prove it" is a procurement requirement with budget attached. That's your ICP, and it happens to be the domain you already know.

Compatibility drift is the strongest wedge, and the research made me more confident, not less. Config drift tools check one component against its own desired state. Contract drift is API-level. Static analysis is build-time. Nobody asks whether the versions of the eleven things a request touches are mutually compatible. The tell: IBM's CCSID material exists as support pages you find after it breaks, and people solve Spring version compatibility by maintaining hand-written cheatsheets. That's what an unserved need looks like — and it's the cheapest thing you can build.

The risk nobody has raised, and it's bigger than feasibility. Technical feasibility is settled. The real risk is data gravity — observability is winner-take-most because whoever holds your telemetry compounds their advantage. Getting an enterprise to run a second agent alongside Dynatrace is brutal, for budget and political reasons, not technical ones.

Here's the asset you may not have noticed: VITALIS ingests standard OTLP. It needs no agent of its own. It can consume telemetry the incumbent already collects. That changes the sale from "replace your stack" — which you lose — to "point your existing OTel pipeline here too, and get the layer your current tool structurally cannot provide." Sidestepping data gravity instead of fighting it.

Overall: as request-centric observability with RCA, this is a me-too product against entrenched incumbents with years of training data you don't have. As the compatibility-and-evidence layer sitting on top of the observability they already own, it's differentiated, cheap to prove, and sold to a buyer nobody is serving. Same code, same engine, completely different odds.

Build order: Compatibility (23) → Evidence layer (14) → Change intelligence (18/25) → Migration (19) → Request RCA last, if ever.

One last thing worth saying plainly: across this project I kept finding fabricated numbers in the codebase — a Math.random() "cryptographic signature," RCA evidence printing fixed values regardless of input, a benchmark report with no benchmark. Every time, the honest fix made the product better. That instinct is the thing a competitor can't ship in a quarter, because it means shipping fewer confident green ticks.

Sources: Dynatrace RCA concepts · Datadog vs Dynatrace RCA gaps · Speedscale legacy migration · Keploy record-replay · Shadow testing playbook · Tap-compare testing · Config drift detection


These 13 scenes change my read materially. Let me check the internal arithmetic before I comment on it — that's where mockups usually leak.

Ran 2 commands, used a tool

These changed my read, mostly in your favour — and the two strongest ideas aren't the ones I'd have guessed.

Scene 14 is the product. Everything else is a feature. Alternative hypotheses tested and ruled out with the evidence that killed each one. A dedicated "what we don't know" panel. "What could change our mind." Evidence split 60.9% Direct / 32.5% Derived / 6.6% Inferred with per-item trust scores. That's the scientific method as an ops screen. Davis gives you an answer; it doesn't show you the four hypotheses it rejected or what would overturn its conclusion. And it's largely already built — the engine already tags provenance, records contradicting evidence, and says "insufficient evidence" rather than guessing.

Scene 23 is the sleeper hit, for a reason easy to miss: it barely needs the expensive machinery. Compatibility data is static configuration, not per-request telemetry. Read each hop's version once, compare against a support matrix, flag drift. No sampling problem, no terabytes, no ML. And your CCSID 1208-vs-819 example is exactly the class of bug that's agonising precisely because every component reports itself healthy — nothing is down, the request just fails, and four teams each prove it isn't them. Scenes 13/20/24 need the full pipeline and fight Dynatrace head-on. Scene 23 is cheap and novel.

That inverts the build order. These aren't 25 features — they're five products on one engine: Request RCA (crowded, expensive), Change Intelligence, Migration Assurance, Compatibility Drift, and Security/CVE. Build the cheap novel ones first and let them fund the expensive crowded one.

On the arithmetic — I checked it, and credit where due. Scene 20's waterfall is exact: eleven hops summing to precisely 8,642ms with every percentage share correct. SLA breach 332% ✓. Asset coverage 98.66% ✓. You've been careful where it counts.

But Scene 22's CVE donut is wrong on every slice — Low is labelled 27% when 67/116 is actually 57.8%, Critical says 9% when it's 3.4%. The counts total 116 correctly; the percentages come from a different dataset. A security reviewer checks that donut first.

Four things to fix before anyone sees this:

92% confidence appears in nine scenes unchanged. A score that never moves reads as hardcoded. Your code is better than the mockup — it computes 70%, 85%, 93.7% from real evidence in different test runs.
"Revenue ₹1,25,000" and "Users Impacted 124" aren't things VITALIS can know. Revenue needs a value-per-transaction mapping from the business. And counting distinct users collides directly with your own privacy_sanitizer — you can't both redact PII and count distinct users without a stable pseudonymous id.
Prediction accuracy and 7-day risk need months of incident history. Year-two panel, greyed out.
Scene 17 shows models auto-deploying. A model that changes RCA conclusions in production needs the same approval rigour you built for remediation. Your governance covers actions but not the models recommending them — that's a real gap.

One thing you get right that most products don't: you keep showing the incomplete parts — 98.7% coverage, a failing 42/100 compatibility score for DB2, a whole panel of gaps. Protect that instinct; the pressure will be to make every panel green for the demo.

Change the lead. Not "we follow the request end to end" — that invites a comparison you lose. Lead with Scene 14 plus Scene 23: your tools tell you what's wrong; VITALIS tells you what it doesn't know, what it ruled out, and what would change its mind — and it catches the version drift that makes every component look healthy while the request fails.

This deserves a rigorous answer rather than a restatement. Let me ground the competitive claim before I make it.

Searched the web, loaded tools, ran a command · 1 note

Your thesis, in one line: the request is the unit of truth, not the component. Every app takes a request and returns an output — so follow the request, stay silent when it's healthy, and catch it at the point of deviation when it isn't. Everything else you listed (recovery, downtime, escalations, migrations, compatibility) isn't a separate feature list. They're all consequences of that one idea.

What makes it technology-agnostic — every technology on earth needs exactly two questions answered: can I get evidence out of it, and can the trace id travel through it? That gives four tiers. Tier A speaks OTel natively (zero work). Tier B has a monitoring surface and a field you can stamp — Postgres, DB2, Oracle, SQL Server, MySQL, MQ, Kafka. Tier C has telemetry but can't carry identity — firewalls, DNS, load balancers, so you correlate by time and label it CORRELATED, never OBSERVED. Tier D has nothing usable, so you show the gap.

Tier C and D are the product, not the embarrassment. Every tool shows what it sees; almost none show what they're blind to. That's the hardest thing to copy, because it's a values choice.

Feasible? Yes — with one architectural decision and four corrections.

The decision: you cannot keep full fidelity for every request at production volume. At 1,000 req/s with the detail in your images, that's terabytes a day. The answer is tail-based sampling — decide after the request finishes, keep 100% of anything that deviated and a small slice of the healthy. The industry reports 60–95% cost reduction from exactly this. It maps perfectly onto your green-pipeline idea and needs designing in now, not later.

The four corrections — a sharp CTO will find these, so better you do first:

DNS isn't per-request. Your Scene 2 shows a 300s TTL. One resolution serves every request in that window; the rest are 0ms cache hits.
TLS handshakes aren't per-request. Your own Scene 4 shows Session Resumption: Resumed — you've already drawn the contradiction.
Firewall decisions are per-connection. Your Scene 3 shows Connection State: NEW. Stateful firewalls evaluate the connection once, then pass packets.
Confidence Score (initial): 100% measures nothing, and "predicts normal behavior for next 1 hour" needs a trained model you won't have on day one.

The fix for the first three is the same and it improves the product: show them as connection context attached to the request — "this request rode connection C-4471, TLS 1.3, allowed by rule FW-ALLOW-PAYMENT-443." Accurate, still valuable, survives scrutiny.

The hardest thing I have to tell you: following a request end to end is not novel. Dynatrace, Datadog, New Relic, Jaeger and Tempo all do distributed tracing, and Davis/Watchdog both do automated trace-based RCA. Pitch "we follow the request" to a CTO who owns Dynatrace and you lose the room in ninety seconds.

Your real differentiators are narrower and stronger: the ends of the journey that APM doesn't cover, attribution into non-OTel systems (which request held the lock), provenance discipline, and — the one I'd actually lead with — migration and compatibility diffing. RequestDNA.compare() proves a request behaves identically on the new stack. Nobody sells that well, it maps to two of your stated goals, and you already have the primitive built. It's an ownable wedge rather than a better-mousetrap claim.

Full analysis is in the project. Worth deciding the wedge before building anything more — both share the same engine, so it only changes what the demo leads with.

Sources: Datadog — distributed tracing · Dynatrace — distributed tracing docs · Datadog — tail-based sampling · OpenTelemetry cost reduction


Proposing it internally is a better first move than trying to sell it — and the stack you listed actually strengthens the case, for a reason worth being precise about.

The stack tells me something useful

AppD + Patrol + Prometheus + Splunk (+ GCL) is a fragmented stack, not a unified one. That matters more than the number of tools:

AppDynamics — agent-based traces, business transactions, Java/middleware tier
BMC Patrol — component/host KPIs, the most component-centric tool on the list
Prometheus — metrics, likely the k8s/cloud side, no request identity at all
Splunk — logs
GCL — cloud-side logs (assuming Google Cloud Logging)

Each one sees a slice. Nobody owns the seams between them. A request that starts in an AppD-instrumented Java app, crosses MQ watched by Patrol, and ends in a Prometheus-scraped k8s service loses its identity at every boundary — and today that gets reassembled by a human on a bridge call, correlating timestamps across four consoles. That reassembly-by-human is the actual pain, and it's exactly VITALIS's thesis.

If the org ran a single unified Dynatrace, I'd tell you not to bother. Fragmentation is your opening.

The three things that will decide this

1. Does anything emit OTLP today? This is the make-or-break question and you should answer it before you propose anything. AppD is proprietary and agent-based; Prometheus is metrics with no trace context; Splunk logs may or may not carry trace IDs. If there is no OpenTelemetry pipeline, then VITALIS's Tier A "zero adapter" advantage doesn't exist in this org yet — and what you'd actually be proposing is an instrumentation programme with a tool attached. That's a much bigger ask, and it will get judged as one. Check whether any team has started OTel adoption; if one has, that team is your pilot.

2. AppD already claims to follow requests. Business Transactions are request-centric by design. If your first slide says "we follow the request end to end," the AppD owner says "that's what we pay for" and you're finished in the room. This is the same trap as the Dynatrace positioning problem in 03, just with internal politics instead of procurement.

3. A homegrown tool next to paid licences is a political object. "Why are we paying for AppD then?" is a question that threatens whoever owns those contracts — and they will be in the room. You need the proposal to be obviously additive, or that person becomes an opponent for reasons that have nothing to do with your engineering.

What I'd actually propose

Not VITALIS-the-platform. One problem they already feel, that none of those five tools answers.

The strongest candidate is the one 03 already puts first, and it fits this stack unusually well: compatibility drift. Nothing in AppD, Patrol, Prometheus, Splunk or GCL answers "are the versions of the eleven things this request actually touches mutually compatible?" It's static config comparison — no telemetry volume, no sampling, no ML, no overlap with any existing licence, and no threat to anyone's tool. In a middleware estate with MQ and app servers, CCSID and driver-version mismatches are real and recurring.

The second, positioned carefully, is the coverage map: where does request visibility genuinely stop in this org? Rendered honestly, with UNKNOWN where the tooling doesn't reach. That's politically safe — it makes the existing tools look thorough where they are, and honest about where they aren't — and it's information no one currently has.

The proposal itself should not be a demo. Take one real incident from the last six months that burned multiple teams across multiple consoles, and show what VITALIS would have shown at minute three instead of hour two. One reconstructed incident beats any amount of architecture.

Two things to sort out before you propose

IP. If VITALIS was built on your own time in your own repo and you then propose it at work, ownership gets murky fast — and it's far easier to clarify now than after it's running in production. Worth a quiet check of your employment terms first.

Bus factor. Internal tools die when the author changes teams. Ask for a sponsor and a second maintainer as part of the proposal, not later.

The honest bottom line

Internal adoption is a better validation than a customer would be, and cheaper. It's also the fastest way to find out whether the epistemic-honesty thesis survives contact with real operators — if your SREs find UNKNOWN annoying rather than trustworthy, that's a finding worth more than any market research, and you'd rather learn it here than after building a company on it.

And per 03 §2: an enterprise running Patrol and AppD is likely large and regulated, which is precisely the buyer where "prove it" has budget attached. If it works internally, you'll have both a reference implementation and a real answer about the positioning.

The one thing I'd want before sharpening this further: is there any OTel/OTLP in the org today, and who would you be pitching to — an SRE lead, an architecture board, or your own manager? The proposal looks quite different for each. Happy to turn this into docs/09_Internal_Adoption_Proposal.md once you tell me.