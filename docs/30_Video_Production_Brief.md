# VITALIS Film — Production Brief & Clip-Generation Instructions
### For feeding a video-generation agent, one 10-second clip at a time

---

## 0. Answering your core questions directly

**What is VITALIS, in one sentence?**
It follows one real business request across every system it touches, correlates evidence from your *existing* monitoring tools instead of replacing them, explains what actually happened and why, and shows what to do next — without ever sitting in the request's live path.

**Why is it needed when Dynatrace/AppD/Splunk/Grafana/F5/DB2 monitoring/etc. already exist?**
Every one of those tools answers "is *my* component healthy?" in isolation. None of them answer "what happened to *this specific customer's* checkout, end to end, and why?" That correlation-across-tool-boundaries is the gap. F5 can be green, IHS green, WebSphere green, DB2 green — and the customer still sees "Payment Failed," because the actual problem is a cross-boundary interaction (a lock held in DB2 that only manifests as latency two hops upstream) that no single tool's dashboard was built to surface.

**How is it different in daily use from a normal health check?**
A normal check confirms components are *up*. VITALIS's daily check confirms a real *business transaction can complete end-to-end within its normal envelope*, and it does so continuously against a learned baseline — so a 23% degradation on one hop shows up at 6 AM as a warning, hours before it becomes a customer-facing outage. Over time it also remembers failure patterns ("this is the third time this deployment pattern caused this lock contention"), which a stateless health check never accumulates.

**What can it show that a human can't see directly?**
No engineer watches TLS handshakes, thread-pool saturation, MQ queue depth, and DB2 lock waits simultaneously and mentally correlates them to one customer's request ID in real time. VITALIS's job is exactly that correlation — turning twenty dashboards into one evidence graph anchored to a trace ID.

**Important honesty check before you script the video:** in the current codebase, the pieces that are real and working are the ingestion pipeline and the SHA-256 hash-chained evidence ledger. The "sensory adapters" for F5/IHS/WebSphere/MQ/DB2 are today data-shape normalizers that expect telemetry to already be handed to them — the live OTel/eBPF/vendor-API collection layer shown in the video (Movement 9, "How VITALIS Knows") is the target architecture, not yet built. That's completely fine for a vision/pitch film — just don't caption it as "currently deployed in production" anywhere on screen; frame it as the platform's design, so a technical CTO watching doesn't catch a claim the code can't back up yet.

**How many 10-second clips, and how are they grouped?**
Your 72-clip / ~12-minute structure is the right size — long enough to earn the "why," short enough that a CEO won't tune out. Keep the 15-movement grouping you already have; I'd only tighten Movement 6 (WebSphere) and Movement 7 (MQ/DB/API) slightly since those are your two densest technical movements and risk feeling like a spec sheet instead of a story if every field from your list gets crammed on screen at once. Spread the field list across 2–3 clips per movement rather than one dense clip.

**The one clear message for the CEO/CTO close:**
> "Your existing tools already tell you a component is unhealthy. VITALIS tells you what happened to the customer, why, and what to do — by connecting evidence your tools already produce, without adding a new dependency to your production path."

---

## 1. The reusable per-clip template

Generate **one clip at a time**, never batch several scenes into one prompt — that's the single biggest lever against visual/technical drift across a 72-clip film. Every clip prompt has five fixed parts, always in this order:

1. **MASTER DIRECTIVE** (identical, verbatim, every single clip — see §2)
2. **ANCHOR IMAGE** reference (the one locked image from your Visual Bible for this scene)
3. **SCENE SCRIPT** (unique per clip — see §3 for the template, §4 for a worked example)
4. **STRICT ACCURACY RULE** (identical, verbatim, every single clip — see §2)
5. **CONTINUITY LOCK** — repeat the fixed facts that must never drift: hero transaction `TX-847392`, business journey `PAYMENT / CHECKOUT`, URL `https://payments.company.com/checkout`, color language (cyan = VITALIS observation layer), and the last on-screen state from the previous clip (so clip N+1 starts exactly where clip N ended).

---

## 2. The two fixed blocks — paste these unchanged into every clip prompt

### MASTER DIRECTIVE (paste first, every clip)

```
You are creating one 10-second clip in a 72-clip technical product film for
VITALIS — The Request Truth Engine, an enterprise Request Intelligence platform.

This is NOT a generic futuristic technology video. Every pixel must represent
VITALIS or the real enterprise request journey it is demonstrating.

VITALIS does not replace existing monitoring (APM, logs, metrics, F5, firewall/SIEM,
WebSphere/DB2/MQ monitoring, Kubernetes, CMDB, ITSM). It sits ABOVE and ACROSS them,
correlating their evidence around one real business request.

The architecture shown must always be, in this exact order, and never renamed:
Browser -> DNS -> Network -> Firewall -> F5/Load Balancer -> TLS -> IHS/Web Server
-> WebSphere/Application Server -> IBM MQ -> DB2 -> External API -> return journey
back through the same hops to Browser.

VITALIS is an out-of-band observer. It is NEVER inserted into the synchronous
request path. The business transaction must visually continue independently of
VITALIS.

Hero transaction ID (must appear, unchanged, in every clip): TX-847392
Business journey (must appear, unchanged): PAYMENT / CHECKOUT
URL: https://payments.company.com/checkout
VITALIS visual identity: cyan observation/evidence layer overlaid on realistic,
recognizable enterprise infrastructure (not stylized sci-fi).

Every technical state must be visually tagged as exactly one of:
OBSERVED, CORRELATED, INFERRED, RECOMMENDED, APPROVED, EXECUTED, VERIFIED.
Never blur these into one undifferentiated "AI knows everything" impression.

Central message this entire film is building toward:
"Existing tools monitor components. VITALIS understands the complete business
request." Do not undercut this message with unrelated visual spectacle.
```

