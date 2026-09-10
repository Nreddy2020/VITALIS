# 25 — Stage 15 Completion Log: Hypothesis Scoring, Not "Confidence"

**Date:** 2026-09-09
**Status:** Fixed and verified by execution. All 17 suites pass.
**Run it:** `npm test` (Alpha Gate 4)

The last unaudited number in the RCA path — the one rendered next to every hypothesis as
**"93.7%"**.

---

## 1. What was wrong

```js
function calculateRcaConfidence({ latencyRatio, poolSaturation, queryFingerprintMatched, cpuSaturation }) {
  let score = 50.0;
  if (latencyRatio > 100) score += 20.0;
  else if (latencyRatio > 10) score += 10.0;
  if (poolSaturation > 90) score += 15.0;
  if (queryFingerprintMatched) score += 10.0;
  if (cpuSaturation < 70) score -= 1.3;   // ← the tell
  return Math.min(99.9, Math.max(10.0, ...));
}
```

**It was presented as a confidence percentage.** It is a hand-weighted checklist. `-1.3` implies a
calibration that has never existed, and no weight here was ever derived from outcome data. An
inference dressed as a measurement — non-negotiable #3.

**And it had a demonstrable bug.** Because `undefined > 90` and `undefined < 70` are both false, an
unmeasured factor simply skipped its adjustment:

```
all evidence observed, CPU 60 (contradicting) : 93.7
CPU NOT MEASURED at all                       : 95.0   ← not looking scored HIGHER
pool NOT MEASURED                             : 80.0
pool MEASURED at 40 (contradicting)           : 80.0   ← identical
```

So **not measuring something raised the score**, and *"we did not look"* scored exactly the same as
*"we looked and it argues against this"*. That is absence of evidence treated as evidence of
absence — non-negotiable #2 — living inside the one number an operator actually reads.

**The call site was worse than the function.** It coerced absence into measurement before the
function ever saw it:

```js
poolSaturation: poolSaturationPct !== undefined ? poolSaturationPct : 0,   // "nobody measured" → "measured at 0%"
queryFingerprintMatched: !!queryFingerprint,                              // missing → false → contradicts
cpuSaturation: cpuSaturationPct !== undefined ? cpuSaturationPct : 100     // a guess picked to dodge a penalty
```

Manufacturing a contradiction out of silence is the same error as manufacturing support, and the
CPU default was a value chosen for no reason other than to move the number.

---

## 2. What replaced it

An explicit factor model. Every factor is **SUPPORTS**, **CONTRADICTS**, or **UNKNOWN**:

- `UNKNOWN` contributes **nothing** to the score, in either direction, and is counted against
  evidence completeness.
- Absence is passed through as `undefined` all the way from the adapter; nothing is coerced.
- The output carries `support` (0–100), `evidenceCompleteness` ({observed, expected, unknown[]}),
  the per-factor breakdown, and a `basis` string that says in plain words what the number is:

> *base 50 + supporting weights − contradicting weights, over OBSERVED factors only. Weights are
> hand-chosen engineering judgement, NOT calibrated against outcome data. This is a ranking
> heuristic, not a probability.*

The formula string is now generated from the factors rather than hand-assembled, so it cannot drift
away from what was actually computed:

```
base 50 | latency: +20 (122x this hop's learned p95) | connectionPool: +15 (pool saturation 98%)
        | queryFingerprint: +10 (a blocking query fingerprint was reported) | cpu: -5 (DB server CPU 62%)
        = 90 support, 4 of 4 factors observed
```

---

## 3. The console

The score was rendered as `93.7%` — a bare percentage, which reads as probability. It now renders
as **`90 support`** with the completeness line directly beneath it:

> *evidence 3 of 4 factors observed · **UNKNOWN** cpu*

**The score is never shown alone.** One residual property makes that mandatory rather than
cosmetic: a hypothesis with an unmeasured factor can still score higher than one where the factor
was measured and contradicted (95 with 3/4 observed, versus 90 with 4/4). That is unavoidable while
support is computed over observed factors only — so the completeness figure is what stops the
higher number being read as the stronger case, and it is always on screen.

---

## 4. The gate

Alpha Gate 4 asserted `candidate.confidence === 93.7` — a hardcoded constant, computed in the test
using `Math.round(2814 / 18)`, reproducing the same fabricated divisor removed in `24`. It tested
that the arithmetic had not changed, not that it was sound.

It now asserts the properties that matter, by construction rather than by constant:

- a factor **measured but contradicting** and the same factor **not measured** must produce
  **different** scores (60 vs 75 — absence is not contradiction)
- `evidenceCompleteness` is reported and bounded
- the basis string explicitly disclaims being a probability

---

## 5. One thing left for the owner, not for me

The original treated **low CPU as contradicting** the lock-contention hypothesis. Arguably it
*supports* it: a CPU-bound database would show the opposite, so low CPU with high latency is what
lock contention looks like.

That direction is a **domain judgement**, and reversing it is a product decision rather than a bug
fix, so it has been **preserved exactly as it was** and flagged here instead of quietly changed.
Middleware experience is the right input; mine is not. It is one line in `dbLockFactors()`.

---

## 6. Limits

- Weights remain hand-chosen. They are now *labelled* as hand-chosen, which is the honest state,
  not a solved one. Calibrating them needs outcome data nobody has yet.
- Only one hypothesis has a factor model. The others are still unranked.
- `confidence` is retained on the candidate for back-compat and now returns the support score, so
  older callers cannot get a number that missing evidence inflated.

---

## 7. The pattern, again

Five drifts and fabrications now, all found the same way:

| # | What | Found by |
|---|---|---|
| 1 | IBM middleware scope | The owner asking why |
| 2 | Expo folder layout in the engine (`19`) | The owner challenging generality |
| 3 | JavaScript-only OTLP ingest (`21`) | Running a real Python app |
| 4 | Deviation judged against a demo path (`24`) | Chasing an odd empty result |
| 5 | This, plus the hardcoded `/18` divisor | **Reading the rendered screen** |

Not one was found by reading code, and the test suite was green through all of them. Two were found
by the owner rather than by me.

**Run the thing. Look at what it actually shows a person.** That is the only method in this project
with a track record.
