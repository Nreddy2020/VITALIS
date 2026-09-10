# VITALIS Stage 3 Completion Log — Change Intelligence & Vulnerability Exposure

**Date:** 2026-09-08
**Scope:** Correlate real change events and real vulnerability advisories against the real requests
VITALIS holds, per Stage 3 of [[VITALIS_Implementation_Roadmap]].

Follows [[VITALIS_Stage0_Completion_Log]], [[VITALIS_Stage1_Completion_Log]] and
[[VITALIS_Stage2_Completion_Log]]. Same methodology: nothing below is asserted — every claim was
run against real sources, with the real output recorded.

## The finding that justified the stage

`engine/change_intelligence.js` was a demo module wearing an engine's name. It held two hardcoded
change events, returned `hasChangeCorrelation: true` unconditionally, and ended its lookup with
`|| this.changeEvents[0]`. Pointed at any incident, it would confidently name a deployment that had
nothing to do with it — and it could never say "no change is related to this". Nothing in the
codebase referenced it (`grep -rln change_intelligence` returned nothing), so it was replaced
rather than repaired; the file is now a deprecation stub that throws if constructed.

## What was built

### 1. Change intelligence — real commits, honest correlation

- **`engine/adapters/git_change_adapter.js`** reads real commits from a real repository with real
  `git log` (sha, author, ISO author date, subject, files changed) and POSTs them to a new
  `/v1/changes` endpoint. A CI/CD webhook or change-management feed maps to the same shape.
- **`engine/change_correlator.js`** correlates those against the *real observed time* of a request.
  Two rules are enforced in code: no nearest-change fallback ever, and every match is labelled
  `CORRELATED` with an explicit "not proof of causation" caveat rather than presented as root cause.
- **`server.js`** now records `observedAt` per span (preferring the span's own real
  `startTimeUnixNano` over ingest time). Without a real observation time there is nothing to
  correlate against and the whole feature would be guesswork.

### 2. Vulnerability exposure — the question a scanner cannot answer

A scanner says "package X has advisory Z". It cannot say whether a single real customer request has
gone through the service running X — which is what decides whether you page someone tonight.

- **`engine/adapters/npm_audit_adapter.js`** runs a real `npm audit --json` against the real npm
  registry and reads the project's real installed component list, POSTing both to
  `/v1/vulnerabilities` and `/v1/components`.
- **`engine/vulnerability_correlator.js`** joins advisory → service inventory → real observed spans
  → real requests, exposed at `GET /api/impact/:advisoryId` and `GET /api/impact`.
- **Safety rule enforced in code:** a service seen in telemetry whose inventory VITALIS was never
  given is reported as `UNKNOWN` coverage, **never** as "not affected". Absence of an SBOM is not
  evidence of safety, and conflating the two is how real exposure gets missed.

### 3. Console integration

A **Changes & Exposure** tab renders both, verified in a real browser
(`artifacts/stage3-gui-changes.png`): real GHSA ids with real severities, ranges, advisory links and
real per-advisory request counts, alongside the real correlated commit with its non-causation caveat.

## Verification — `tests/verify_stage3_correlation_gates.js`, actually run

The test creates a **real git repository and makes real commits**, and installs a **real vulnerable
dependency** and audits it against the **real npm registry**. No advisory or commit in the test is
hardcoded.

