# 17 — Stage 9 Completion Log: Compatibility Drift

**Date:** 2026-09-09
**Status:** Built, and verified by execution. 9/9 gates pass.
**Run it:** `npm run test:stage9` · `npm run drift -- <path-to-any-repo>`
**Artifacts:** `artifacts/stage9-drift-gate-report.json`

This is the capability `03_Competitive_Reality.md` §4 ranked first: **nothing on the market asks
whether the versions of the things a request actually touches are mutually compatible.**
Configuration-drift tools check one component against its own desired state. API contract tooling
stops at the API boundary. The industry's real answer is a hand-maintained cheatsheet you go and
read *after* the build breaks.

It needs no telemetry, no sampling, no ML and no storage — it reads dependency manifests. That is
also why it is the right thing to lead with internally (`09` §4).

---

## 1. What was built

| File | Responsibility |
|---|---|
| `engine/drift/version_ops.js` | Version comparison over a **closed operator vocabulary** |
| `engine/drift/manifest_reader.js` | Reads npm + pip manifests; keeps *declared* and *resolved* apart |
| `engine/drift/compatibility_rules.js` | The sourced rule set, and the admissibility check |
| `engine/drift/drift_checker.js` | Evaluation, provenance, and coverage accounting |
| `engine/drift/check.js` | CLI — read-only, no network, no application source |
| `tests/verify_stage9_drift_gates.js` | 9 gates |

**It is read-only by construction.** It opens `package.json`, `package-lock.json`, `app.json`,
`eas.json` and `backend/requirements.txt`. It does not read `.env`, application source, or anything
else, and it makes no network calls at run time.

---

## 2. The three design decisions that matter

### 2.1 A closed operator vocabulary, not a general semver engine

A general range evaluator has a large surface, and its failure mode is silent: a range form it
half-understands returns "satisfied", and a real incompatibility is reported as healthy.

So rules may use only `exact`, `majorEquals`, `minorMatch`, `gte`, `gt`, `lte`, `lt`, `boolEquals`.
Anything else returns `UNKNOWN` with a reason. **A range string is never accepted as a version** —
`^0.81.0` is an intention, not a fact, and evaluating a rule against it silently would assert
something about a version that may never be installed.

### 2.2 Unsourced rules are refused at load time

`loadRules()` throws on any rule without a resolvable `source.url` and `recordedAt`.

This is the fabrication guard, and it is aimed squarely at the way this exact file would otherwise
go wrong. A version-compatibility matrix is the easiest thing in this codebase to write from
memory and the hardest to audit afterwards — every row looks equally plausible, and nothing in the
output distinguishes a documented pairing from a confidently recalled one. Every rule shipped here
was read from a live vendor source today; the sources are in §3.

**Coverage is deliberately partial.** Expo SDKs below 53 have no rules, because the version table
consulted did not list them. Adding guessed rows to reduce the `UNKNOWN` count would defeat the
entire purpose of the tool.

### 2.3 "No violations" is never rendered as "compatible"

With partial rule coverage those are completely different statements, and conflating them is how a
drift tool becomes a green tick that means nothing. Every run reports:

```
COVERAGE
  dependencies read      : 70
  covered by a rule      : 5
  NOT covered (UNKNOWN)  : 65
```

and the summary sentence is written so it cannot be quoted as a clean bill of health:

> *65 of 70 dependencies are covered by no rule — their compatibility is UNKNOWN, which is not the
> same as compatible. No violation was found among the rules that exist. That is a statement about
> the rules, not about the application.*

Findings carry the engine's existing provenance vocabulary. A finding evaluated against a version
resolved from a lockfile is `OBSERVED`; one evaluated against the floor of a declared range is
`INFERRED` and says so inline.

---

## 3. Rule sources

Every rule carries these, and the CLI prints the URL with each finding.

