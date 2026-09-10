# VITALIS — Review of Scenes 13–25

**Date:** 2026-09-09
**Companion to:** [[VITALIS_Thesis_and_Feasibility]]

These thirteen scenes changed my read of the project, and mostly in your favour. Two of them
contain the strongest ideas in the entire concept set, and I do not think they are the two you
would expect.

---

## 1. Scene 14 is the product. Everything else is a feature.

**Scene 14 (Evidence Truth Ledger & Confidence Envelope)** is the best thing in all 25 scenes,
and it is the one a competitor cannot copy quickly. Look at what it contains:

- **Alternative hypotheses TESTED and ruled out**, each with the evidence that killed it
  (*"Network latency issue — network latency stable 19–27ms — ✗"*)
- **Contradicting evidence given its own panel**, not buried
- **"What we don't know (gaps)"** as a first-class section
- **"What could change our mind"** — explicit falsification conditions
- **Evidence quality split by provenance**: 60.9% High (Direct) / 32.5% Medium (Derived) /
  6.6% Low (Inferred), with a per-item Trust Score

That is the scientific method rendered as an operations screen. Dynatrace's Davis gives you an
answer. It does not show you the four hypotheses it rejected, the evidence against each, or the
observation that would overturn its conclusion.

**And this is largely already built.** The engine tags every claim `OBSERVED` / `CORRELATED` /
`INFERRED` / `UNKNOWN`, records contradicting evidence, and returns *"insufficient evidence to
recommend a specific fix"* rather than guessing. Scene 14 is not aspiration — it is a UI for
behaviour the code already has.

**Lead with this.** "We show you what we don't know" is a sharper pitch than "we do RCA."

---

## 2. Scene 23 is the sleeper hit — novel *and* cheap

**Scene 23 (Compatibility Intelligence)** is the most under-rated screen you have made, for a
reason that is easy to miss: **it barely needs the expensive machinery.**

The example is excellent and real: DB2 code page CCSID 1208 (UTF-8) against 819 (ISO-8859-1)
producing SQLCODE ‑314. That class of bug — MTU mismatch causing silent fragmentation, a
deprecated JVM flag on a newer JDK, an MQ 9.2 client against a 9.3 queue manager — is agonising
to diagnose precisely because *every component reports itself as healthy*. Nothing is down.
The request just fails or slows, and four teams each prove it isn't them.

Why this is the cheapest thing in your set:

- Compatibility data is **static configuration**, not per-request telemetry. You read each hop's
  version once, compare against a support matrix, and flag drift.
- **No sampling problem.** No terabytes. No tail-based decisions.
- **No ML.** It is a matrix comparison.
- It demos without a production deployment.

Meanwhile Scenes 13, 20 and 24 (RCA, performance, troubleshooting) need the *full* ingestion
pipeline and compete head-on with entrenched APM budgets.

**That inverts the usual build order.** The novel, defensible, cheap capability is available
long before the expensive crowded one.

---

## 3. The reframe: this is not 25 features. It is five products on one engine.

| # | Product | Scenes | Market | Cost to build | Verdict |
|---|---|---|---|---|---|
| **P1** | Request RCA | 13, 14, 20, 24 | **Crowded** (Dynatrace, Datadog, New Relic) | High — full pipeline | Strongest tech, hardest sale |
| **P2** | Change Intelligence | 18, 25 | Partly served | Medium | Good; correlation honesty is the edge |
| **P3** | Migration Assurance | 19 | **Underserved** | Low–Medium | **Ownable wedge** |
| **P4** | Compatibility Drift | 23 | **Genuinely novel** | **Low** | **Sleeper hit** |
| **P5** | Security / CVE in request context | 21, 22 | Crowded, but the request angle is fresh | Medium | Partly built already |

Scene 17 (Learn & Prevent) is not a product — it is a **maturity layer** that only becomes real
after months of accumulated incidents. Treat it as year-two, not launch.

**Suggested sequence: P4 → P3 → P2 → P1 → P5.** Build the cheap novel things first, use them to
earn the right to the expensive crowded one.

---

## 4. Where the scenes and the code already agree

More than you might expect. These are not gaps — they are already done:

