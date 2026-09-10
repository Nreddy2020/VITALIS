# VITALIS — Architecture, Operating Model & Business Case
### Content backbone for the presentation deck — organized by the questions the deck must answer

---

## 1. What exactly are we solving? (the one slide everything else supports)

**The gap today:** every enterprise tool (APM, F5, firewall/SIEM, WebSphere/DB2/MQ monitoring, Kubernetes, CMDB, ITSM) tells you whether *its own component* is healthy. None of them are built to answer "what happened to this one customer's request, end-to-end, and why?" When a request crosses six or seven technology boundaries and each boundary is owned by a different team with a different tool, root-cause work becomes a 30-minute (or 3-hour) war room of people alt-tabbing between dashboards, comparing timestamps by eye, and guessing at correlation.

**What VITALIS is:** a correlation and evidence layer that sits *across* your existing tools — not instead of them — and reconstructs the true, end-to-end story of one business request (login, checkout, transfer, payment) using the telemetry those tools already produce.

**What VITALIS is not:** it is not a new APM, not a replacement for Dynatrace/AppDynamics/Splunk/Grafana, not a new firewall or WAF, and — critically for the architecture slide — it never sits in the live request path. If VITALIS goes down, the business transaction is unaffected. This is the one architectural invariant that should appear on every slide's footer.

---

## 2. Architecture — the four planes

Present this as one layered diagram (Slide "Architecture"), four horizontal bands top to bottom:

**Plane 1 — The real enterprise request path** (top band, what actually happens in production):
`Browser → DNS → Network → Firewall → F5/Load Balancer → TLS → IHS → WebSphere → IBM MQ → DB2 → External API → return path back through the same hops`
This band never mentions VITALIS. It's the honest picture of what already exists and keeps running with or without VITALIS.

**Plane 2 — The collection fabric** (how evidence gets out, without touching the request path):
- Application tier (WebSphere/IHS): OpenTelemetry auto-instrumentation agent — mature, standard, minimal app-code change.
- Network/host tier: eBPF-based collectors (e.g., open-source options like Grafana Beyla, Pixie, or Cilium Hubble) **only where the host OS is Linux** — call this out explicitly, because IBM WebSphere/DB2 shops frequently run AIX, z/OS, or Windows, where eBPF does not exist and you instead need vendor agents, syslog/audit-log forwarding, or SNMP/WMI-style polling.
- F5: read-only via iControl REST API and/or F5 Telemetry Streaming — pool state, VIP selection, WAF verdicts.
- Firewall/network security: log/flow export (syslog, NetFlow/IPFIX) correlated by 5-tuple + time window — call out honestly that this is *heuristic* correlation, not a deterministic trace-ID match, since firewalls don't see application-layer trace context.
- DB2: DB2 monitoring views/event monitors, with the application passing the trace ID through the connection's `CLIENT_APPLNAME`/`CLIENT_ACCTNG` metadata so a DB2 lock event can be tied back to a specific request.
- IBM MQ: queue manager accounting & statistics messages, correlated via message correlation ID fields in the MQMD header.
- Change/deployment context: Git commit hooks, CI/CD pipeline webhooks, CMDB/ITSM change records — pulled in as timestamped events, not live telemetry.

**Plane 3 — The VITALIS engine** (this is your product, and the part actually built today):
Ingestion Gateway → Identity/Temporal/Async Correlators → Evidence Graph → Causal/RCA Engine → Confidence Scoring → Evidence Truth Ledger (SHA-256 hash-chained, tamper-evident audit trail) → Business Impact Evaluator.

**Plane 4 — Human decision layer** (never fully automated in the initial build):
Recommendation surfaced to on-call/SRE → risk assessment → human approval (tied to real SSO identity, not a free-text name) → sandboxed replay/canary → execute → automated post-action verification against baseline → rollback if unhealthy → outcome recorded permanently in the ledger for future learning.

---

## 3. How it works — the request's journey, step by step

This is the natural "walk the audience through one real incident" slide sequence:

