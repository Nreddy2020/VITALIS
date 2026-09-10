# 09 — Internal Adoption Proposal

**Date:** 2026-09-09
**Question:** Should VITALIS be proposed as an internal implementation in an organisation that
already runs AppDynamics, BMC Patrol, Prometheus, Splunk and Google Cloud Logging?
**Short answer:** Yes — but not as a platform, and not with the framing the project currently uses.

This document is strategy, not a completion log. Nothing here is verified against the
organisation in question. **Section 10 lists what this document does not know**, and those gaps
must be closed by the owner before any of this is said out loud.

---

## 1. Why internal-first is the right move

`03_Competitive_Reality.md` §5 concluded that the real risk to VITALIS is not feasibility but
**distribution and data gravity** — persuading an enterprise to deploy a second agent alongside an
incumbent is a budgetary and political fight, not a technical one.

Internal adoption removes that fight entirely. There is no procurement cycle, no displacement
sale, and no need to convince a stranger. It is also the cheapest available test of the thesis
that everything else depends on:

> Does an operator under real incident pressure find `UNKNOWN` **trustworthy**, or **annoying**?

Nobody knows the answer to that yet. `03` §2 flags the risk plainly — epistemic honesty does not
demo as well as a green tick. Real SREs on a real bridge call will settle it in weeks, and that
finding is worth more than any market research. Learn it here rather than after building a
company on it.

**What internal-first is not:** it is not a soft launch, and it is not a way to avoid the
positioning problem. The same discipline applies. If anything, internal users are harsher — they
can see the seams.

---

## 2. The stack, read honestly

The listed estate is **fragmented, not unified**. That distinction decides whether this is worth
proposing at all.

| Tool | What it genuinely covers | Where it stops |
|---|---|---|
| **AppDynamics** | Agent-based traces, Business Transactions, app/middleware tier | Proprietary agent; coverage ends where the agent is not installed |
| **BMC Patrol** | Host, infrastructure and middleware KPIs | Component-centric by design — no request identity at all |
| **Prometheus** | Metrics, typically the container/k8s estate | Metrics only; a request cannot be followed through it |
| **Splunk** | Logs, search, correlation dashboards | Correlation is hand-built and depends on log fields being present |
| **GCL** (assumed Google Cloud Logging — **UNVERIFIED**, see §10) | Cloud-side logs | Cloud boundary only |

**Each tool sees a slice. Nobody owns the seams between them.**

A request that begins in an AppD-instrumented Java application, crosses MQ observed by Patrol, and
terminates in a Prometheus-scraped container loses its identity at every boundary. Today that
identity is reconstructed **by a human on a bridge call, correlating timestamps across four
consoles.** That reconstruction-by-human is the actual pain, and it is precisely what this project
was built to remove.

> **If this organisation ran a single unified Dynatrace deployment, the honest recommendation
> would be: do not bother.** Fragmentation is the opening. Say so plainly rather than pretending
> the tools are worse than they are.

---

## 3. Three preconditions — verify before proposing anything

These are ordered by how badly a wrong assumption hurts.

### 3.1 Does anything in the estate emit OTLP today? *(make or break)*

VITALIS ingests standard OTLP and needs no agent of its own. That is its single biggest structural
advantage (`03` §5) — **and it only exists if OpenTelemetry is already in the pipeline.**

- AppDynamics is proprietary and agent-based
- Prometheus is metrics — it carries no trace context
- Splunk and GCL hold logs, which may or may not carry trace or correlation IDs

**If no OTel pipeline exists, then what is being proposed is an instrumentation programme with a
tool attached** — a far larger ask, and it will be judged as one. Do not discover this in the
room.

*How to check:* find out whether any team has begun OTel adoption, whether any service emits
OTLP to a collector, and whether AppD is being evaluated for OTel ingest. **If exactly one team
has started, that team is the pilot** — it is the only place where the zero-adapter claim is true
today.

### 3.2 AppDynamics already claims to follow requests

Business Transactions are request-centric by design. If the first slide says *"we follow the
request end to end,"* the AppD owner answers *"that is what we already pay for"* — and the meeting
is over.

This is the same trap `03` §1 identifies with Dynatrace, transplanted into internal politics.
**Never lead with request-following.** Lead with what no tool in the estate does (§4).

### 3.3 A homegrown tool beside paid licences is a political object

*"Why are we paying for AppD, then?"* is a question that threatens whoever owns those contracts —
and that person will be in the room. If the proposal reads as displacement, they become an
opponent for reasons unrelated to the engineering.

**The proposal must be visibly additive.** It consumes telemetry the estate already produces, it
replaces nothing, and it makes the existing tools look thorough where they genuinely are.

---

## 4. What to propose — one problem, not a platform

Do not propose VITALIS. Propose **one problem the organisation already feels** that none of the
five tools answers.

### Primary: compatibility drift

`03` §4 ranks this first on the merits, and it fits this estate unusually well:

- **No tool in the list answers it.** Configuration-drift tools check one component against its
  own desired state. API contract tooling stops at the API boundary. Nothing asks *"are the
  versions of the eleven things this request actually touches mutually compatible?"*
- **It needs no telemetry volume** — static configuration comparison. No sampling, no ML, no
  storage argument, no cost conversation.