| Scene shows | Code status |
|---|---|
| Evidence provenance & trust scoring (14) | Built — `OBSERVED`/`CORRELATED`/`INFERRED`/`UNKNOWN` |
| "What we don't know" / gaps (14) | Built — unreported attributes render `UNKNOWN`, never fabricated |
| Two approvers: DBA Lead + App Owner (15) | Built — two-person rule, distinct-signer enforced |
| Sandbox replay before execution (15) | Built — dry run is the *default*, execution off unless enabled |
| Rollback plan ready (15, 16) | Built — failed verification rolls back automatically |
| Audit trail / immutable store (14, 15) | Built — SHA-256 hash-chained ledger |
| Change→impact correlation scores (18, 25) | Built — real git history, honest "no correlation" answer |
| Vulnerable components in request path (22) | Built — `/api/impact/:advisoryId` |
| Old vs new hop comparison (19) | Primitive built — `RequestDNA.compare()` |
| Compatibility matrix (23) | **Not built** — and it is the cheapest thing on this list |

---

## 5. Problems to fix before this goes in front of anyone

**The arithmetic — I checked it.** Credit where due: **Scene 20's waterfall is exact.** The
eleven hop durations sum to precisely 8,642 ms and every percentage share is correct to one
decimal. Scene 13's SLA breach (332%) and Scene 22's asset coverage (98.66% ≈ 98.7%) are also
right. You have been careful where it counts.

But **Scene 22's CVE distribution donut is wrong on every slice**:

| Severity | Count | Chart says | Actually |
|---|---|---|---|
| Critical | 4 | 9% | **3.4%** |
| High | 12 | 26% | **10.3%** |
| Medium | 28 | 30% | **24.1%** |
| Low | 67 | 27% | **57.8%** |
| Info | 5 | 8% | **4.3%** |

The counts total 116 correctly; the percentages are from a different dataset. A security reviewer
will check that donut first. (Scene 19's old-stack column also sums to 1,290 ms against a stated
1,420 ms — a 130 ms gap, probably the return leg, but worth reconciling.)

**Four substantive issues:**

1. **Confidence is 92% in nine different scenes.** A score that never moves is decoration, not
   information — and a sharp reviewer reads it as hardcoded. Your *code* is better than the
   mockup here: it computes 70%, 85%, 93.7% from actual evidence in different real test runs.
   Vary it in the visuals, and show the formula.

2. **"Revenue Impact ₹1,25,000" and "Users Impacted 124" are not things VITALIS can know.**
   Revenue requires a value-per-transaction mapping the business must supply. And counting
   *distinct users* requires user identity in the trace — which collides directly with your own
   `privacy_sanitizer`, which redacts PII. **You cannot both redact PII and count distinct
   users** unless you adopt a stable pseudonymous id and say so explicitly. Present these as
   *"affected requests × your configured value"*, not as measurements.

3. **"Prediction Accuracy 91%", "Risk Prediction (Next 7 Days)", "Automation Coverage 78%"** —
   the first two need a trained model with months of incident history; the third has no defined
   denominator. These belong in a year-two panel, greyed out, not in the launch story.

4. **Scene 17 shows models auto-deploying** (v2.4.7, v3.1.2, v5.2.0 — "Deployed"). A model that
   changes RCA conclusions in production needs the *same* approval rigour you already built for
   remediation. Right now the governance covers actions but not the models that recommend them.
   That is a real gap, and a governance reviewer will find it.

---

## 6. One thing the scenes get right that most products get wrong

Scene 22 says **"Asset Coverage 98.7% (2,143/2,172)"** and Scene 23 scores compatibility
per hop including a *failing* 42/100 for DB2. Scene 14 devotes a whole panel to gaps.

You keep showing the incomplete parts. That instinct is the product's real moat, and it is worth
protecting as the design matures — the temptation will be to make every panel green for the demo.

---

## 7. Recommendation

Change the lead. Not *"we follow the request end to end"* — that is table stakes and invites a
comparison you will lose. Lead with:

> **"Your tools tell you what is wrong. VITALIS tells you what it does not know, what it ruled
> out, and what would change its mind — and it catches the version drift that makes every
> component look healthy while the request fails."**

That is Scene 14 plus Scene 23. Both are defensible, one of them is cheap to build, and neither
is a claim Dynatrace can answer in a bake-off.
