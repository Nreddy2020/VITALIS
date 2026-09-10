# 24 — Stage 14 Completion Log: Learned Request Baselines

**Date:** 2026-09-09
**Status:** Built and verified by execution. 8/8 new gates pass; all 17 suites pass.
**Run it:** `npm run test:stage14`
**Artifacts:** `artifacts/stage14-baseline-gate-report.json`

**This is the most serious defect found in the project so far, and it sat at the centre of the
product.**

---

## 1. The defect

`initGoldenPath()` created exactly one baseline, hardcoded:

```
Client -> F5-LB -> IHS -> WebSphere -> IBM-MQ -> DB2 -> Stripe     (180ms)
```

Every real ingested trace was compared against it. A real FastAPI request produced, verbatim:

```
Structural Deviation: Expected [Client->F5-LB->IHS->WebSphere->IBM-MQ->DB2->Stripe],
                      observed [ledger-api->ledger-api->ledger-api->ledger-api]
```

So: **100% of real traffic flagged as deviating**, against a baseline that was fiction, with a
message telling the operator their request should have travelled through WebSphere and DB2.

A tool that alerts on everything alerts on nothing. This one was also actively misleading, and it
undercut the product's core claim — *follow the request, stay silent when healthy, catch it at the
point of deviation* — because "deviation" was measured against something that had nothing to do
with the request.

**This is the fourth instance of the same drift**: IBM (`01` §9), Expo (`19`), JavaScript (`21`),
and now the demo fixture itself. Each time the code worked on the example in front of it.

---

## 2. How it was found

Not by reading the code, and not while looking for it. A real Python trace came back with
`rca: undefined` and empty evidence, which looked odd enough to chase. Reading `evaluateTrace`
led to `this.goldenDNA`; running a real request confirmed the output above.

The pattern from `21` §8 holds exactly: *the limitation was invisible until something different
was pointed at it.*

---

## 3. What replaced it

`engine/baseline_learner.js` — baselines **learned from this system's own healthy traffic**, per
request identity.

**Request identity** is the service plus the root span's name — for OTel-instrumented HTTP
handlers that is the route template (`GET /orders/{id}`), not the concrete URL, so every order id
shares one baseline and the sample sizes mean something.

**A baseline holds** the set of hops the request normally touches, and the distribution of its
total duration (p50, p95, min, max).

**The honesty rules are the point:**

1. **Below 5 healthy observations there is no baseline.** The verdict is `UNKNOWN` — never
   "healthy", never "deviation". *A new request is not a broken one, and it is not a verified one
   either; it is unmeasured, and the API says so.*
2. A baseline is only compared against **the same request identity**. Comparing across identities
   is precisely what produced the fiction above.
3. Only healthy traces are learned from.
4. Every verdict carries its evidence: the key, sample size, threshold, and how the threshold was
   derived.

Back-compat matters here: `diff.isIdentical` is now **`null`** — not `true` — when there is no
baseline, so "no deviations found" can never be misread as "verified healthy".

---

## 4. Two further defects the gates exposed

**The baseline absorbed the outage.** `isHealthy()` excluded only `ERROR`, so a 2,814ms `DEGRADED`
trace was learned into its own baseline and raised its p95. Left alone, enough slow requests make
"slow" normal and the tool goes quiet at exactly the wrong moment. `DEGRADED` is now excluded too,
and gate B5 fires 40 bad traces at a baseline and asserts its p95 does not move.

**Request identity changed when a request got slow.** The root span was originally "the
longest-running span". So when the database hop blew out to 9 seconds, *it* became the root, and
the request's identity flipped from `orders-api::GET /orders/{id}` to `postgres::SELECT orders` —
meaning the request stopped matching its own baseline at the exact moment it broke. The root is
now found structurally via `parentSpanId` (newly retained on ingest), with a deterministic
tie-break that is never duration-based. Gate B6 pins it.

---

## 5. A false pass in the existing suite

Alpha Gate 3 — "Golden Path Baseline Deviation Engine" — asserted `!diff.isIdentical`. Once
`isIdentical` became `null` for an unmeasured request, `!null` is `true`, and **the gate passed
vacuously with 0 deviations and an undefined message.** It would have passed for any trace on
earth, including a perfectly healthy one.

