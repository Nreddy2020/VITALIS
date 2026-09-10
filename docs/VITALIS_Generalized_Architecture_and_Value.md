# VITALIS — Generalized (Stack-Agnostic) Architecture & Value Proposition

Companion to: VITALIS_CHARTER.md (read that first), VITALIS_Security_Implementation_Assessment.md,
VITALIS_Architecture_Business_Case.md, VITALIS_Implementation_Roadmap.md.

## Why the WebSphere/IHS/DB2/MQ examples were never the whole design

Those names are one org's *sample* stack, used to make the architecture concrete. The actual VITALIS
contract underneath — confirmed by reading the real code, not just the pitch docs — is already
technology-agnostic:

- The ingestion endpoint (`server.js`) speaks standard OTLP (`/v1/traces`, `/v1/metrics`, `/v1/logs`).
  Any system already instrumented with OpenTelemetry — which today covers most mainstream languages,
  frameworks, databases, message brokers, and cloud services — can feed VITALIS with **zero new adapter
  code**. This is Tier A: already generic.
- Every "sensory adapter" in the codebase is, on inspection, a pure normalizer: it takes raw telemetry
  and reshapes it into one standard evidence envelope (component name/type, status, duration,
  correlation keys, attributes). Nothing about that contract is DB2- or F5-specific — the same pattern
  is how you add a MySQL, Kafka, Nginx, or homegrown-legacy adapter. This is Tier B.
- So "does this work for any software" splits cleanly: modern, OTel-instrumentable stacks work
  essentially out of the box; older, proprietary, or appliance-level systems need a small adapter each,
  following the exact pattern already proven in the codebase.

**Honest limit:** VITALIS can only surface what a system exposes somehow (OTel, a vendor API, or logs).
For a fully opaque third-party SaaS dependency you don't operate, evidence is limited to whatever its
own status/API tells you — correlation there is coarser than for systems you control.

**See the four-tier model in `VITALIS_Thesis_and_Feasibility.md` §2** for the formal version of this,
including Tier C (telemetry but no identity — firewalls, DNS) and Tier D (no usable telemetry at all),
both of which are reported as explicit gaps rather than hidden.

## Mapping the requested outcomes to actual mechanisms (not just claims)

- **Finding the issue along with the request itself:** every observation is anchored to the specific
  trace/request that experienced it, not to an abstract component metric. You see the issue *inside*
  the transaction it affected.
- **Finding the cause immediately, based on the request:** the golden-baseline diff flags the *first*
  point of deviation automatically, and the evidence engine ranks hypotheses with supporting *and*
  contradicting evidence — collapsing a serial, multi-dashboard investigation into one ranked list.
- **Recovery quality:** the remediation state machine requires sandboxed testing and automated
  post-action verification against baseline before a fix counts as resolved, with rollback if it
  didn't work — recovery becomes verified, not assumed.
- **Performance:** hop-by-hop latency attribution tells capacity work exactly where to invest instead
  of broad, guesswork scaling.
- **Downtime avoidance:** continuous baseline comparison (not point-in-time health checks) catches a
  degradation before it becomes a full outage.
- **Business impact avoidance:** affected-transaction counts translate technical evidence into
  exposure. **Note the charter's constraint:** VITALIS cannot know revenue — only affected requests
  multiplied by a value *the business supplies*.
- **Escalations/SLA penalties:** faster detection plus faster verified resolution shortens the two
  inputs that drive SLA breaches — but only once your specific SLA thresholds are modeled into the
  journey baselines during implementation. It is not automatic out of the box.
- **Migration issues, easier migration work, compatibility issues:** the codebase already has the
  generic primitive — `RequestDNA.compare()` diffs structure, performance, semantics, and dependencies
  between two request captures. Capture Request DNA on the old stack, compare against the new stack
  post-migration, and any regression is flagged automatically. Generalizes to any before/after change:
  a migration, a library upgrade, a config change, a TLS/cipher change.

## Net positioning statement

The engine (correlation, evidence graph, RCA, hash-chained ledger, remediation workflow) is the
constant across every organization. What changes per organization — and per additional technology
inside the same organization — is only the set of adapters feeding it, and each new adapter follows
the same contract already implemented today, whether the target is IBM middleware, a Java/.NET/Node
service mesh, a mainframe, or a cloud-native Kubernetes stack.

**Positioning caveat added 2026-09-09 (see `VITALIS_Competitive_Reality.md`):** this generality is a
*technical* claim, not a go-to-market one. Sold as "request-centric observability", VITALIS competes
head-on with Dynatrace and Datadog and loses. Sold as an **additive layer** consuming the OTLP an
incumbent already collects, it sidesteps data gravity entirely. Same engine, different odds.