- **It threatens no licence**, so §3.3 does not fire.
- **It is native to a middleware estate.** Driver, client-library and codepage/CCSID mismatches
  across app servers and MQ are real, recurring, and currently solved with hand-maintained
  cheatsheets and support pages found *after* the outage.

### Secondary: the coverage map

Where does request visibility genuinely stop in this organisation? Rendered honestly, with
`UNKNOWN` wherever tooling does not reach.

This is politically the safest thing the project can produce: it credits each tool for what it
actually covers and is candid about the seams. **No one currently holds this information**, and
producing it costs nothing but inventory work.

### Explicitly do not lead with

Request RCA, the remediation engine, the approval governance, or the nine-plane architecture.
All are real; none of them are the wedge. The build order in `03` §6 applies internally exactly as
it does commercially.

---

## 5. The proposal artefact: one reconstructed incident

**Do not demo.** A demo invites feature comparison against AppD, which is a comparison this
project does not need to win.

Instead: take **one real incident from the last six months** that burned multiple teams across
multiple consoles, and show what VITALIS would have surfaced at minute three instead of hour two —
including, honestly, the parts it would still have marked `UNKNOWN`.

One reconstructed incident that the people in the room personally suffered through beats any
amount of architecture. It also demonstrates the epistemic discipline in the only setting where
its value is self-evident: an outage where somebody guessed wrong.

---

## 6. Branching on §3.1

**If OTLP already exists somewhere:** propose a bounded pilot on that one service or team.
Compatibility drift plus the coverage map, observe-only, no remediation, four to six weeks, with a
named success test agreed in advance (§9).

**If no OTLP exists anywhere:** do not propose the tool yet. Propose the **compatibility drift
capability alone** — it runs off configuration inventory and needs no traces at all. It delivers
value with zero instrumentation, and it earns the credibility to have the OTel conversation later,
on its own merits rather than as a dependency of your project.

This branch matters: proposing the full engine into an estate with no OTel is how a good idea gets
labelled impractical and never comes back.

---

## 7. Objections you will get

| Objection | Honest answer |
|---|---|
| *"AppD already does this."* | For the tiers where its agent runs, largely yes. This covers the boundaries between tools — and version compatibility, which no APM product addresses. |
| *"Why are we paying for AppD then?"* | This consumes what those tools produce. It replaces nothing and displaces no licence. |
| *"Isn't this a Splunk dashboard?"* | Splunk can correlate what is in the logs. It cannot tell you a lock was held by *this* request, and it cannot compare versions across a path. |
| *"This is shadow IT."* | Correct as a risk. That is why the proposal asks for a sponsor, a second maintainer, and a defined review point (§8). |
| *"Who supports it at 3am?"* | Nobody, and it must never be in the critical path. The architectural invariant already guarantees this: VITALIS observes production; production never depends on VITALIS. |
| *"What happens when you leave the team?"* | The most legitimate objection on this list. Answer it before it is asked (§8). |

---

## 8. Settle these before you propose

**Intellectual property.** VITALIS was built on personal time in a personal repository. Proposing
it for internal use makes ownership ambiguous, and that ambiguity is far cheaper to resolve now
than after it is running against production telemetry. Check the employment terms, and decide
deliberately whether this is contributed, licensed, or rebuilt in-house.

**Bus factor.** Internal tools die when their author changes team. Ask for a sponsor and a second
maintainer as part of the proposal, not as a follow-up.

**Repository visibility.** The GitHub repository is public. It must be private before any push,
and certainly before any conversation that references it internally.

**Data handling.** Anything ingested from production telemetry carries whatever the organisation's
data classification rules say it carries. Establish this before the first byte, not after.

---

## 9. What success looks like — and what would falsify the thesis

Agree the success test *before* the pilot, or the result will be argued afterwards.

**Success:** on at least one real incident, the coverage map or the drift check shortened the path
to the answer, or prevented a wrong answer — as judged by the engineers who worked it, not by a
dashboard.

**Falsification — take these seriously:**

- Operators consistently ignore or resent `UNKNOWN` and want a confident answer instead. *This
  would undermine the central product thesis, not just the pilot.*
- The drift check finds no genuine mismatches over a meaningful period, meaning the problem is
  less common here than assumed.
- Everything found would have been found equally fast in AppD by someone who knew it well.

**If any of these hold, say so and record it.** A negative result recorded honestly is consistent
with the charter; a pilot quietly declared a success is not.

---

## 10. What this document does not know

Stated explicitly, in keeping with `01` §non-negotiables — none of the below has been verified,
and no part of this proposal should be presented as fact until it is:

- **`GCL` is assumed to mean Google Cloud Logging.** Unconfirmed.
- **Whether any OpenTelemetry or OTLP pipeline exists in the organisation.** Unknown — and it is
  the single most consequential gap in this document (§3.1).
- **The audience.** An SRE lead, an architecture board and a line manager each require a different
  proposal. Unknown.
- **Which tools are actually authoritative in practice.** Estates commonly retain licences that
  nobody uses; the org chart and the reality often differ.
- **Whether the fragmentation described in §2 causes real, felt pain here**, or is merely
  structurally true. The whole argument rests on it being felt.
- **The organisation's regulatory posture.** `03` §2 identifies regulated environments as where
  evidentiary rigour has budget; whether that applies here is unverified.
- **Any incident history.** §5 depends on a real incident that has not yet been identified.

**Close §10 before §1–§9 are used.** A proposal built on assumed answers to these questions is the
same failure this project exists to prevent.
