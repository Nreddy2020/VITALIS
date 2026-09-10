# 18 — Stage 10 Completion Log: Drift on the Request Path

**Date:** 2026-09-09
**Status:** Built and verified by execution. 7/7 gates pass, including a live end-to-end.
**Run it:** `npm run test:stage10` · `npm run drift:request -- --trace <t.json> --bindings <b.json>`
**Artifacts:** `artifacts/stage10-request-drift-gate-report.json`

`17` closed the gap `03` §4 identified, but only halfway. It answered *"are this repository's
declared versions mutually compatible?"* — a good question that several tools already ask. The
charter's question is different, and it is the one nobody answers:

> **"Are the versions of the components THIS REQUEST actually touched mutually compatible — and
> which of them can we not see at all?"**

This stage is that join. It is what makes drift a VITALIS capability rather than a good standalone
linter, and `00` §3 previously listed it as the outstanding gap in `17`.

---

## 1. Three kinds of version, never merged

The central discipline of this stage. Each answers a different question, and collapsing them is how
a drift report ends up describing a build that never served anything:

| Kind | Where it comes from | What it means |
|---|---|---|
| **DEPLOYED** | `service.version` on the OTel resource | What actually ran and served this request |
| **DECLARED** | `version` in the component's manifest | What source control says should ship |
| **RESOLVED** | the lockfile | What it was built with |

**DEPLOYED disagreeing with DECLARED is itself a finding.** It means the dependency analysis was
performed against source that is not the build that served the request, and every other finding for
that hop inherits that doubt. Reporting those findings without surfacing the mismatch would be
presenting an analysis of the wrong build as if it described production — which is precisely the
kind of confident-but-wrong output the charter exists to prevent.

---

## 2. A required change to ingestion

`service.version` and `deployment.environment` were read off the wire and **thrown away** — only
`service.name` survived into the span. Compatibility drift could therefore only ever be checked
against source control, never against what was actually running.

`server.js` now retains both. Two properties of the change matter:

- **Absent stays absent.** A component that declares no version produces a span with no
  `serviceVersion` key — not `null`, not `'unknown'`. Downstream code cannot mistake a default for
  an observation, and gate R6 asserts this on a real hop.
- Both values pass through `PrivacySanitizer`, like every other ingested string.

This is the only change to `server.js` in this stage. All eight pre-existing self-contained suites
still pass.

---

## 3. Bindings are declared, never inferred

A span says `service.name = "payments-api"`. **Nothing in that string identifies a repository.**

The tempting shortcut — fuzzy-matching service names against folder names — would be the single
most damaging thing this feature could do. It would attribute one component's compatibility
findings to a different component and present the result as evidence, and it would be almost
impossible to notice afterwards, because the output would look exactly like a correct one.

So the binding is declared by a person in a file (`engine/drift/bindings.example.json`), and
`loadBindings()` refuses anything ambiguous:

- **Two bindings for one service → refused.** Not last-one-wins: a registry that silently picks one
  of two conflicting bindings produces findings that cannot be reproduced or explained.
- **A binding with no `declaredBy` → refused.** Same principle as rule sources in `17`: a claim
  nobody owns is a claim nobody can check.

Anything not declared is `UNKNOWN` on every request that touches it, and is counted as such.

---

## 4. The gates

| Gate | What it proves | Result |
|---|---|---|
| R1 | A violation in a bound component appears on the request path | PASS |
| R2 | Unbound hops are UNKNOWN, counted, and the summary says the request has **not** been shown free of drift | PASS |
| R3 | A component whose deployed version disagrees with its source is flagged | PASS |
| R4 | Scoping is real — a broken repo *not* on this path does not appear | PASS |
| R5 | Ambiguous / unattributable bindings refused at load | PASS |
| R6 | **LIVE** — real OTLP spans carrying `service.version` posted to the real server, read back through the real API, and joined | PASS |
| R7 | One service reporting two versions in one request is recorded as a conflict, not collapsed | PASS |

R4 exists because scoping is the whole claim of this stage. A report that quietly included every
bound repository would look identical to a correct one on a happy path, and would be worthless.

R7 covers a real condition: a rolling deploy mid-request. Averaging or last-writer-wins would erase
exactly the anomaly worth seeing.

**R6 output, verbatim:**

```
> ingest status            : 200
> ledger-api serviceVersion: 1.2.7 (from the wire, not defaulted)
> ledger-api environment   : production
> mongo serviceVersion     : undefined (must be undefined — absent stays absent)
> deployed vs source       : DISAGREES
> mongo binding            : UNKNOWN
```

---

## 5. What a request-level verdict reads like

From gate R2, unedited:

> *Request TX-R2 touched 3 component(s); 1 bound to a version source, 2 UNKNOWN. No violation was
> found among the components that could be checked. 2 component(s) on this path have no version
> source at all — **this request has NOT been shown to be free of drift**.*

The coverage clause is emitted first and unconditionally, and there is no code path that produces a
sentence claiming a request is compatible. That is deliberate: this is the sentence most likely to
be pasted into a status update with its qualifications trimmed off, so the qualification is placed
where trimming it changes the meaning visibly.

---

## 6. What this still does not do

- **Rule coverage is Expo/React Native only.** pip dependencies are read and counted but no pip
  rule exists yet. `motor` ↔ `pymongo` is the obvious first one and needs a source.
- **No transitive analysis.** Direct dependencies only.
- **Bindings are manual.** For a large estate that is real work. A deployment system that already
  knows image→repo could generate the file, but nothing here does that yet.
- **No console surface.** This is CLI and library only; nothing renders in the operator console.
- **Rule freshness is unmanaged.** Every rule carries `recordedAt`; nothing warns when it is stale.

---

## 7. Where this leaves the project

`03` §6's recommended build order was: **compatibility drift → evidence layer → change
intelligence → migration comparison → request RCA.** The first item is now built, proven, and
scoped to the request path, which was the part that made it VITALIS's rather than anyone's.

Thirteen verification suites now pass. For internal adoption (`09` §6), the no-OTLP branch is fully
served by `17` alone, and this stage is what the OTLP branch upgrades to once a pilot service emits
traces.