```
--- [GATE C1] Real git commits -> real change correlation ---
> Real commits read from the real repo: 2
> Real HEAD sha from git: 00029b3506e9
> VITALIS /v1/changes response: {"status":"SUCCESS","accepted":2,"rejected":[]}
> Correlated to the real HEAD commit: true
> Labelled CORRELATED with an explicit non-causation caveat: true
> statement: "CODE_COMMIT 00029b3 on CheckoutService landed 0 minute(s) before this request,
   on a service this request actually traversed — CORRELATED (temporal proximity and service
   overlap only; not proof of causation)"
RESULT GATE C1: [PASS]

--- [GATE C2] A request predating every change correlates to NOTHING ---
> hasChangeCorrelation: false (changes known to the engine: 2)
> reason: "No change landed within 120 minutes before this request"
> No nearest-change fallback was invented: true
RESULT GATE C2: [PASS]

--- [GATE V1] Real npm audit against the real registry ---
> Real advisories returned by the registry: 6
    - GHSA-35jh-r3h4-6jhm [high] lodash <4.17.21 :: Command Injection in lodash
    - GHSA-p6mc-m468-83gw [high] lodash >=3.7.0 <4.17.19 :: Prototype Pollution in lodash
    - GHSA-r5fr-rjxr-66jc [high] lodash >=4.0.0 <=4.17.23 :: Code Injection via `_.template`
    - GHSA-29mw-wpgm-hmr9 [moderate] lodash >=4.0.0 <4.17.21 :: ReDoS in lodash
    - GHSA-f23m-r3pf-42rh [moderate] lodash <=4.17.23 :: Prototype Pollution in `_.unset`/`_.omit`
    - GHSA-xxjr-mmjv-4gpg [moderate] lodash >=4.0.0 <=4.17.22 :: Prototype Pollution
RESULT GATE V1: [PASS]

--- [GATE V2] Which REAL requests traverse the affected component ---
> Real ingested requests traversing the affected service: 2
   ["TX-STAGE3-AFTER-CHANGE","TX-STAGE3-BEFORE-CHANGE"]
RESULT GATE V2: [PASS]

--- [GATE V3] A service with no SBOM is UNKNOWN, never "safe" ---
> Services in telemetry with no registered inventory: ["LegacyMainframeGateway"]
> statement: "... Additionally 1 service(s) in telemetry have no registered inventory and
   remain UNKNOWN: LegacyMainframeGateway."
RESULT GATE V3: [PASS]

OVERALL: ALL STAGE 3 CORRELATION GATES PASSED
```

Gate C2 is the one that matters most: it is the exact behaviour the old module was incapable of.

**A real bug the test caught:** the first run of C1 read *three* commits from a two-commit
repository. `git log --name-only` prints the changed-file list *after* the formatted header, so a
trailing record separator pushed each commit's filenames into the next commit's record and a header
line was parsed as a filename. Fixed by making the record separator lead rather than trail; the
rerun read exactly 2 commits, 2 accepted, 0 rejected.

## Regression check

Re-run after all changes: Alpha Gates 1–4 PASS, Stage 0 security PASS, Stage 1 evidence PASS,
Stage 1 OTel SDK proof PASS, Stage 1 Postgres adapter PASS, Stage 2 GUI PASS, Stage 3 PASS. Alpha
Gate 5's `socket hang up` remains unchanged — proven pre-existing during Stage 0, still out of scope.

## What Stage 3 does NOT claim

- **F5 / firewall integration was not built.** The roadmap's `iControl REST` and flow-log 5-tuple
  correlation need real appliances, which this environment has none of. Nothing was simulated to
  fill the gap.
- **The advisory source proven is `npm audit`.** OSV.dev was the first choice but is blocked by
  this environment's egress proxy, so it was not used rather than claimed. Any scanner (Trivy,
  Grype, Snyk, OWASP Dependency-Check, OSV, a vendor SBOM) maps to the same advisory shape.
- **Component inventories must be supplied.** VITALIS does not discover what a service runs; it
  correlates what it is told. That is why unknown coverage is surfaced explicitly.
- **Still no real WebSphere/DB2/MQ data**, unchanged from Stage 1.

## Files delivered to E:\VITALIS

`server.js` (`observedAt`, `/v1/changes`, `/v1/components`, `/v1/vulnerabilities`, `/api/impact`),
`index.html` (Changes & Exposure tab), `package.json` (`test:stage3`), `README.md` (Stage 3
section), `engine/change_correlator.js`, `engine/vulnerability_correlator.js`,
`engine/change_intelligence.js` (deprecation stub), `engine/adapters/git_change_adapter.js`,
`engine/adapters/npm_audit_adapter.js`, `tests/verify_stage3_correlation_gates.js`, and
`artifacts/stage3-gui-changes.png`.

## Suggested next step

Stage 4 (governed remediation) is deliberately gated: the roadmap requires Stages 0–3 running
stably in observe-only mode for 4–8 weeks first, and it is the only stage that would let VITALIS
call a real control-plane API. The useful work before then is running this against real
infrastructure — real OTel agents on the pilot journey, a real CI/CD webhook into `/v1/changes`,
and the real scanner already in use feeding `/v1/vulnerabilities`.