1. A request is created at the browser with a trace ID (e.g., `TX-847392`) established via standard W3C trace-context headers.
2. As it crosses F5 → IHS → WebSphere → MQ → DB2 → external API, each hop's telemetry is captured *out of band* by the collection fabric in Plane 2 — the request itself never waits on VITALIS.
3. VITALIS's Ingestion Gateway receives these independent observations asynchronously and normalizes them into a common evidence format.
4. The Identity Resolver stitches observations back to the same request using trace ID where propagated, and timestamp/identity heuristics where it isn't (DNS, firewall).
5. The Evidence Graph is built: every hop becomes a node, every observed transition an edge, tagged as `OBSERVED`.
6. The engine compares the live path against a learned "golden baseline" for that business journey and flags the first point of deviation — e.g., DB2 query latency at 3,982ms against an 18ms baseline.
7. The Causal Engine produces ranked hypotheses with supporting *and* contradicting evidence, each tagged `CORRELATED` or `INFERRED` — never presented as unqualified fact.
8. Business Impact is computed (which journey, how many affected transactions, estimated revenue/SLA exposure).
9. A remediation recommendation is proposed (`RECOMMENDED`), a human approves it against their real identity (`APPROVED`), the action runs in a sandbox/canary first, and only then against production (`EXECUTED`), with automatic post-action verification (`VERIFIED`) and rollback if it didn't work.
10. The entire chain — evidence, hypothesis, approval, action, outcome — is sealed into the hash-chained ledger, which is what lets VITALIS build organizational memory ("this is the third time this deployment pattern caused this exact lock pattern").

---

## 4. Is this really required, and what does it save? (the CFO/CEO slide)

Be careful here: **don't present invented org-specific numbers as fact.** Present two things instead — (a) credible, sourced industry benchmarks for what the underlying problems cost in general, and (b) a clear, honest framework for how a pilot would measure VITALIS's specific impact on your environment. That combination is far more convincing to a CFO than a made-up ROI number, because a sharp questioner will ask "how did you calculate this" and a sourced framework survives that question.

