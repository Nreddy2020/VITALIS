# 26 — Stage 16 Completion Log: No Fabricated Facts in the Request Model

**Date:** 2026-09-09
**Status:** Fixed and verified by execution. 6/6 new gates pass; all 18 suites pass.
**Run it:** `npm run test:stage16`
**Artifacts:** `artifacts/stage16-no-fabrication-gate-report.json`

In `25` I wrote that I had no unaudited number left in front of me. **That was wrong.** Stage 14
replaced the *comparison* against the hardcoded golden path but left the *model* being compared —
and that model was the largest fabrication site in the codebase, on the path of every request.

---

## 1. What every real request was told about itself

`RequestDNA.create` gave every optional argument a fabricated fallback, and `evaluateTrace` never
passed those arguments. So the fallbacks were not a demo path — they were **the production path**.

Run against a real Python FastAPI trace, verbatim:

```
dependencies  : ["DB2-Cluster-01", "Stripe-Gateway-US"]
environment   : { runtime: "WebSphere-9.0.5", jdk: "IBM Semeru 17", host: "app-node-04" }
changeContext : { lastDeploy: "app-v2.4.1 (14m ago)", configHash: "cfg-8841" }
semantics     : { status: 504, headersValid: true, authScopePresent: true }
isStandard    : false
isWithinBudget: false   (budget hardcoded at 180ms)
```

Not one of those was observed. VITALIS was telling an operator that their Python service **runs on
WebSphere 9.0.5 with an IBM JDK on host app-node-04**, **depends on a DB2 cluster**, **deployed
fourteen minutes ago**, and **returned HTTP 504**.

Two of those are worse than the rest:

- **The 504 was derived from latency alone** — `hops.some(h => h.durationMs > 2000) ? 504 : 200`.
  An HTTP status code that no service ever returned, invented from a stopwatch.
- **`isStandard`** was literally
  `path.includes("Client") && path.includes("WebSphere") && path.includes("DB2")`, so every request
  that was not an IBM demo was flagged non-standard.

This is the worst class of fabrication in the project: **specific, plausible, actionable and
false.** A vague wrong answer gets questioned. "Your service runs WebSphere 9.0.5 and deployed 14
minutes ago" gets acted on.

---

## 2. How it was found

By going back to check a claim I had just made. Having said the RCA path was fully audited, the
honest move was to verify rather than assert — and `RequestDNA` was sitting one function away from
everything Stage 14 had touched.

**Stage 14 fixed the comparison and left the thing being compared.** That is the specific shape of
this miss, and it is worth remembering: fixing the code that *uses* a fabrication does not remove
the fabrication.

---

## 3. What it reports now

Every field is either OBSERVED or absent. There are no defaults.

| Field | Now |
|---|---|
| `dependencies` | The services actually seen on this request, with `dependenciesProvenance` |
| `environment` | `serviceVersions` and `deploymentEnvironment` from the OTel resource; **`runtime` and `host` are absent**, with provenance saying they are not ingested |
| `changeContext` | Absent. Real correlation lives in `changeCorrelation`, which is separately evidenced and returns an honest "nothing correlated" |
| `semantics.status` | Only a code actually ingested (`http.status_code`), with `statusProvenance`; never derived from duration |
| `semantics.headersValid` | Absent — VITALIS does not ingest request headers, and now says so |
| `structure.isStandard` | **Removed** |
| `performance.isWithinBudget` | **Removed** — budget is answered by the learned baseline or not at all |

`evaluateTrace` also stopped passing a literal `{'x-vitalis-auth-scope': 'payments:write'}` into
the model, which had made `headersValid: true` look observed on every request.

The same real trace now reports:

```
dependencies : ["finlife-api"]                       OBSERVED — services seen on this request
environment  : { serviceVersions: { finlife-api: "1.0.1" }, deploymentEnvironment: "dev" }
             : OBSERVED — from OTel resource attributes only; runtime and host are not ingested
changeContext: undefined
semantics    : { status: 200, statusProvenance: "OBSERVED",
                 headersProvenance: "UNKNOWN — VITALIS does not ingest request headers" }
```

---

## 4. The gates

| Gate | What it proves | Result |
|---|---|---|
| F1 | No IBM/demo string appears anywhere in a real request's model | PASS |
| F2 | Dependencies are the services actually observed | PASS |
| F3 | Environment carries only declared resource attributes; runtime/host absent, not invented | PASS |
| F4 | A 9,000ms request with no status attribute reports UNKNOWN, **not 504** | PASS |
| F5 | `changeContext` is absent; real correlation is separate and evidenced | PASS |
| F6 | The 180ms budget and the WebSphere/DB2 flag are gone from the model | PASS |

F1 is a string search for the seven specific demo values across the serialised model. It is crude
on purpose: if any of them ever comes back, a test goes red.

---

## 5. Where this leaves the tally

| # | Fabrication or drift | Found by |
|---|---|---|
| 1 | IBM middleware scope | The owner asking why |
| 2 | Expo folder layout in the engine (`19`) | The owner challenging generality |
| 3 | JavaScript-only OTLP ingest (`21`) | Running a real Python app |
| 4 | Deviation judged against a demo path (`24`) | Chasing an odd empty result |
| 5 | Hardcoded `/18` divisor; score raised by missing evidence (`24`, `25`) | Reading the rendered screen |
| 6 | Invented dependencies, environment, deploy time and HTTP status (this) | Re-checking a claim I had just made |

**None was found by reading code, and the suite was green through every one of them.**

Two things follow, and they are the only real conclusions this project has earned about its own
process:

1. **Run the thing and look at what it shows a person.** Every one of these surfaced that way, or
   because someone pointed something unfamiliar at it.
2. **"I have finished auditing X" is a claim like any other.** It is worth exactly one more check.
   This stage exists because I made that claim in `25` and it was wrong.
