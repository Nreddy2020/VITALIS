# 19 — Stage 11 Completion Log: Technology Generality of the Drift Engine

**Date:** 2026-09-09
**Status:** Refactored and verified by execution. 7/7 new gates pass; all 14 suites pass.
**Run it:** `npm run test:stage11`
**Artifacts:** `artifacts/stage11-generality-gate-report.json`

**This stage exists because the owner caught a drift. He was right, and it was the second time.**

---

## 1. What went wrong

The first drift was DB2/MQ: the engine narrowed toward IBM middleware because that was the example
in front of it. Recorded in `01` §9.

The second is this one. Stages 9 and 10 were built while looking at one Expo/React Native +
FastAPI application, and the engine absorbed that application's shape:

| Where | What was wrong |
|---|---|
| `manifest_reader.js` | Hardcoded `package.json`, `app.json`, `eas.json` — and **`backend/requirements.txt`**, one specific repository's folder layout, written into the engine |
| `manifest_reader.js` | Extracted `expo.newArchEnabled` — a framework-specific config key — in the core reader |
| `compatibility_rules.js` | Shipped a table of Expo SDK versions **as code**, with no way to add rules without editing the engine |
| `version_ops.js` | Parsed only `major.minor.patch` — semver's shape, a JavaScript convention |
| `check.js` | Refused to run unless it found `package.json` or `backend/requirements.txt` |

It analysed that one application perfectly and **would have found nothing in any other
repository.** Worse, the Python path was not merely narrow — `backend/requirements.txt` is a path
that exists in essentially one codebase on earth.

**The honest part:** the *evaluation* engine was already generic. `drift_checker.js`,
`request_drift.js` and `component_bindings.js` contained no technology knowledge and needed no
change. The drift was concentrated entirely in discovery, rules and version syntax.

**The lesson worth keeping:** this drift happened *after* the charter was written, by someone who
had read it, in a codebase whose entry document warns about exactly this failure. Documents do not
prevent it. The gates in §4 do.

---

## 2. The new structure

Adding a new kind of application now requires **at most one small module, and usually none.**

```
engine/drift/
  ecosystems/
    ECOSYSTEM_CONTRACT.md   ← read before adding a language
    index.js                ← registry + manifest discovery
    npm.js  pip.js  maven.js
  rulepacks/
    expo.json               ← compatibility knowledge as DATA
  rulepack_loader.js
  manifest_reader.js        ← knows no language, no framework, no layout
  drift_checker.js  version_ops.js  request_drift.js  component_bindings.js
```

| To support | You write |
|---|---|
| A new package manager (Go, Cargo, NuGet, Gradle, Composer) | One ecosystem module against the contract |
| New compatibility knowledge (Spring Boot ↔ Spring, Django ↔ Python, WebSphere ↔ JDK) | **A JSON rule pack. No code.** |

**Discovery replaced hardcoded paths.** Manifests are matched by *basename, at any depth* — never
by path, because a path is one application's layout. `node_modules`, `.venv`, `target`, `dist` and
friends are excluded, with depth and file-count limits.

**Rules became data.** All 19 Expo rules moved to `rulepacks/expo.json` unchanged. The
admissibility rule is unchanged and still enforced: no resolvable `source.url` and `recordedAt`,
no load — the loader throws rather than skipping, because a version matrix written from memory is
undetectable once written down.

**Framework config became data too.** `expo.newArchEnabled` is now a fact declaration inside the
Expo pack — file plus JSON path — so no framework key appears in the engine:

```json
"facts": [{ "name": "expo.newArchEnabled", "file": "app.json", "path": ["expo", "newArchEnabled"] }]
```

---

## 3. Maven, added to prove the point

`ecosystems/maven.js` shares no code, assumption or vocabulary with the JavaScript readers, and
the engine treats it identically. It also matters directly: a WebSphere/JBoss estate is Java.

It fails closed everywhere it cannot be certain — `${property}` versions, version ranges, and
versions supplied by `dependencyManagement` or a parent pom are all `UNKNOWN`, never guessed.
Property resolution needs parent poms and profiles this reader cannot see, and a wrong version is
worse than no version. Those UNKNOWNs appear in the coverage report, which is the honest outcome.

---

## 4. The gates

| Gate | What it proves | Result |
|---|---|---|
| G1 | A Java/Maven repo with **zero JavaScript** is read correctly | PASS |
| G2 | A Python service at `services/ledger/api/` is found — no assumed layout | PASS |
| G3 | A brand-new rule pack for an unrelated stack works with **no code change** and catches a real violation | PASS |
| G4 | With rule packs removed, the engine still reads everything and reports honest UNKNOWN coverage | PASS |
| G5 | **No application-, framework- or folder-specific string in the engine core** — enforced by reading the source | PASS |
| G6 | Maven fails closed on properties, ranges and managed versions | PASS |
| G7 | A polyglot repo is read across all three ecosystems; `node_modules` and `.venv` excluded | PASS |

**G5 is the regression guard for this entire class of mistake.** It greps the six core engine
files for `backend/`, `eas.json`, `app.json`, `expo-random`, `newArchEnabled` and `react-native`,
and fails if any appears in code. If a future contributor — human or agent — starts writing an
application's shape back into the engine, a test goes red rather than a reviewer having to notice.

---

## 5. A real defect the gates caught

**G3 failed on the first run**, and for exactly the right reason.

The new Spring Boot test pack asserted `com.ibm.db2:jcc >= 11.5.8.0` against an observed
`11.5.4.0`. The result came back `UNKNOWN`: *"observed value 11.5.4.0 is not an exact version"* —
because `parseVersion` accepted only three segments.

Semver's `major.minor.patch` is a JavaScript convention, not a universal one. Java and IBM ship
four-segment versions; .NET ships four-part assembly versions. **A three-segment parser makes every
Java rule permanently UNKNOWN** — the engine looks like it is working while checking nothing. It
failed in the safe direction, but it was still a hole that would have made Maven support
decorative.

`parseVersion` now accepts an arbitrary number of numeric segments and `compare` works
segment-wise with missing segments treated as zero, so `11.5.4` and `11.5.4.0` compare equal.
Semver is a subset.

One test assertion in Stage 9 also needed updating: the missing-lockfile warning moved into
`npm.js` and changed wording. The assertion was relaxed to match the substance, not the wording —
the behaviour it checks is unchanged.

---

## 6. Verified: nothing regressed

All 14 suites pass. The real Expo/FastAPI project re-analysed through the fully generic path
produces **identical results** — 70 dependencies, same single violation, same 65 UNKNOWN — except
that its Python requirements are now found by discovery rather than by a hardcoded path, and would
be found wherever they sat.

---

## 7. What is still true

- **Rule coverage is still Expo/React Native only.** That is now a content gap, not an
  architectural one: pip and Maven dependencies are read and counted, and adding rules for them is
  a JSON file. Ship partial coverage rather than guessed coverage.
- Direct dependencies only; no transitive analysis.
- Bindings (Stage 10) are still declared by hand.
- Nothing renders in the operator console yet.

---

## 8. For whoever picks this up

Two drifts, same shape, both caught by the owner rather than by me. If you are extending this
engine and find yourself adding a filename, a folder, a framework key or a version-format
assumption to `manifest_reader.js`, `drift_checker.js` or `version_ops.js` — **stop.** It belongs
in an ecosystem module or a rule pack. G5 will tell you, but by then you will have written it.