### STRICT ACCURACY RULE (paste last, every clip)

```
STRICT ACCURACY RULE:
The supplied anchor image is the source of truth for this scene's visual style.
Do not invent new infrastructure, components, or terminology not listed in the
scene script below. Do not change the request ID, business journey name, or URL.
Do not change a telemetry value unless this scene's script explicitly states a
transition (e.g., latency going from 18ms to 3,982ms). Do not add humanoid robots,
floating brains, fantasy data centers, decorative charts, or generic "AI" imagery.
Every on-screen element must serve one of these purposes: show what is happening,
show what VITALIS observed, show how VITALIS obtained that evidence, show whether
this stage succeeded/failed/is unknown, or show why. If a value is not specified
in the scene script, render it as "UNKNOWN" rather than inventing a plausible one.
The business request must be shown continuing independently of VITALIS at all times.
Goal: technical credibility for a CTO audience, not visual spectacle.
```

---

## 3. Per-clip SCENE SCRIPT template (fill in for each of the 72 clips)

```
SCENE: [name, e.g. "REQUEST BIRTH"]
CLIP NUMBER: [n] of 72   |   MOVEMENT: [movement name]   |   DURATION: 10s
ANCHOR IMAGE: [filename from your Visual Bible, e.g. 01_request_born.png]

START STATE: [exactly where the previous clip left off, or the opening state
  if this is clip 1]

ON-SCREEN TELEMETRY (only fields relevant to this hop — do not import fields
  from other movements):
  [field: value]
  [field: value]
  ...

STATE TAG: [OBSERVED | CORRELATED | INFERRED | RECOMMENDED | APPROVED |
  EXECUTED | VERIFIED] — applied to each conclusion shown, not just once globally

STAGE RESULT: [SUCCESS | WARNING | FAILED | UNKNOWN]

CAMERA / MOTION: [one clear camera action — e.g. "slow push-in from browser
  window into the request identity panel"]

NARRATION LINE (on-screen text or voiceover, one sentence max):
  "[the single message this clip must land]"

END STATE / HANDOFF TO NEXT CLIP: [exact visual/telemetry state the next
  clip's START STATE must match]
```

---

## 4. Worked example — Clip 1 (ready to send to your video agent as-is)

```
[MASTER DIRECTIVE — paste from §2]

ANCHOR IMAGE: 00_why_vitalis.png

SCENE: WHY VITALIS EXISTS — THE BLIND SPOT
CLIP NUMBER: 1 of 72   |   MOVEMENT: 0 — Why VITALIS Exists   |   DURATION: 10s

START STATE: A clean enterprise dashboard wall — separate panels for F5, IHS,
WebSphere, MQ, DB2, Network — each showing a green checkmark and "HEALTHY."
No VITALIS elements visible yet.

ON-SCREEN TELEMETRY:
  F5: HEALTHY
  IHS: HEALTHY
  WebSphere: HEALTHY
  MQ: HEALTHY
  DB2: HEALTHY
  Network: HEALTHY

STATE TAG: OBSERVED (each panel is an independent, siloed observation —
  explicitly show them as disconnected from one another, no lines between panels)

STAGE RESULT: UNKNOWN (the overall customer experience is not represented by
  any single panel — this is the point of the clip)

CAMERA / MOTION: Static wide shot of the six dashboard panels, then a single
  red toast notification slides in from the edge: "PAYMENT FAILED — TX-847392"

NARRATION LINE:
  "Every system says healthy. The customer sees PAYMENT FAILED."

END STATE / HANDOFF TO NEXT CLIP: All six panels still green, red "PAYMENT
  FAILED" notification centered on screen, TX-847392 visible — next clip
  (Clip 2) opens on this exact frame and introduces VITALIS's cyan layer
  connecting the six panels.

[STRICT ACCURACY RULE — paste from §2]
```

---

## 5. Recommended order for the rest of Movement 0 (Clips 2–6)

- **Clip 2**: The cyan VITALIS layer appears, drawing correlation lines between the six previously-siloed panels, converging on `TX-847392`. Narration: "VITALIS doesn't watch components. It watches the request that passes through all of them."
- **Clip 3**: Split-screen — left labeled "30 MINUTES, SIX TOOLS, ONE ENGINEER" (a person alt-tabbing between dashboards); right labeled "ONE REQUEST, ONE EVIDENCE GRAPH." State tag: CORRELATED.
- **Clip 4**: Text-forward clip: the "existing tools you already have" list (APM, logs, metrics, F5, SIEM, WebSphere/DB2/MQ monitoring, K8s, CMDB, ITSM) flowing into a single VITALIS node — reinforcing "we don't replace these."
- **Clip 5**: The non-negotiable invariant, on screen, alone: "VITALIS observes the business. The business never depends on VITALIS." Show the request continuing to flow even as the VITALIS overlay flickers off and back on.
- **Clip 6**: Close of Movement 0 — `TX-847392` label forms, ready to hand off into Movement 1 ("A Request Is Born"). Narration: "This is the story of one request. Every enterprise request has one."

---

## 6. How to keep going

Send me the anchor image filename and the STATE for the clip you want next (or just say "next clip"), and I'll write that clip's full SCENE SCRIPT in the same template, using the exact END STATE from the previous clip as its START STATE — that hand-off discipline is what keeps 72 independently-generated clips feeling like one continuous film instead of 72 unrelated ones.