| Source | Used for |
|---|---|
| [Expo SDK reference — version table](https://docs.expo.dev/versions/latest/) | SDK 54–57 → React Native / React / react-native-web / minimum Node |
| [Expo SDK 53 changelog](https://expo.dev/changelog/sdk-53) | SDK 53 → React Native 0.79 |
| [Expo — React Native New Architecture](https://docs.expo.dev/guides/new-architecture/) | New Architecture mandatory from SDK 55 |
| [npm registry metadata for expo-random](https://registry.npmjs.org/expo-random) | Publisher deprecation in favour of `expo-crypto` |

19 rules load. All 19 carry a source URL and a recorded date.

---

## 4. The gates

All nine pass. Roughly half exist to prove the checker is honest about the limits of its own
knowledge, because *reporting "no problems" when it simply had no rule to apply* is the more
dangerous of the two failure modes.

| Gate | What it proves | Result |
|---|---|---|
| D1 | A real incompatibility (SDK 57 + RN 0.85) is caught | PASS |
| D2 | A correct pairing (SDK 54 / RN 0.81.5 / React 19.1.0) is SATISFIED | PASS |
| D3 | An SDK with no rule (51) yields **no findings**, and the summary says so rather than reporting health | PASS |
| D4 | Uncovered dependencies counted as UNKNOWN; summary never claims compatibility | PASS |
| D5 | A rule with no source URL is **refused at load** | PASS |
| D6 | With no lockfile, findings are INFERRED, never OBSERVED | PASS |
| D7 | SDK 55 with `newArchEnabled: false` is a VIOLATION | PASS |
| D8 | An operator outside the vocabulary yields UNKNOWN, never SATISFIED | PASS |
| D9 | A publisher-deprecated package is caught | PASS |

Gates run against **real fixture repositories written to disk** — real `package.json` and
`package-lock.json` files, read through the real reader. No mocks.

---

## 5. Two defects the gates caught in my own code

Recorded because `00` §5 says a suite that never fails anything is not evidence of correctness.

**`exact` evaluated as a violation.** The comparator dispatched through a lookup table containing
only `gte`/`gt`/`lte`/`lt`. `exact` fell through to `undefined`, which is falsy, so **every exact
match was reported as a VIOLATION.** D2 caught it on the first run. It failed in the safe
direction — a false alarm rather than a false pass — but it was wrong, and a tool that cries wolf
on correct configurations gets switched off. The dispatch now rejects any declared-but-unimplemented
operator explicitly rather than relying on a falsy lookup.

**A rule stricter than its source.** The first run against a real project reported
`react-native-web 0.21.2` as a VIOLATION against a documented `0.21.0`. The source table lists one
exact version per SDK row, but a patch bump inside the line is not evidence of an incompatibility,
and reporting it at the same weight as a genuine breakage overstates what the source supports. The
rule now asserts only the weaker claim the source *entails* — same minor line — at LOW severity.
Exact-version enforcement is a real check, but it answers a different question ("does this match
what Expo ships?") and is not a compatibility verdict.

---

## 6. Run against a real application

Verified against a real Expo/React Native + FastAPI project (read-only; nothing was written to it).
70 dependencies across two ecosystems — 54 npm, 16 pip.

**Genuine finding:** `expo-random@14.0.1` is present *and* deprecated by its publisher in favour of
`expo-crypto` — which that project already depends on. A real, actionable, sourced result on a real
codebase.

**And the honest part:** 65 of 70 dependencies matched no rule. The tool says so, in the summary,
every run. That number is the current value of this capability stated plainly — and growing rule
coverage, with sources, is the work that raises it.

---

## 7. What this does not do yet

- **Rules cover the Expo/React Native ecosystem only.** The pip dependencies are read and counted
  but no pip rule exists yet. `motor` ↔ `pymongo` is an obvious next rule and needs a source.
- **No transitive analysis.** Direct dependencies only.
- **No request-path binding.** The charter's framing is *"the versions of the eleven things this
  request touches"* — this checks the versions a **repository** declares. Joining drift findings to
  an observed request path is the next real step, and it is what would make this VITALIS's
  capability rather than a good standalone linter.
- **Rule freshness is unmanaged.** Every rule has a `recordedAt`; nothing yet warns when that date
  is old. Vendor tables move.

---

## 8. Where this sits in the plan

`09` §6 said: if no OTLP pipeline exists, propose the compatibility-drift capability **alone**,
because it delivers value with zero instrumentation. That capability now exists and is proven.

It runs against any repository with `npm run drift -- <path>`, needs nothing installed in the
target, and writes nothing to it.
