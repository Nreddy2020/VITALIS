# VITALIS — Implementation Roadmap
### The exact staged plan to take this from prototype to a governed pilot

Realistic framing up front: taking VITALIS from where it is today (a working ingestion pipeline and evidence ledger, plus a scripted demo UI) to a governed system running against one real business journey in production is a **6–9 month program** for a small team, not a sprint. Full multi-journey, multi-system enterprise scale-out is longer still. That's not a weakness — it's the honest size of the problem, and it's exactly the shape a CTO will expect to see.

---

## Stage 0 — Foundation & Hardening (2–3 weeks)

**Goal:** make the current codebase safe to build on before anything else touches it.

- Delete `powershell.exe` and the push scripts from the working tree; make the GitHub repo private (or move it into internal source control) until this stage is done.
- Add a secret-scanning pre-commit hook (gitleaks/truffleHog).
- Add real authentication to every `server.js` endpoint (OAuth2/OIDC client-credentials or mTLS) and replace the wildcard CORS with an explicit allow-list.
- Add request body size limits and basic rate limiting on the ingestion endpoints.
- Wire `PrivacySanitizer.sanitizeObject()` into the actual ingestion path (it currently isn't called), and run `adversarialAudit()` as an automated CI/runtime gate rather than a one-off report.
- Replace the in-memory `Map`/array storage with a real persistent, encrypted-at-rest store (start with Postgres — no need for anything exotic yet) so the evidence ledger survives a restart.
- **Exit criteria:** every endpoint requires auth; a redaction test suite passes in CI; killing and restarting the server doesn't lose the evidence chain.
- **Team:** one backend engineer, a few hours of security review time.

## Stage 1 — Pilot Instrumentation, One Real Journey (4–6 weeks, can run in parallel with Stage 2)

**Goal:** get real telemetry from one real business journey (recommend: checkout/payment, since it's already your reference scenario) flowing through the engine in a staging environment — replacing `scenarios.js`'s canned data with the real thing.

- Instrument the pilot journey's WebSphere/IHS tier with the OpenTelemetry Java auto-instrumentation agent, pointed at the VITALIS OTLP endpoint.
- Enable DB2 monitor views/event monitors, and have the application pass the trace ID through the connection's `CLIENT_APPLNAME`/`CLIENT_ACCTNG` fields so a lock event can be tied back to the request that caused it.
- Enable MQ accounting & statistics messages, correlated via the MQMD correlation ID.
- Extend the correlation modules (`identity_resolver.js`, `temporal_correlator.js`, `async_boundary_correlator.js`) to run against this real data rather than only test fixtures.
- **Exit criteria:** a real staging transaction produces a real evidence graph and a real RCA candidate — not a scripted scenario.
- **Team:** platform/backend engineer(s), a DBA and app-team liaison part-time.

## Stage 2 — GUI Rebuild (4–6 weeks, parallel with Stage 1)

**Goal:** replace the cinematic canvas demo with the production dashboard — see the mockup below for the visual target.

- Move off the hand-rolled canvas particle engine (`app.js`) onto a real frontend stack (React or Vue is fine for a team this size) with real client-side routing across the nine modules.
- Wire the UI to the engine over WebSocket/Server-Sent Events so panels update live instead of rendering hardcoded narrative text.
- Keep the persona-switcher concept (Executive / Ops / App Engineer views) — it's a genuinely good idea from the current prototype — but drive it from real role-based data filtering, not a canned description string per persona.
- **Exit criteria:** the GUI renders Stage 1's real pilot data end-to-end, including a live-updating request journey and evidence panel.
- **Team:** one frontend engineer.

## Stage 3 — Network/Edge + Change Intelligence (4–6 weeks)

**Goal:** extend correlation out to the edge and tie deployments to the anomalies they cause.

- F5 integration via iControl REST API / F5 Telemetry Streaming (read-only).
- Firewall/network flow log correlation by 5-tuple + time window — labeled honestly in the UI as `CORRELATED`, not a deterministic trace match.
- Git/CI-CD webhook ingestion feeding `change_intelligence.js`.
- CVE feed integration mapped against the dependency graph, so "which business journeys traverse the affected component" becomes answerable.
- **Exit criteria:** a real deployment in staging shows up in the Changes module and is automatically correlated to any anomaly it introduces in the pilot journey.

## Stage 4 — Governed Remediation (6–8 weeks, only after Stages 0–3 have run stably in observe-only mode for at least 4–8 weeks)

**Goal:** the highest-risk part of the system, built last and gated hardest.

- Replace the current `Math.random()`-based "signature" with a real approval flow: the approver's actual SSO identity, cryptographically signed, RBAC-scoped, and linked to a change ticket.
- Build a sandbox/canary execution harness for a narrow, pre-approved, low-risk action set first (e.g., "restart a specific connection pool") — not "kill a DB2 session" as a first action.
- Wire automated post-action verification against the golden baseline, with automatic rollback on failure.
- Require explicit SRE + security sign-off before this stage's code is allowed to call any real control-plane API.
- **Exit criteria:** one real, low-risk remediation executed end-to-end in a controlled environment with a full, auditable evidence trail.

## Stage 5 — Scale Out (ongoing)

- Add additional business journeys one at a time, following the same Stage-1-style playbook.
- Add additional adapters (Kubernetes/OpenShift, other databases) as needed.
- Replace the current placeholder benchmark numbers with real load-test results (k6/Artillery) before quoting throughput figures externally.
- Commission an independent secure-code review / penetration test before any wide production rollout.

---

## How the GUI will look and work

The current front end is a good *concept* (the nine-module structure, the persona switcher, the biological metaphor) wrapped in a cinematic tech-demo. The production GUI keeps the concept and the module structure, but becomes a real operational dashboard: dense, scannable, and honest about what's observed versus inferred. I've built a working mockup of this — see the linked page — showing four of the nine modules:

- **IT Body** — the fleet-level view: each business journey (Login, Payments, Checkout, Transfer) as a health strip, not a generic server-up/down grid.
- **Request Journey** — the hop-by-hop timeline for one transaction (`TX-847392`), each hop showing latency against its own baseline, with the point of first deviation visually distinct from the hops before it.
- **Evidence & Why** — the confidence envelope, with every claim tagged `OBSERVED` / `CORRELATED` / `INFERRED` in a distinct color so nothing reads as unqualified fact.
- **What Next** — the remediation state machine as a horizontal stepper, showing exactly where a given incident sits between detection and verified resolution.

The other five modules (Incidents, Changes, RTI, Systems, and the multi-persona switch) follow the same visual language once wired to real data in Stages 1–3.

A mockup of this is published separately — see the linked page for the live, interactive version.