**What the industry says these problems cost, in general** (use as context, not as your organization's guaranteed number):
- Enterprise downtime: ITIC's 2024 enterprise survey found 91% of mid-size and large organizations report over $300,000/hour in downtime cost, with 41% reporting $1M–$5M+/hour. Uptime Institute's 2026 outage-cost survey found 1 in 5 organizations' most significant recent outage exceeded $1 million, and 57% exceeded $100,000.
- Data breach cost and detection speed: IBM's 2025 Cost of a Data Breach report puts the global average breach cost at $4.44 million (down 9% from $4.88 million the prior year), with average time to identify and contain a breach at 241 days — the lowest in nine years, attributed partly to faster, AI-assisted detection and containment. This is directly relevant to your CVE/vulnerability-blast-radius use case: faster, more precise identification of which business transactions actually traverse an affected component is exactly the lever that report credits for cost reduction.
- Change and recovery velocity: DORA's long-running State of DevOps research consistently shows a wide gap between high- and low-performing organizations on change failure rate and mean time to restore — the general direction (not exact current-year numbers, which I did not verify to my confidence bar) is that organizations with strong change/incident correlation practices measure recovery in minutes to hours, while those without it measure in days. This is the category VITALIS's change-intelligence and evidence-graph work targets.

**Where VITALIS specifically moves the needle** — frame each as a hypothesis to validate in a pilot, not a guaranteed percentage:
- MTTD/MTTR: reconstructing the full request path automatically removes the "which of six dashboards do I check first" step, which is typically the largest single chunk of time in a war room.
- Change-failure blast radius: change intelligence ties a deployment directly to the query/latency pattern it introduced, shortening the "was it the deploy or something else" debate.
- CVE/vulnerability triage: instead of "10,000 servers have this CVE," you can answer "these three business journeys actually traverse the affected library," which is what lets security and app teams prioritize patching by actual exposure instead of by inventory count.
- Migration validation: comparing "request DNA" (structure, latency, dependencies, headers, error rate) before and after a platform migration (e.g., WebSphere/DB2 → OpenShift/PostgreSQL) gives an evidence-based answer to "does the new system behave the same from the customer's perspective," rather than only checking that the new service is up.
- Capacity/performance: breaking a latency regression down hop-by-hop ("DB +210ms, MQ +80ms, WebSphere +55ms") tells capacity planning exactly where to invest instead of broadly scaling everything.
- Fault tolerance: the "production never depends on VITALIS" invariant plus baseline comparison means you can validate failover/DR behavior against the same golden baseline used for normal operations.

**The honest pilot framework to put on the slide:** pick one business journey (e.g., checkout), instrument it fully, run VITALIS alongside existing tools for one quarter, and measure your own before/after MTTR, war-room headcount-hours, and number of "unexplained" incidents. That real, org-specific number is what should go in the final deck — not a number estimated today.

---

## 5. How do we implement it, and with which tools?

Structure implementation as phases (this maps directly onto the roadmap in the security assessment, reframed for a business audience):

**Phase 0 — Foundation (weeks):** stand up an OpenTelemetry Collector as the single ingestion point; instrument one pilot journey's app tier (WebSphere/IHS) with OTel auto-instrumentation; stand up the VITALIS engine (ingestion, correlation, evidence graph, ledger) behind real authentication (OAuth2/OIDC or mTLS) with TLS everywhere and no wildcard CORS.

**Phase 1 — DB2/MQ integration (weeks to a couple months):** enable DB2 monitor views / event monitors and pass trace ID via client-info metadata; enable MQ accounting/statistics messages and correlate via MQMD correlation ID. This is where the "invisible" part of the request — locks, queue waits — becomes visible.

**Phase 2 — Network/edge integration (in parallel):** F5 iControl/Telemetry Streaming for load-balancer decisions; firewall/network flow export for heuristic edge correlation (labeled honestly as correlated, not deterministic).

**Phase 3 — Change/security context:** Git/CI-CD webhooks and CMDB/ITSM change records feeding the Change Intelligence module; CVE feed integration mapped against the dependency graph so "affected business journeys" can be computed automatically.

**Phase 4 — Governed remediation:** only after Phases 0–3 have run safely in observe-only mode for a real period, introduce human-approved (SSO-signed), sandbox-tested, auto-verified remediation for a narrow, low-risk action set — expand gradually, never all at once.

**Underlying platform choices** (name these on the "how we build it" slide): OpenTelemetry Collector for the fabric; a time-series/trace store (e.g., Tempo/Jaeger-style) for raw spans; a graph representation for the evidence graph; a persistent, encrypted store (not in-memory) for the evidence ledger; a secrets manager (Vault/CyberArk) for every credential the collection fabric needs — never embedded in code.

---

## 6. How do we avoid security/permission violations while capturing the request everywhere?

This is its own slide, and it should be presented as a set of hard rules, not aspirations:

- **Read-only, always.** Every adapter into F5, IHS, WebSphere, MQ, and DB2 uses a monitoring-scoped, least-privilege service account that can observe telemetry and cannot modify configuration, execute queries beyond the monitoring views, or control traffic. Write/control access is only ever granted for the Phase 4 remediation action set, and only after explicit approval.
- **Redact before store, not after.** PII/secret redaction (PAN, CVV, passwords, tokens, SSNs) runs in the ingestion pipeline *before* anything is written to the evidence graph or ledger — not as an optional downstream step.
- **Network segmentation.** The collection fabric talks to production systems over a dedicated, firewalled monitoring path; VITALIS itself never gets direct network line-of-sight into the production data plane beyond that specific telemetry channel.
- **Encryption everywhere.** TLS in transit for every hop of the collection fabric; encryption at rest for the evidence store and ledger.
- **Real identity on every approval.** Any human approval step is tied to the approver's actual SSO/identity-provider session and cryptographically signed — never a free-text name typed into a form.
- **Full audit trail.** The hash-chained evidence ledger gives you a tamper-evident record of every observation, hypothesis, approval, and action — itself a compliance asset for audits.
- **Data retention and minimization.** Define and enforce a retention/purge policy for captured request data; don't keep raw payloads longer than the operational need requires.
- **Scope the compliance surface deliberately.** Keep the enterprise observability engine and any consumer-facing financial features architecturally and organizationally separate, so a payments-adjacent compliance review (PCI-relevant) doesn't have to extend across the whole platform.
- **Independent review before go-live.** A secure code review / penetration test on the ingestion and evidence layer before any real production credentials are connected.

---

## 7. Which teams benefit, specifically

- **SRE/Ops:** faster, evidence-backed root cause instead of a multi-tool war room; a 6 AM flight-deck view of whether real business journeys — not just components — are healthy.
- **Application engineering:** code-level lineage connecting a deploy to the anomaly it introduced, without manually cross-referencing Git history against incident timelines.
- **DBA/database team:** lock, wait, and query-fingerprint evidence tied to the exact request that triggered it, instead of investigating in isolation from application context.
- **Network/security team:** CVE and vulnerability exposure scoped to the business journeys that actually traverse the affected component, not the entire server inventory.
- **Change/release management:** a factual, evidence-based answer to "did this change cause the incident," reducing blame-based change-freeze culture.
- **Compliance/audit:** a tamper-evident, cryptographically verifiable record of incidents, evidence, and remediation decisions.
- **Executive/business stakeholders:** incidents translated into business terms (which journey, how many transactions, what revenue/SLA exposure) instead of raw technical alerts.
- **Customer support:** faster, more specific answers to "why did my transaction fail" using the actual request's evidence trail.

---

## 8. What VITALIS captures, and how to visualize each capture point for the deck

For each of these, a strong slide image is a "before/after" or "siloed vs. connected" visual rather than a raw architecture box:

- **Request identity capture** (browser/TLS/headers): visualize as an "ID card" forming for the request — trace ID, TLS version, cipher, method, path — assembling into one identity panel.
- **Edge/network capture** (DNS, firewall, F5): visualize as a funnel — many raw log lines converging into one correlated timeline entry, explicitly labeled "correlated by time+identity" to stay honest about the heuristic nature.
- **Application capture** (IHS/WebSphere): visualize as a cross-section/X-ray of the app server showing thread pool, JDBC pool, and heap state at the moment the request passed through.
- **Messaging capture** (MQ): visualize as a queue with the specific message highlighted, showing queue depth and wait time only for that correlation ID.
- **Database capture** (DB2): visualize as a lock-contention diagram — the holding process, the waiting request, and the query fingerprint, with the "before" (18ms) and "after" (3,982ms) baseline comparison as a simple bar.
- **Change/CVE capture:** visualize as a timeline strip — deploy event, then the anomaly, drawn as connected dots rather than two separate charts.
- **Evidence ledger:** visualize as a chain of sealed blocks (a simple, non-buzzword hash-chain diagram), each block showing observation → hypothesis → approval → outcome.
- **Business impact:** visualize as a translation arrow — technical evidence on the left, one plain-English business sentence and an affected-transaction count on the right.

---

## 9. Suggested slide flow (ready to hand to whoever builds the deck)

1. Title / one-line positioning
2. The problem: "everything's green, the customer sees a failure" (Section 1)
3. What VITALIS is / is not (Section 1)
4. Architecture — four planes (Section 2)
5. How it works — the request's journey (Section 3, can be 2–3 slides)
6. Real example walkthrough (a single incident end-to-end)
7. Is this really needed — industry cost context (Section 4)
8. Where VITALIS specifically helps — the hypothesis list (Section 4)
9. The pilot measurement framework (Section 4)
10. Implementation phases (Section 5)
11. Tools/technology map (Section 5)
12. Security & permissions model (Section 6)
13. Teams and benefits (Section 7)
14. Capture points & visualizations (Section 8, can be several slides, one per capture point)
15. Roadmap timeline
16. Ask / next steps (what approval or budget you're requesting)

---

Sources for the benchmark figures used in Section 4:
- [Cost of IT Downtime: $300K+/hr Median, $5,600/min Benchmarks (2026) | OutageCost.com](https://outagecost.com/cost-of-it-downtime)
- [2025 Cost of a Data Breach Report: Navigating the AI rush without sidelining security | IBM](https://www.ibm.com/think/x-force/2025-cost-of-a-data-breach-navigating-ai)