It has been rewritten to test the real claim: assert `UNKNOWN` before any baseline exists, feed six
healthy observations of the same request shape, then assert the 2,814ms outlier is caught as a
`LEARNED` deviation with percentile evidence. It now reads:

```
> With no baseline yet : verdict UNKNOWN (must be UNKNOWN, never HEALTHY)
> After 6 healthy observations : baseline LEARNED from 7 samples
> Verdict   : DEVIATION (source: LEARNED)
> Deviation : total 2991ms exceeds the deviation threshold of 300ms
> Evidence  : p50 197ms, p95 200ms over 7 healthy observations;
>             threshold = max(p95 x 1.5, p95 + 50ms)
```

`00` §5 already warned that *a silent empty result is not a pass*. This is that warning coming true
inside the test suite meant to enforce it.

---

## 6. The gates

| Gate | What it proves | Result |
|---|---|---|
| B1 | No baseline → UNKNOWN, never HEALTHY | PASS |
| B2 | After enough healthy observations, normal traffic reads HEALTHY | PASS |
| B3 | A latency outlier is a DEVIATION, with percentile evidence | PASS |
| B4 | A hop that normally exists but is absent is a DEVIATION | PASS |
| B5 | 40 degraded/errored traces do not move the baseline's p95 | PASS |
| B6 | Request identity is stable when a hop gets slow | PASS |
| B7 | Two different requests never share a baseline | PASS |
| B8 | Baselines rebuild from persisted traces after a restart | PASS |

---

## 6b. Two more found by looking at the rendered console

Running the Stage 2 GUI suite (which had not been executed since Stage 2, while `server.js` changed
substantially) passed — but reading the actual screen found two things the gates did not cover.

**The console rendered an unmeasured request as green.** With `diffCount` 0 for an UNKNOWN verdict,
the summary cell used class `ok` and the caption read *"No deviation from the golden baseline."*
So "nothing found" and "nothing checked" looked identical — non-negotiable #4 broken by the UI
itself, in the one place an operator actually looks. The console now shows a three-state VERDICT
(HEALTHY / DEVIATION / UNKNOWN), a `Baseline: NONE` cell, `Learned p95: UNKNOWN`, and the reason in
full. New **gate G5** asserts the verdict cell is not green and the old caption is gone.

**The RCA was still dividing by a hardcoded 18.** The screenshot showed:

> *DB span duration (1623ms) is 90x higher than Golden Baseline (18ms) — OBSERVED*

`latencyRatio = Math.round(dbHop.durationMs / 18)` — a demo number, printed as measured, and fed
into `calculateRcaConfidence` where >100x adds 20 points and >10x adds 10. **A fabricated divisor
was inflating a confidence score presented to operators as evidence.** The baseline now keeps
per-hop p50/p95, so the ratio is against that hop's own learned normal; with no baseline the ratio
is UNKNOWN and contributes **nothing** to the score rather than being invented.

Both were found by looking at the rendered output, not by reading code or running tests. The tests
were green throughout.

---

## 7. Limits, stated plainly

- **Thresholds are fixed** (`p95 × 1.5`, floor 50ms) and not yet tunable per request. Adequate, not
  adaptive.
- **No seasonality.** A request that is legitimately slower at month-end will read as deviating.
- **A rolling window of 200 samples**, so a genuine permanent change is eventually absorbed as the
  new normal. That is usually right and occasionally wrong; nothing yet flags the transition.
- **`minObservations: 5` is a judgement call**, not a statistically derived number. It is low
  enough to be useful quickly and high enough that one fluke does not define normal.
- **Structure is compared as a set**, so a change in hop *order* is invisible. Ordering within one
  process is largely an artefact of scheduling and export batching; ordering across services would
  be meaningful and is not yet modelled.

---

## 8. Why this one matters most

The previous three drifts limited what VITALIS could be *pointed at*. This one meant that what it
said about anything it was pointed at was **wrong** — confidently, specifically, and in the exact
words an operator would act on.

Every capability built before this stage — evidence provenance, change correlation, request-scoped
drift, governed remediation — sits downstream of "is this request deviating?". They were all
being fed an answer derived from a demo fixture.

The lesson from `21` §8 is now load-bearing: **a claim is worth nothing until something outside the
original example has been run through it.** Three of the four drifts were found in the last two
sessions, by running real things through the code rather than reading it.
