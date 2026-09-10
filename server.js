/**
 * VITALIS ALPHA/BETA — Backend Server, OTLP Ingestion & Static Web Server
 * Serves:
 * 1. Web UI & Assets: http://localhost:4318/
 * 2. Standard OTLP HTTP Ingestion: /v1/traces, /v1/metrics, /v1/logs
 * 3. REST API: /api/traces/:traceId, /health
 *
 * STAGE 0 SECURITY HARDENING (see docs/VITALIS_Security_Implementation_Assessment.md):
 * - Every ingestion/API endpoint requires an API key (x-vitalis-api-key header).
 *   This is a deliberately minimal Stage 0 control — Stage 1 replaces it with
 *   real OAuth2/OIDC or mTLS between VITALIS and its real telemetry sources.
 * - CORS is an explicit allow-list (VITALIS_ALLOWED_ORIGINS), never a wildcard.
 * - Ingestion request bodies are capped (VITALIS_MAX_BODY_BYTES) to remove the
 *   unbounded-memory DoS vector.
 * - A simple per-IP rate limit protects the ingestion endpoints.
 * - PrivacySanitizer now actually runs on every ingested span/metric/log,
 *   before anything is stored — previously it existed but was never called.
 * - Ingested traces persist to disk (VITALIS_DATA_DIR) and reload on startup,
 *   so a restart no longer silently discards ingested evidence.
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrivacySanitizer } = require('./engine/privacy_sanitizer');
const { ChangeCorrelator } = require('./engine/change_correlator');
const { VulnerabilityCorrelator } = require('./engine/vulnerability_correlator');
const { decodeExportTraceServiceRequest, isProtobufContentType } = require('./engine/ingestion/otlp_protobuf');
const { BaselineLearner } = require('./engine/baseline_learner');
const { configuredReport } = require('./engine/drift/relationships');
const { buildInvestigation, nano } = require('./engine/investigation/request_investigation');
const traceJournal = require('./engine/storage/trace_journal');
const { StoragePolicy } = require('./engine/storage/storage_policy');
const { selectNewObservations } = require('./engine/storage/observation_identity');
const { CaseRepository } = require('./engine/storage/case_repository');
const caseContract = require('./engine/cases/case_contract');

// ---------------------------------------------------------------------------
// 0. STAGE 0 SECURITY CONFIGURATION
// ---------------------------------------------------------------------------

// API key: read live from process.env on every check (not cached at require time)
// so a key set after require() — e.g. by a test harness — still takes effect.
// If no key is configured at all, fall back to a key generated once at boot and
// printed to the console, so there is never a build with "no auth required".
const AUTO_GENERATED_KEY = crypto.randomBytes(24).toString('hex');
function getConfiguredApiKey() {
  return process.env.VITALIS_API_KEY || AUTO_GENERATED_KEY;
}
if (!process.env.VITALIS_API_KEY) {
  console.warn('[VITALIS SECURITY] VITALIS_API_KEY is not set. Generated a temporary key for this run:');
  console.warn(`[VITALIS SECURITY]   ${AUTO_GENERATED_KEY}`);
  console.warn('[VITALIS SECURITY] Set VITALIS_API_KEY in your environment for a stable key across restarts.');
}

function isAuthorized(req) {
  const provided = req.headers['x-vitalis-api-key'] || '';
  const expected = getConfiguredApiKey();
  const providedBuf = Buffer.from(String(provided));
  const expectedBuf = Buffer.from(String(expected));
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

const ALLOWED_ORIGINS = (process.env.VITALIS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MAX_BODY_BYTES = parseInt(process.env.VITALIS_MAX_BODY_BYTES, 10) || 2 * 1024 * 1024; // 2MB default

// Very small fixed-window per-IP rate limiter for the ingestion endpoints.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.VITALIS_RATE_LIMIT_PER_MIN, 10) || 300;
const rateLimitState = new Map(); // ip -> { count, windowStart }
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitState.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Sensitive OTel attribute *names* that must always be masked outright,
// regardless of their value's content (PrivacySanitizer.sanitizeText below
// only catches sensitive *patterns* inside a string value; this catches
// sensitive *fields* by name, which OTel's {key, value} attribute shape
// otherwise hides from a generic object walker).
const SENSITIVE_ATTRIBUTE_KEYS = ['password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'authorization', 'cvv', 'ssn', 'pan', 'card_number'];

function sanitizeOtelAttributes(attributes) {
  if (!Array.isArray(attributes)) return attributes;
  return attributes.map(attr => {
    const keyName = (attr && attr.key ? String(attr.key) : '').toLowerCase();
    if (SENSITIVE_ATTRIBUTE_KEYS.some(k => keyName.includes(k))) {
      return { ...attr, value: { stringValue: '[REDACTED_FIELD]' } };
    }
    if (attr && attr.value && typeof attr.value.stringValue === 'string') {
      return { ...attr, value: { ...attr.value, stringValue: PrivacySanitizer.sanitizeText(attr.value.stringValue) } };
    }
    return attr;
  });
}

// ---------------------------------------------------------------------------
// 0b. PERSISTENCE (Stage 0: file-backed; Stage 1+ moves this to a real DB)
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.VITALIS_DATA_DIR || path.join(__dirname, 'data');
const storagePolicy = new StoragePolicy(DATA_DIR);
const caseRepository = new CaseRepository(storagePolicy);
const TRACES_FILE = path.join(DATA_DIR, 'traces.json');

// Append-only ingest journal.
//
// traces.json is written on a 500ms debounce so a burst of spans becomes one
// write. That batching is good for throughput and bad for durability: a hard
// crash inside the debounce window silently loses everything ingested in it.
// For a product whose entire value is "the evidence is real and complete",
// quietly dropping evidence on a crash is the wrong trade.
//
// So every ingest batch is also appended and fsynced as one journal frame
// per HTTP request. On startup the snapshot is loaded
// and the journal replayed on top of it; on a clean flush the snapshot is
// rewritten and the journal truncated. Set VITALIS_DURABLE_INGEST=false to
// trade this durability back for throughput.
const JOURNAL_FILE = path.join(DATA_DIR, 'ingest-journal.ndjson');
const DURABLE_INGEST = process.env.VITALIS_DURABLE_INGEST !== 'false';

function appendToJournal(entries) {
  if (!DURABLE_INGEST || !entries.length) return;
  traceJournal.appendBatch(JOURNAL_FILE, entries);
}

function truncateJournal() {
  try {
    traceJournal.truncate(JOURNAL_FILE);
  } catch (err) {
    console.warn('[VITALIS PERSISTENCE] Could not truncate ingest journal:', err.message);
  }
}

function loadPersistedTraces() {
  return storagePolicy.load().traces;
}

function persistTracesSync(tracesMap) {
  try {
    storagePolicy.snapshotAllowed(tracesMap);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(tracesMap);
    traceJournal.writeSnapshot(TRACES_FILE, obj);
    // The snapshot now contains everything the journal held, so the journal can
    // start clean. Order matters: snapshot first, then truncate — the reverse
    // would leave a window where a crash loses both.
    truncateJournal();
  } catch (err) {
    console.warn('[VITALIS PERSISTENCE] Could not persist traces:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Stage 3/4 state persistence.
// Traces have survived a restart since Stage 0, but change events, component
// inventories, advisories and approver enrolments did not — so a restart
// silently emptied the correlators and every request looked change-free and
// vulnerability-free. Absence of evidence would have been indistinguishable
// from evidence of absence, which is precisely the failure mode this project
// exists to avoid.
// ---------------------------------------------------------------------------
const CORRELATION_FILE = path.join(DATA_DIR, 'correlation-state.json');

function loadCorrelationState() {
  return storagePolicy.scan().correlation;
}

function persistCorrelationStateSync(state) {
  storagePolicy.admitAux(state, 0);
  try { traceJournal.writeSnapshot(CORRELATION_FILE, state); }
  catch (error) { error.code = 'EVIDENCE_WRITE_FAILED'; throw error; }
}

// ---------------------------------------------------------------------------
// 1. FORMALIZED EVIDENCE GRAPH ONTOLOGY
// ---------------------------------------------------------------------------
class EvidenceGraph {
  constructor() {
    this.entities = new Map();
    this.relationships = [];
  }

  addEntity(id, type, attributes = {}) {
    const entity = { id, type, attributes, createdAt: new Date().toISOString() };
    this.entities.set(id, entity);
    return entity;
  }

  addRelationship(fromId, type, toId, metadata = {}) {
    const rel = { from: fromId, type, to: toId, metadata, timestamp: new Date().toISOString() };
    this.relationships.push(rel);
    return rel;
  }

  queryLineage(requestId) {
    return this.relationships.filter(r => r.from === requestId || r.to === requestId);
  }
}

// 1b. GENERIC OTEL ATTRIBUTE READER — the one place that understands the
// {key, value: {stringValue|intValue|doubleValue|boolValue}} shape, so RCA
// logic never has to special-case it. Any adapter (DB2, Postgres, MySQL, ...)
// that populates these documented attribute names is understood identically.
function getAttributeValue(span, key) {
  const attr = (span && span.attributes || []).find(a => a && a.key === key);
  if (!attr || attr.value === undefined || attr.value === null) return undefined;
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return undefined;
}

// 2. HYPOTHESIS SUPPORT SCORING
//
// STAGE 15. This was `calculateRcaConfidence`, returning a percentage rendered
// next to the hypothesis as "93.7%". Two things were wrong with it, and both
// were demonstrable:
//
//   1. MISSING EVIDENCE RAISED THE SCORE. `undefined > 90` and
//      `undefined < 70` are both false, so an unmeasured factor simply skipped
//      its adjustment. Not measuring CPU scored 95.0; measuring it and finding
//      it contradicted scored 93.7. Looking made the answer look worse.
//   2. "NOT MEASURED" AND "MEASURED, DOES NOT SUPPORT" SCORED IDENTICALLY —
//      both 80.0 for pool saturation. That is absence of evidence treated as
//      evidence of absence, inside the one number an operator actually reads.
//
// It was also called a "confidence" percentage with a weight of -1.3, which
// implies a calibration that has never existed. These weights are hand-chosen
// judgements, not derived from outcome data, and the output now says so.
//
// Each factor is now explicitly SUPPORTS / CONTRADICTS / UNKNOWN. UNKNOWN
// contributes nothing and is counted against evidence completeness, so an
// unexamined hypothesis can never look well-supported.
const HYPOTHESIS_BASE = 50;

function scoreHypothesis(factors) {
  let support = HYPOTHESIS_BASE;
  let observed = 0;
  for (const f of factors) {
    if (f.state === 'UNKNOWN') continue;      // never moves the score, either way
    observed++;
    if (f.state === 'SUPPORTS') support += f.weight;
    else if (f.state === 'CONTRADICTS') support -= f.weight;
  }
  return {
    support: Math.max(0, Math.min(100, Math.round(support))),
    evidence: { observed, expected: factors.length, unknown: factors.filter(f => f.state === 'UNKNOWN').map(f => f.id) },
    basis: `base ${HYPOTHESIS_BASE} + supporting weights - contradicting weights, over OBSERVED factors only. ` +
           `Weights are hand-chosen engineering judgement, NOT calibrated against outcome data. ` +
           `This is a ranking heuristic, not a probability.`,
    factors
  };
}

// Retained for callers that still expect the old single number. It now returns
// the support score from the same factor model, so it can no longer be raised
// by failing to measure something.
function calculateRcaConfidence({ latencyRatio, poolSaturation, queryFingerprintMatched, cpuSaturation }) {
  return scoreHypothesis(dbLockFactors({ latencyRatio, poolSaturation, queryFingerprintMatched, cpuSaturation })).support;
}

/**
 * Factors for the "database lock contention / pool saturation" hypothesis.
 *
 * NOTE ON DIRECTION, for the owner rather than for me to decide: the original
 * treated LOW CPU as mildly contradicting. Arguably low CPU with high latency
 * *supports* lock contention, since a CPU-bound database would show the
 * opposite. That direction is a domain judgement that has never been
 * validated, so it is preserved as it was rather than silently reversed —
 * see docs/25 §5.
 */
function dbLockFactors({ latencyRatio, poolSaturation, queryFingerprintMatched, cpuSaturation }) {
  return [
    {
      id: 'latency', weight: latencyRatio > 100 ? 20 : 10,
      state: latencyRatio === undefined ? 'UNKNOWN' : (latencyRatio > 10 ? 'SUPPORTS' : 'CONTRADICTS'),
      detail: latencyRatio === undefined
        ? 'no learned baseline for this hop, so no latency ratio can be computed'
        : `${latencyRatio}x this hop's learned p95`
    },
    {
      id: 'connectionPool', weight: 15,
      state: poolSaturation === undefined ? 'UNKNOWN' : (poolSaturation > 90 ? 'SUPPORTS' : 'CONTRADICTS'),
      detail: poolSaturation === undefined
        ? 'connection pool saturation not reported by any adapter'
        : `pool saturation ${poolSaturation}%`
    },
    {
      id: 'queryFingerprint', weight: 10,
      state: queryFingerprintMatched === undefined ? 'UNKNOWN' : (queryFingerprintMatched ? 'SUPPORTS' : 'CONTRADICTS'),
      detail: queryFingerprintMatched === undefined
        ? 'no query fingerprint reported'
        : (queryFingerprintMatched ? 'a blocking query fingerprint was reported' : 'no matching query fingerprint')
    },
    {
      id: 'cpu', weight: 5,
      state: cpuSaturation === undefined ? 'UNKNOWN' : (cpuSaturation < 70 ? 'CONTRADICTS' : 'SUPPORTS'),
      detail: cpuSaturation === undefined
        ? 'DB server CPU utilisation not reported by any adapter'
        : `DB server CPU ${cpuSaturation}%`
    }
  ];
}

// 3. REQUEST DNA MODEL
class RequestDNA {
  /**
   * The observed shape of one request.
   *
   * STAGE 16. Everything below used to have a fabricated fallback, and because
   * `evaluateTrace` never passed the optional arguments, the fallbacks were
   * what every real request got. For a real Python FastAPI trace this reported:
   *
   *   dependencies  : ["DB2-Cluster-01", "Stripe-Gateway-US"]
   *   environment   : { runtime: "WebSphere-9.0.5", jdk: "IBM Semeru 17", host: "app-node-04" }
   *   changeContext : { lastDeploy: "app-v2.4.1 (14m ago)", configHash: "cfg-8841" }
   *   semantics     : { status: 504, headersValid: true, authScopePresent: true }
   *
   * None of it was observed. It told an operator their Python service runs on
   * WebSphere with an IBM JDK and deployed fourteen minutes ago — specific,
   * plausible, actionable and false, which is the worst combination there is.
   * The 504 was invented from latency alone; no HTTP status was ever seen.
   *
   * Everything here is now either OBSERVED or absent. There are no defaults.
   */
  static create(traceId, hops, payloadHeaders, dependencies, environment, changeContext) {
    const structureHash = hops.map(h => h.service || h.node).join("->");
    const totalDuration = hops.reduce((acc, h) => acc + (h.durationMs || 0), 0);

    // Status: only a code an instrumentation library actually reported.
    // Never derived from duration — latency is not a status code.
    let observedStatus;
    for (const h of hops) {
      const code = getAttributeValue(h, 'http.status_code') ?? getAttributeValue(h, 'http.response.status_code');
      if (code !== undefined) { observedStatus = Number(code); break; }
    }
    const errored = hops.some(h => h.status === 'ERROR');

    // Dependencies: the services this request was actually seen to touch.
    const observedDependencies = [...new Set(hops.map(h => h.service || h.node).filter(Boolean))];

    // Environment: only what the sender declared on its OTel resource.
    const versions = {};
    let deploymentEnvironment;
    for (const h of hops) {
      if (h.serviceVersion && h.service) versions[h.service] = h.serviceVersion;
      if (h.deploymentEnvironment && deploymentEnvironment === undefined) deploymentEnvironment = h.deploymentEnvironment;
    }
    const observedEnvironment = {
      serviceVersions: Object.keys(versions).length ? versions : undefined,
      deploymentEnvironment,
      runtime: undefined,   // not carried on any span VITALIS ingests today
      host: undefined
    };

    return {
      traceId,
      structure: {
        path: structureHash,
        hopCount: hops.length
        // `isStandard` is gone. It was
        //   path.includes("Client") && path.includes("WebSphere") && path.includes("DB2")
        // so every request that was not an IBM demo was "non-standard".
      },
      performance: {
        totalDurationMs: totalDuration,
        hopLatencies: hops.map(h => ({ service: h.service || h.node, ms: h.durationMs }))
        // `isWithinBudget` is gone: it compared every request on earth against a
        // hardcoded 180ms. Whether a request is within budget is answered by its
        // LEARNED baseline (see `baseline` on the evaluation result), or not at all.
      },
      semantics: {
        status: observedStatus,
        statusProvenance: observedStatus !== undefined ? 'OBSERVED'
          : (errored ? 'UNKNOWN — a span reported an error but no HTTP status code was ingested'
                     : 'UNKNOWN — no http.status_code attribute was ingested'),
        headersValid: payloadHeaders ? undefined : undefined,
        headersProvenance: 'UNKNOWN — VITALIS does not ingest request headers'
      },
      dependencies: dependencies || observedDependencies,
      dependenciesProvenance: dependencies ? 'SUPPLIED' : 'OBSERVED — services seen on this request',
      environment: environment || observedEnvironment,
      environmentProvenance: environment ? 'SUPPLIED'
        : 'OBSERVED — from OTel resource attributes only; runtime and host are not ingested',
      changeContext: changeContext
      // No fabricated default. Real change correlation is a separate, evidenced
      // field on the evaluation result (`changeCorrelation`), which returns an
      // honest "nothing correlated" when nothing does.
    };
  }

  static compare(goldenDNA, liveDNA) {
    const diffs = [];
    if (goldenDNA.structure.path !== liveDNA.structure.path) {
      diffs.push(`Structural Deviation: Expected [${goldenDNA.structure.path}], observed [${liveDNA.structure.path}]`);
    }
    if (!liveDNA.performance.isWithinBudget) {
      diffs.push(`Performance Deviation: Total duration ${liveDNA.performance.totalDurationMs}ms exceeded budget (${goldenDNA.performance.totalDurationMs}ms)`);
    }
    if (!liveDNA.semantics.headersValid) {
      diffs.push(`Semantic Deviation: Required header X-Vitalis-Auth-Scope was dropped`);
    }

    return {
      isIdentical: diffs.length === 0,
      diffCount: diffs.length,
      deviations: diffs,
      golden: goldenDNA,
      live: liveDNA
    };
  }
}

// 4. INGESTION & DYNAMIC RECONSTRUCTION ENGINE
class VitalisIngestEngine {
  constructor() {
    this.graph = new EvidenceGraph();
    this.traces = loadPersistedTraces();
    this.metrics = [];
    this.logs = [];
    this.goldenDNA = null;
    this.initGoldenPath();
    // STAGE 14: baselines LEARNED from this system's own healthy traffic.
    // `goldenDNA` above is a demo fixture and is no longer used to judge real
    // ingested traces — doing so compared every request against a hardcoded IBM
    // path and flagged 100% of real traffic as deviating. See engine/baseline_learner.js.
    this.baselines = new BaselineLearner();
    this.baselines.rebuildFrom(this.traces);
    this._saveTimer = null;
    // STAGE 2: live subscribers (SSE clients) notified when real telemetry
    // arrives, so the GUI updates from actual ingestion rather than a timer.
    this._subscribers = new Set();
    // STAGE 3: real change events and real vulnerability/component inventory,
    // restored from disk so a restart does not make a changed, vulnerable
    // system look pristine.
    const correlationState = loadCorrelationState();
    this.changeCorrelator = ChangeCorrelator.fromJSON(correlationState.change || {});
    this.vulnCorrelator = VulnerabilityCorrelator.fromJSON(correlationState.vulnerability || {});
  }

  /** Write Stage 3 correlation state to disk. Called on every mutation and at shutdown. */
  persistCorrelationNow() {
    persistCorrelationStateSync({
      change: this.changeCorrelator.toJSON(),
      vulnerability: this.vulnCorrelator.toJSON()
    });
  }

  /** Register a callback fired whenever real spans are ingested. Returns an unsubscribe fn. */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  _notify(event) {
    for (const fn of this._subscribers) {
      try { fn(event); } catch (err) { /* a broken subscriber must never break ingestion */ }
    }
  }

  /**
   * STAGE 2: summarize every trace actually held in memory, for the GUI's
   * fleet view. Deliberately reports only what was really ingested — no
   * placeholder journeys, no invented health scores for traces that don't exist.
   */
  listTraces() {
    const summaries = [];
    for (const [traceId, hops] of this.traces.entries()) {
      const totalDurationMs = hops.reduce((sum, h) => sum + (h.durationMs || 0), 0);
      const worstStatus = hops.some(h => h.status === 'ERROR') ? 'ERROR'
        : hops.some(h => h.status === 'DEGRADED') ? 'DEGRADED' : 'OK';
      summaries.push({
        traceId,
        hopCount: hops.length,
        totalDurationMs,
        status: worstStatus,
        services: [...new Set(hops.map(h => h.service).filter(Boolean))],
        slowestHop: hops.reduce((worst, h) => (!worst || (h.durationMs || 0) > (worst.durationMs || 0)) ? h : worst, null)
      });
    }
    // Slowest first — an operator opens the worst request, not the first one.
    summaries.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
    return { traceCount: summaries.length, traces: summaries };
  }

  initGoldenPath() {
    const goldenHops = [
      { service: "Client", durationMs: 12, status: "OK" },
      { service: "F5-LB", durationMs: 18, status: "OK" },
      { service: "IHS", durationMs: 21, status: "OK" },
      { service: "WebSphere", durationMs: 51, status: "OK" },
      { service: "IBM-MQ", durationMs: 14, status: "OK" },
      { service: "DB2", durationMs: 18, status: "OK" },
      { service: "Stripe", durationMs: 46, status: "OK" }
    ];
    this.goldenDNA = RequestDNA.create("TX-GOLDEN-001", goldenHops, { 'x-vitalis-auth-scope': 'payments:write' });
  }

  // Debounced disk flush so a burst of ingestion doesn't do a sync write per span.
  schedulePersist() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => persistTracesSync(this.traces), 500);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  persistNow() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    persistTracesSync(this.traces);
  }

  ingestOtelSpans(resourceSpans) {
    if (!resourceSpans || !Array.isArray(resourceSpans)) return { count: 0 };

    const stagedEntries = [];
    for (const res of resourceSpans) {
      const serviceNameRaw = res.resource?.attributes?.find(a => a.key === 'service.name')?.value?.stringValue || 'UnknownService';
      const serviceName = PrivacySanitizer.sanitizeText(serviceNameRaw);

      // STAGE 10: the DEPLOYED version of this component, if the sender declared
      // one. This is the strongest version evidence that exists: a repository
      // manifest says what SHOULD ship, `service.version` says what actually ran
      // and served this request. Until now it was read off the wire and thrown
      // away, which meant compatibility drift could only ever be checked against
      // source control — never against production. Undefined when absent; it is
      // never defaulted, because a wrong version is worse than no version.
      const serviceVersionRaw = res.resource?.attributes?.find(a => a.key === 'service.version')?.value?.stringValue;
      const serviceVersion = serviceVersionRaw ? PrivacySanitizer.sanitizeText(serviceVersionRaw) : undefined;
      const deploymentEnvRaw = res.resource?.attributes?.find(a => a.key === 'deployment.environment')?.value?.stringValue;
      const deploymentEnvironment = deploymentEnvRaw ? PrivacySanitizer.sanitizeText(deploymentEnvRaw) : undefined;
      const scopeSpans = res.scopeSpans || [];

      for (const ss of scopeSpans) {
        for (const span of ss.spans || []) {
          const traceId = span.traceId;
          const spanId = span.spanId;
          if (typeof traceId !== 'string' || !traceId || typeof spanId !== 'string' || !spanId) {
            throw new Error('Each span requires nonempty string traceId and spanId');
          }
          const startTimeUnixNano = nano(span.startTimeUnixNano);
          const endTimeUnixNano = nano(span.endTimeUnixNano);
          const durationMs = span.endTimeUnixNano && span.startTimeUnixNano
            ? Math.round((span.endTimeUnixNano - span.startTimeUnixNano) / 1000000)
            : (span.durationMs || 10);

          // STAGE 3: when the request actually happened. Prefer the span's own
          // real start time; fall back to ingest time only when the sender did
          // not provide one. Without this there is nothing to correlate a
          // change event against, and temporal correlation would be guesswork.
          const observedAt = span.startTimeUnixNano
            ? Math.round(Number(span.startTimeUnixNano) / 1e6)
            : Date.now();

          // Redact before anything is stored or graphed — not after.
          const spanData = {
            spanId,
            // STAGE 14: retained so the trace ROOT can be identified
            // structurally. Without it, "root" fell back to the longest span,
            // which meant a request's identity changed whenever it got slow.
            parentSpanId: span.parentSpanId || undefined,
            kind: span.kind,
            timingValid: !!startTimeUnixNano && !!endTimeUnixNano && BigInt(endTimeUnixNano) >= BigInt(startTimeUnixNano),
            startTimeUnixNano,
            endTimeUnixNano,
            otelStatusCode: [0, 1, 2].includes(span.status?.code) ? span.status.code
              : ({ STATUS_CODE_UNSET: 0, STATUS_CODE_OK: 1, STATUS_CODE_ERROR: 2 })[span.status?.code],
            service: serviceName,
            name: PrivacySanitizer.sanitizeText(span.name || ''),
            durationMs,
            observedAt,
            receivedAt: Date.now(),
            status: span.status?.code === 2 ? 'ERROR' : (durationMs > 2000 ? 'DEGRADED' : 'OK'),
            attributes: sanitizeOtelAttributes(span.attributes || [])
          };
          // Only present when the sender actually declared them. An absent key
          // stays absent rather than becoming null/'unknown', so downstream code
          // cannot mistake a default for an observation.
          if (serviceVersion !== undefined) spanData.serviceVersion = serviceVersion;
          const digestValues = (res.resource?.attributes || []).filter(a => a.key === 'vitalis.artifact.digest');
          const identityUnambiguous = ['service.name', 'service.version'].every(key => (res.resource?.attributes || []).filter(a => a.key === key).length === 1);
          if (identityUnambiguous && digestValues.length === 1 && /^sha256:[a-f0-9]{64}$/.test(digestValues[0].value?.stringValue || '')) {
            spanData.artifactDigest = digestValues[0].value.stringValue;
          }
          if (deploymentEnvironment !== undefined) spanData.deploymentEnvironment = deploymentEnvironment;

          stagedEntries.push({ traceId, span: spanData });
        }
      }
    }
    // Validate/redact the complete payload before selecting new observations.
    // Comparison includes same-batch entries; only new evidence reaches admission.
    const { additions: journalEntries, duplicateSpans, conflictingSpans } = selectNewObservations(this.traces, stagedEntries);
    const ingested = journalEntries.length;
    const touchedTraceIds = new Set(journalEntries.map(entry => entry.traceId));
    if (ingested > 0) {
      // Durable first, then the debounced snapshot. If the process dies between
      // these two lines the journal already has the evidence.
      storagePolicy.admit(this.traces, journalEntries, DURABLE_INGEST);
      appendToJournal(journalEntries);
      // Publish only after the durable batch acknowledgment boundary succeeds.
      for (const { traceId, span } of journalEntries) {
        if (!this.traces.has(traceId)) {
          this.traces.set(traceId, []);
          this.graph.addEntity(traceId, 'REQUEST', { traceId });
        }
        this.traces.get(traceId).push(span);
        this.graph.addEntity(span.spanId, 'SPAN', span);
        this.graph.addRelationship(traceId, 'calls', span.service, { durationMs: span.durationMs });
      }
      // STAGE 14: learn from this system's own healthy traffic. Observation is
      // keyed by traceId, so a trace arriving across several OTLP batches
      // replaces its earlier partial reading rather than adding a second sample
      // that describes a fragment of a request nobody made.
      for (const id of touchedTraceIds) this.baselines.observe(this.traces.get(id) || [], id);
      this.schedulePersist();
      this._notify({ type: 'SPANS_INGESTED', ingestedSpans: ingested, traceIds: [...touchedTraceIds] });
    } else if (duplicateSpans) {
      // A retry needs no capacity reservation, but cannot bypass a recovery hold.
      storagePolicy.requireWritable();
    }
    return { ingestedSpans: ingested, duplicateSpans, conflictingSpans };
  }

  ingestOtelMetrics(resourceMetrics) {
    if (!resourceMetrics || !Array.isArray(resourceMetrics)) return { count: 0 };
    const sanitized = resourceMetrics.map(m => PrivacySanitizer.sanitizeObject(m));
    storagePolicy.admitAux([...this.metrics, ...this.logs, ...sanitized], this.metrics.length + this.logs.length + sanitized.length);
    this.metrics.push(...sanitized);
    return { ingestedMetrics: sanitized.length };
  }

  ingestOtelLogs(resourceLogs) {
    if (!resourceLogs || !Array.isArray(resourceLogs)) return { count: 0 };
    const sanitized = resourceLogs.map(l => PrivacySanitizer.sanitizeObject(l));
    storagePolicy.admitAux([...this.metrics, ...this.logs, ...sanitized], this.metrics.length + this.logs.length + sanitized.length);
    this.logs.push(...sanitized);
    return { ingestedLogs: sanitized.length };
  }

  evaluateTrace(traceId) {
    const hops = this.traces.get(traceId) || [];
    // No fabricated headers: VITALIS does not ingest request headers, so it must
    // not pass a literal that makes semantics.headersValid look observed.
    const liveDNA = RequestDNA.create(traceId, hops);

    // STAGE 14: judged against a baseline LEARNED from this request's own
    // healthy history — not against `this.goldenDNA`, which is a hardcoded
    // IBM demo path (Client->F5-LB->IHS->WebSphere->IBM-MQ->DB2->Stripe).
    // Comparing real traffic to that fixture flagged 100% of real requests as
    // deviating and told the operator their request should have gone through
    // WebSphere. `goldenDNA` is retained only as demo fixture data.
    //
    // Verdict is UNKNOWN until enough healthy observations exist. A request
    // with no baseline is not healthy and not deviating — it is unmeasured,
    // and saying so is the point.
    const baseline = this.baselines.compare(hops);

    let candidates = [];
    // A "DB hop" is identified two ways, most-correct first:
    //  1. The standard OTel semantic-convention attribute `db.system` (set by
    //     any real DB client instrumentation, e.g. pg/mysql2/jdbc auto-instrumentation)
    //     on the span itself — this is correct even when many hops share one
    //     resource-level service.name, which is the normal case for a single
    //     instrumented application (Tier A: one process, many internal spans).
    //  2. Falling back to resource/span name string matching, for hops that
    //     came from a Tier B adapter or demo fixture with no db.system attribute
    //     but a self-describing service name (e.g. this project's "Postgres"/"DB2"
    //     adapter spans, or the hardcoded golden-baseline demo hops).
    const dbHop = hops.find(h =>
      getAttributeValue(h, 'db.system') !== undefined ||
      (h.service || '').toLowerCase().includes('db') ||
      (h.service || '').toLowerCase().includes('postgres') ||
      (h.name || '').toLowerCase().includes('db') ||
      (h.name || '').toLowerCase().includes('query')
    );

    if (dbHop && dbHop.durationMs > 1000) {
      // STAGE 14: the ratio is against THIS hop's own learned p95.
      //
      // It was `dbHop.durationMs / 18` — a hardcoded demo number — and the
      // result was printed as "90x higher than Golden Baseline (18ms) —
      // OBSERVED" and fed into the confidence score, where >100x adds 20 points
      // and >10x adds 10. So a fabricated divisor was inflating a number
      // presented to operators as measured. Found by reading the rendered
      // console after the baseline work, not by reading the code.
      //
      // With no learned baseline for this hop the ratio is UNKNOWN and
      // contributes NOTHING to the score, rather than being invented.
      const dbHopKey = `${dbHop.service || dbHop.node}::${dbHop.name || ''}`;
      const hopBaseline = (baseline.baseline && baseline.baseline.hops)
        ? baseline.baseline.hops[dbHopKey] : undefined;
      const hopP95 = hopBaseline && hopBaseline.p95 > 0 ? hopBaseline.p95 : undefined;
      const latencyRatio = hopP95 !== undefined ? Math.round(dbHop.durationMs / hopP95) : undefined;

      // STAGE 1: pull real evidence from whatever the sensory adapter actually
      // reported as span attributes, instead of the Stage 0 behavior of always
      // printing the same fixed demo numbers regardless of what was ingested.
      // This is the documented attribute contract any DB adapter (DB2, Postgres,
      // MySQL, ...) should populate — see engine/adapters/ADAPTER_CONTRACT.md.
      const lockWaitMs = getAttributeValue(dbHop, 'db.lock_wait_ms');
      const poolSaturationPct = getAttributeValue(dbHop, 'db.connection_pool.saturation_pct');
      const holdingLockPid = getAttributeValue(dbHop, 'db.holding_lock_pid');
      const queryFingerprint = getAttributeValue(dbHop, 'db.query.fingerprint');
      const cpuSaturationPct = getAttributeValue(dbHop, 'db.cpu_utilization_pct');
      // STAGE 8: when the application propagated trace context into the database
      // connection, the adapter can name the REQUEST holding the lock, not just
      // the backend PID. "Blocked behind PID 4242" sends someone to a database
      // console; "blocked behind request <id>" points at the actual culprit.
      const blockingTraceId = getAttributeValue(dbHop, 'db.blocking_trace_id');

      // STAGE 15: unmeasured values are passed through as `undefined` so the
      // factor model can mark them UNKNOWN. They used to be coerced —
      // `poolSaturation ... : 0` turned "nobody measured the pool" into
      // "the pool was measured at 0%", manufacturing a CONTRADICTION out of
      // absence; `!!queryFingerprint` did the same for a missing fingerprint;
      // and CPU was defaulted to 100 to dodge a penalty, which is a guess
      // chosen to move a number. Absence is now absence.
      const scored = scoreHypothesis(dbLockFactors({
        latencyRatio,
        poolSaturation: poolSaturationPct,
        queryFingerprintMatched: queryFingerprint ? true : undefined,
        cpuSaturation: cpuSaturationPct
      }));
      const calculatedConfidence = scored.support;

      const supportingEvidence = [
        latencyRatio !== undefined
          ? `DB span duration (${dbHop.durationMs}ms) is ${latencyRatio}x this hop's learned p95 (${Math.round(hopP95)}ms over ${hopBaseline.observations} healthy observations) — OBSERVED`
          : `DB span duration (${dbHop.durationMs}ms) — UNKNOWN how abnormal: no learned baseline for this hop yet, so no ratio is claimed`
      ];
      supportingEvidence.push(lockWaitMs !== undefined
        ? `Connection/lock wait time reached ${lockWaitMs}ms — OBSERVED`
        : `Lock wait time: UNKNOWN — sensory adapter did not report db.lock_wait_ms`);
      supportingEvidence.push(queryFingerprint
        ? `Query fingerprint ${queryFingerprint} — OBSERVED`
        : `Query fingerprint: UNKNOWN — sensory adapter did not report db.query.fingerprint`);

      const contradictingEvidence = [cpuSaturationPct !== undefined
        ? `DB server CPU utilization is ${cpuSaturationPct}% — ${cpuSaturationPct < 70 ? 'argues against CPU burnout as the cause' : 'consistent with CPU-driven slowdown, not purely lock contention'} (OBSERVED)`
        : `DB server CPU utilization: UNKNOWN — sensory adapter did not report db.cpu_utilization_pct`];

      candidates.push({
        rank: 1,
        title: "Database Lock Contention & Connection Pool Saturation",
        confidence: calculatedConfidence,
        support: scored.support,
        evidenceCompleteness: scored.evidence,
        scoringBasis: scored.basis,
        factors: scored.factors,
        provenance: (lockWaitMs !== undefined && poolSaturationPct !== undefined) ? 'INFERRED' : 'INFERRED_FROM_PARTIAL_EVIDENCE',
        scoringFormula: `base 50 ` + scored.factors.map(f => f.state === 'UNKNOWN'
          ? `| ${f.id}: UNKNOWN (${f.detail}) contributes 0`
          : `| ${f.id}: ${f.state === 'SUPPORTS' ? '+' : '-'}${f.weight} (${f.detail})`).join(' ')
          + ` = ${scored.support} support, ${scored.evidence.observed} of ${scored.evidence.expected} factors observed`,
        supportingEvidence,
        contradictingEvidence,
        blastRadius: blockingTraceId
          ? `Blocked behind request ${blockingTraceId}${holdingLockPid !== undefined ? ` (backend PID #${holdingLockPid})` : ''} — OBSERVED via propagated trace context`
          : (holdingLockPid !== undefined
            ? `Requests blocked behind holding lock PID #${holdingLockPid} — OBSERVED (the blocking request itself is UNKNOWN: that session did not propagate trace context)`
            : `Blast radius: UNKNOWN — sensory adapter did not report db.holding_lock_pid`),
        recommendedAction: blockingTraceId
          ? `Investigate request ${blockingTraceId}, which holds the lock${holdingLockPid !== undefined ? ` on backend PID #${holdingLockPid}` : ''} — RECOMMENDED, requires human approval to execute`
          : holdingLockPid !== undefined
          ? `Investigate holding lock PID #${holdingLockPid}; evaluate read-replica scaling — RECOMMENDED, requires human approval to execute`
          : `Recommended action: insufficient evidence to recommend a specific fix — sensory adapter did not report a holding lock PID`
      });
    }

    // STAGE 3: correlate real change events against when this request was
    // actually observed. Returns an honest "nothing correlated" when no change
    // falls in the window — there is no nearest-change fallback.
    const observedAt = hops.reduce((earliest, h) =>
      (h.observedAt && (!earliest || h.observedAt < earliest)) ? h.observedAt : earliest, null);
    const changeCorrelation = this.changeCorrelator.correlate(
      observedAt,
      [...new Set(hops.map(h => h.service).filter(Boolean))]
    );

    return {
      traceId,
      hops,
      dna: liveDNA,
      baseline,
      // Back-compat shape for existing callers. Derived from the LEARNED
      // baseline, never from the demo fixture. `isIdentical` is null — not
      // true — when there is no baseline, so "no deviations" can never be
      // misread as "verified healthy".
      diff: {
        isIdentical: baseline.verdict === 'UNKNOWN' ? null : baseline.verdict === 'HEALTHY',
        diffCount: baseline.deviations.length,
        deviations: baseline.deviations.map(d => `${d.type}: ${d.detail} (${d.evidence})`),
        baselineSource: baseline.baselineSource,
        verdict: baseline.verdict
      },
      candidates,
      changeCorrelation
    };
  }
}

// 5. HTTP SERVER WITH STATIC ASSET SERVING
const engine = new VitalisIngestEngine();
function caseEvidence(traceId, revision) {
  const spans = engine.traces.get(traceId);
  if (!spans) caseContract.fail('CASE_EVIDENCE_UNAVAILABLE', 'Request evidence is not retained', 404);
  const investigation = buildInvestigation({ traceId, hops: spans, compatibility: spans.length <= 1000 ? configuredReport({ traceId, hops: spans }) : null });
  if (investigation.revision !== revision) caseContract.fail('CASE_EVIDENCE_CHANGED', 'Request evidence changed; refresh and review before saving', 409);
  return caseContract.snapshot(traceId, spans, investigation);
}
function caseView(item) {
  const latestEvidence = [...new Set(item.evidence.map(e => e.traceId))].map(traceId => {
    const saved = item.evidence.filter(e => e.traceId === traceId).at(-1), hops = engine.traces.get(traceId);
    const report = hops && buildInvestigation({ traceId, hops, compatibility: hops.length <= 1000 ? configuredReport({ traceId, hops }) : null });
    return { traceId, savedRevision: saved.investigationRevision, currentRevision: report?.revision || null,
      state: !report ? 'CURRENT_EVIDENCE_UNAVAILABLE' : saved.investigationRevision === report.revision ? 'CURRENT' : 'NEW_EVIDENCE_AVAILABLE' };
  });
  return { ...item, latestEvidence, recoveryVerification: 'NOT_IMPLEMENTED', executionEnabled: false };
}
const PORT = process.env.PORT || 4318;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, traceparent, x-vitalis-trace-id, x-vitalis-api-key');
}

const PROTECTED_PREFIXES = ['/v1/', '/api/'];
function requiresAuth(pathname) {
  return PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;
  const method = req.method;
  const remoteIp = req.socket.remoteAddress || 'unknown';

  applyCors(req, res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Stage 0 auth gate: every ingestion/API endpoint requires the shared key.
  // /health and static UI assets stay open (health checks, load balancers).
  if (requiresAuth(pathname) && !isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'UNAUTHORIZED', error: 'Missing or invalid x-vitalis-api-key header' }));
    return;
  }

  // OTLP Ingestion Endpoints
  if (method === 'GET' && (pathname === '/api/cases' || pathname.startsWith('/api/cases/'))) {
    try {
      let result;
      if (pathname === '/api/cases') {
        const query = new URL(req.url, 'http://localhost').searchParams, limit = Number(query.get('limit') ?? 25), offset = Number(query.get('offset') ?? 0);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) caseContract.fail('CASE_INVALID_INPUT', 'limit must be 1-100; offset must be nonnegative');
        result = caseRepository.list({ limit, offset, traceId: query.get('traceId') });
      } else {
        const id = pathname.slice('/api/cases/'.length);
        if (!caseContract.UUID.test(id)) caseContract.fail('CASE_NOT_FOUND', 'Case not found', 404);
        result = caseView(caseRepository.get(id));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(error.httpStatus || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: error.code || 'CASE_READ_FAILED', error: error.message })); }
    return;
  }
  if (method === 'GET' && pathname === '/api/storage') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(storagePolicy.status(engine.traces, {
      auxiliaryRecords: engine.metrics.length + engine.logs.length,
      auxiliaryBytes: Buffer.byteLength(JSON.stringify([...engine.metrics, ...engine.logs]))
    }))); return;
  }
  if (method === 'POST') {
    if (isRateLimited(remoteIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'RATE_LIMITED', error: `Max ${RATE_LIMIT_MAX_REQUESTS} requests/min exceeded` }));
      return;
    }

    // STAGE 12: collect Buffers, never a string.
    //
    // This was `body += chunk`, which coerces every chunk through UTF-8 and
    // silently corrupts binary. OTLP/protobuf — the DEFAULT encoding for the
    // Python, Java, Go and .NET SDKs and for the OpenTelemetry Collector —
    // could therefore never be read, and every one of those senders got an
    // HTTP 400 and dropped its spans.
    const chunks = [];
    let bodyBytes = 0;
    let tooLarge = false;
    let oversizedDeadline;
    const rejectOversized = () => {
      if (res.writableEnded) return;
      res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({ status: 'PAYLOAD_TOO_LARGE', error: `Body exceeds ${MAX_BODY_BYTES} bytes` }));
    };
    req.on('close', () => clearTimeout(oversizedDeadline));
    req.on('data', chunk => {
      if (tooLarge) return;
      chunks.push(chunk);
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        // Discard retained bytes and drain before closing. Closing with unread
        // upload bytes can reset the socket before Windows receives the 413.
        // Bound draining to five seconds; retain no further body data.
        chunks.length = 0;
        oversizedDeadline = setTimeout(() => { rejectOversized(); req.destroy(); }, 5000);
        oversizedDeadline.unref();
        req.resume();
      }
    });
    req.on('end', () => {
      clearTimeout(oversizedDeadline);
      if (tooLarge) { rejectOversized(); return; }
      const raw = Buffer.concat(chunks);
      const contentType = req.headers['content-type'];
      const isProto = isProtobufContentType(contentType);
      try {
        let payload;
        if (isProto) {
          // Only traces are defined for protobuf here. Metrics and logs would
          // need their own schemas, and pretending to accept them would drop
          // data silently — the worst failure an observability tool can have.
          if (pathname !== '/v1/traces') {
            res.writeHead(415, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'UNSUPPORTED_ENCODING',
              error: `OTLP protobuf is supported on /v1/traces only; ${pathname} accepts JSON. Send this signal as application/json, or route it through an OpenTelemetry Collector.`
            }));
            return;
          }
          payload = decodeExportTraceServiceRequest(raw);
        } else {
          payload = JSON.parse(raw.toString('utf8') || '{}');
        }
        let result = {};

        // STAGE 3 ingestion: real change events, real component inventories,
        // real vulnerability advisories. Each comes from a real adapter
        // (git_change_adapter.js, npm_audit_adapter.js) or any equivalent
        // scanner/CI webhook mapped to the same shape.
        if (pathname === '/api/cases' || pathname.startsWith('/api/cases/')) {
          const match = pathname.match(/^\/api\/cases\/([^/]+)\/decisions$/);
          if (pathname !== '/api/cases' && (!match || !caseContract.UUID.test(match[1]))) caseContract.fail('CASE_NOT_FOUND', 'Case endpoint not found', 404);
          result = caseRepository.execute(payload, match?.[1], caseEvidence);
          result.case = caseView(result.case);
        } else if (['/v1/changes', '/v1/components', '/v1/vulnerabilities'].includes(pathname)) {
          const changes = ChangeCorrelator.fromJSON(engine.changeCorrelator.toJSON());
          const vulnerabilities = VulnerabilityCorrelator.fromJSON(engine.vulnCorrelator.toJSON());
          if (pathname === '/v1/changes') result = changes.ingestChanges(payload.changeEvents || []);
          if (pathname === '/v1/components') result = vulnerabilities.registerInventory(payload.service, payload.components || []);
          if (pathname === '/v1/vulnerabilities') result = vulnerabilities.ingestAdvisories(payload.advisories || []);
          persistCorrelationStateSync({ change: changes.toJSON(), vulnerability: vulnerabilities.toJSON() });
          engine.changeCorrelator = changes; engine.vulnCorrelator = vulnerabilities;
        } else if (pathname === '/v1/traces') {
          result = engine.ingestOtelSpans(payload.resourceSpans || payload);
        } else if (pathname === '/v1/metrics') {
          result = engine.ingestOtelMetrics(payload.resourceMetrics || payload);
        } else if (pathname === '/v1/logs') {
          result = engine.ingestOtelLogs(payload.resourceLogs || payload);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint Not Found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'SUCCESS', ...result }));
      } catch (err) {
        if (err.httpStatus && err.code?.startsWith('CASE_')) {
          res.writeHead(err.httpStatus, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: err.code, error: err.message })); return;
        }
        if (err.code === 'EVIDENCE_WRITE_FAILED') {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
          res.end(JSON.stringify({ status: 'EVIDENCE_WRITE_FAILED', retryable: true,
            error: pathname.startsWith('/api/cases') ? 'Case decision was not acknowledged. Retry the same operation after storage recovery.' : 'Durable evidence could not be recorded. The batch was not published to the live request model.',
            recoveryRequired: err.rollbackFailed === true }));
          return;
        }
        if (['STORAGE_RECOVERY_REQUIRED', 'STORAGE_CAPACITY_EXCEEDED', 'STORAGE_WRITER_LOCKED'].includes(err.code)) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: err.code, error: err.message, details: err.details || null,
            retryable: false, nextStep: 'Inspect /api/storage; retry after capacity, recovery or writer ownership is resolved.' })); return;
        }
        // Name the encoding explicitly. A sender whose spans are vanishing needs
        // to know WHICH decoder failed and what was actually sent; "Bad Request"
        // is what made this defect survive as long as it did.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: pathname.startsWith('/api/cases') ? 'CASE_INVALID_INPUT' : 'INVALID_OTLP_PAYLOAD',
          encoding: isProto ? 'protobuf' : 'json',
          contentType: contentType || '(none sent)',
          bytes: bodyBytes,
          error: err.message,
          hint: isProto
            ? 'The body was read as OTLP/protobuf and could not be decoded. Confirm the sender targets /v1/traces with OTLP protobuf v1.'
            : 'The body was read as JSON because Content-Type was not application/x-protobuf. If this sender emits protobuf, set the header; OTLP/JSON senders must send valid JSON.'
        }));
      }
    });
    return;
  }

  // STAGE 2 — REST API: list every trace actually ingested (the GUI's fleet view).
  // Without this, the UI could only show a trace whose ID you already knew, which
  // is why the old front end had its transaction ID hardcoded.
  // Architecture phase B/C: bounded, authenticated, read-only investigation API.
  if (method === 'GET' && pathname === '/api/investigations') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const limit = Number(query.get('limit') ?? 25), offset = Number(query.get('offset') ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'limit must be 1–100 and offset a nonnegative integer' })); return;
    }
    const ids = [...engine.traces.keys()].sort();
    const items = ids.slice(offset, offset + limit).map(traceId => {
      const hops = engine.traces.get(traceId);
      const report = buildInvestigation({ traceId, hops, compatibility: hops.length <= 1000 ? configuredReport({ traceId, hops }) : null });
      return { traceId, revision: report.revision, triage: report.triage, operation: report.operation,
        outcome: report.outcome, timing: report.timing, gapCount: report.gaps.length, evidenceContext: report.evidenceContext };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ schemaVersion: 1, total: ids.length, offset, limit,
      nextOffset: offset + items.length < ids.length ? offset + items.length : null,
      scope: 'Retained observations, ordered by trace ID; pagination is not an immutable snapshot or a production incident count.', items })); return;
  }
  if (method === 'GET' && pathname.startsWith('/api/investigations/')) {
    const traceId = pathname.slice('/api/investigations/'.length);
    if (!engine.traces.has(traceId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Trace not found' })); return;
    }
    const hops = engine.traces.get(traceId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildInvestigation({ traceId, hops, compatibility: hops.length <= 1000 ? configuredReport({ traceId, hops }) : null }))); return;
  }
  if (method === 'GET' && pathname === '/api/traces') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(engine.listTraces()));
    return;
  }

  // STAGE 3 — Vulnerability blast radius: which REAL ingested requests actually
  // traversed a service running the affected component. This is the question a
  // dependency scanner structurally cannot answer, because it has no requests.
  if (method === 'GET' && pathname.startsWith('/api/impact/')) {
    const advisoryId = decodeURIComponent(pathname.replace('/api/impact/', ''));
    const result = engine.vulnCorrelator.assessImpact(advisoryId, engine.traces);
    res.writeHead(result.found ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // STAGE 7 — fleet overview: incidents, service topology and coverage, all
  // derived from what was actually ingested. Every number here is a count of
  // real spans; nothing is modelled or projected.
  if (method === 'GET' && pathname === '/api/overview') {
    const services = new Map();   // service -> { hops, degraded, errors, totalMs }
    const incidents = [];

    for (const [traceId, hops] of engine.traces.entries()) {
      const totalDurationMs = hops.reduce((s, h) => s + (h.durationMs || 0), 0);
      const worst = hops.some(h => h.status === 'ERROR') ? 'ERROR'
        : hops.some(h => h.status === 'DEGRADED') ? 'DEGRADED' : 'OK';

      for (const h of hops) {
        if (!h.service) continue;
        if (!services.has(h.service)) services.set(h.service, { service: h.service, hops: 0, degraded: 0, errors: 0, totalMs: 0 });
        const s = services.get(h.service);
        s.hops++;
        s.totalMs += h.durationMs || 0;
        if (h.status === 'DEGRADED') s.degraded++;
        if (h.status === 'ERROR') s.errors++;
      }

      if (worst !== 'OK') {
        // The first non-OK hop is where this request actually started going wrong.
        const firstBad = hops.find(h => h.status !== 'OK');
        incidents.push({
          traceId,
          severity: worst,
          totalDurationMs,
          firstDeviationService: firstBad ? firstBad.service : null,
          firstDeviationDurationMs: firstBad ? firstBad.durationMs : null,
          observedAt: hops.reduce((e, h) => (h.observedAt && (!e || h.observedAt < e)) ? h.observedAt : e, null),
          services: [...new Set(hops.map(h => h.service).filter(Boolean))]
        });
      }
    }

    // Worst first: errors before degradations, then slowest.
    incidents.sort((a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'ERROR' ? -1 : 1) ||
      (b.totalDurationMs - a.totalDurationMs));

    // Group incidents by where they first went wrong — the closest thing to a
    // real "incident cluster" that observed data alone can support.
    const clusters = {};
    for (const inc of incidents) {
      const key = inc.firstDeviationService || 'unattributed';
      if (!clusters[key]) clusters[key] = { service: key, count: 0, traceIds: [] };
      clusters[key].count++;
      if (clusters[key].traceIds.length < 10) clusters[key].traceIds.push(inc.traceId);
    }

    const serviceList = [...services.values()].map(s => ({
      ...s,
      avgMs: s.hops ? Math.round(s.totalMs / s.hops) : 0,
      // Whether VITALIS has been told what this service is built from. Not
      // knowing is reported as unknown, never as clean.
      inventoryKnown: engine.vulnCorrelator.inventories.has(s.service)
    })).sort((a, b) => (b.errors + b.degraded) - (a.errors + a.degraded) || b.hops - a.hops);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      traceCount: engine.traces.size,
      incidentCount: incidents.length,
      incidents: incidents.slice(0, 100),
      clusters: Object.values(clusters).sort((a, b) => b.count - a.count),
      services: serviceList,
      coverage: {
        servicesSeen: serviceList.length,
        servicesWithInventory: serviceList.filter(s => s.inventoryKnown).length,
        servicesUnknown: serviceList.filter(s => !s.inventoryKnown).map(s => s.service),
        changeEventsKnown: engine.changeCorrelator.changeEvents.length,
        advisoriesKnown: engine.vulnCorrelator.advisories.size
      }
    }));
    return;
  }

  // STAGE 3 — every ingested advisory ranked by real observed exposure.
  if (method === 'GET' && pathname === '/api/impact') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(engine.vulnCorrelator.assessAll(engine.traces)));
    return;
  }

  // STAGE 2 — Server-Sent Events: push real ingestion events to the GUI.
  //
  // Deliberately consumed by the browser via fetch()+ReadableStream rather than
  // EventSource: EventSource cannot set request headers, which would have forced
  // the API key into the query string, where it lands in access logs, proxy logs
  // and browser history. Streaming over fetch keeps the Stage 0 header-based auth
  // model intact with no new credential-exposure path.
  if (method === 'GET' && pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ traceCount: engine.traces.size })}\n\n`);

    const unsubscribe = engine.subscribe(evt => {
      try { res.write(`event: ingest\ndata: ${JSON.stringify(evt)}\n\n`); }
      catch (err) { /* client vanished mid-write; cleanup below handles it */ }
    });
    // Keep-alive comment frame so idle proxies don't close the stream.
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch (err) { /* same */ }
    }, 20000);
    if (heartbeat.unref) heartbeat.unref();

    const cleanup = () => { clearInterval(heartbeat); unsubscribe(); };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return;
  }

  // REST API: V1 Trace Evaluation
  if (method === 'GET' && pathname.startsWith('/api/traces/')) {
    const traceId = pathname.replace('/api/traces/', '');
    const result = engine.evaluateTrace(traceId);
    result.compatibility = configuredReport({ traceId, hops: engine.traces.get(traceId) || [] });
    result.investigation = buildInvestigation({ traceId, hops: result.hops, compatibility: result.compatibility });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // REST API: Beta-2 Full Enterprise 10-Hop Trace Evaluation
  if (method === 'GET' && pathname.startsWith('/api/v2/enterprise-trace')) {
    const { EnterpriseEvidenceCorrelator } = require('./engine/adapters/enterprise_correlator');
    const correlator = new EnterpriseEvidenceCorrelator();
    const traceId = parsedUrl.query?.traceId;
    if (!traceId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'TRACE_ID_REQUIRED',
        error: 'Pass ?traceId=<id> for a trace that has actually been ingested. ' +
               'This endpoint previously defaulted to a demo id and fabricated DB2 numbers; it no longer does.'
      }));
      return;
    }

    const hops = engine.traces.get(traceId);
    if (!hops || hops.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'TRACE_NOT_FOUND', traceId, error: `No spans have been ingested for ${traceId}` }));
      return;
    }

    // Derive the database picture from what was ACTUALLY ingested. This endpoint
    // used to pass fixed values (executionDurationMs 3982, lockWaitMs 2100,
    // holdingLockPid 99142, connectionPoolSaturationPct 98) for every request,
    // regardless of the telemetry — the same fabrication class already removed
    // from evaluateTrace() in Stage 1. Absent attributes are now left undefined
    // rather than filled in with plausible-looking numbers.
    const dbHop = hops.find(h =>
      getAttributeValue(h, 'db.system') !== undefined ||
      (h.service || '').toLowerCase().includes('db') ||
      (h.service || '').toLowerCase().includes('postgres') ||
      (h.name || '').toLowerCase().includes('db') ||
      (h.name || '').toLowerCase().includes('query')) || null;

    const db2Raw = dbHop ? {
      executionDurationMs: dbHop.durationMs,
      lockWaitMs: getAttributeValue(dbHop, 'db.lock_wait_ms'),
      holdingLockPid: getAttributeValue(dbHop, 'db.holding_lock_pid'),
      connectionPoolSaturationPct: getAttributeValue(dbHop, 'db.connection_pool.saturation_pct')
    } : {};

    // Real correlated changes for this request, from the Stage 3 correlator —
    // not a hardcoded "v2.4.1 deployed 14 minutes ago".
    const observedAt = hops.reduce((earliest, h) =>
      (h.observedAt && (!earliest || h.observedAt < earliest)) ? h.observedAt : earliest, null);
    const correlation = engine.changeCorrelator.correlate(
      observedAt, [...new Set(hops.map(h => h.service).filter(Boolean))]);
    const changeEvents = (correlation.correlations || []).map(c => ({
      type: c.type, version: c.version, minutesAgo: c.minutesBeforeRequest,
      commit: c.commit, provenance: 'CORRELATED'
    }));

    const result = correlator.correlateFullEnterpriseJourney({ traceId, db2Raw, changeEvents });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...result, evidenceSource: 'INGESTED_TELEMETRY', db2Raw, changeEvents }));
    return;
  }

  // Health Endpoint — intentionally public (load balancers / uptime checks)
  if (method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'VITALIS_ENGINE_ONLINE', version: '2.1.0-enterprise', oidc: 'OTel-Graduated-Compliant' }));
    return;
  }

  // Only public UI assets may bypass API authentication. Never expose repository
  // evidence, configuration or case snapshots via the generic static route.
  if (method === 'GET') {
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }
    if (!['/index.html', '/styles.css', '/app.js', '/case_console.js'].includes(pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Public asset not found' })); return;
    }

    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, safePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File Not Found', path: pathname }));
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint Not Found' }));
});

function startServer(port = PORT, host) {
  return new Promise((resolve, reject) => {
    try {
      storagePolicy.acquire();
      engine.traces = loadPersistedTraces(); engine.baselines.rebuildFrom(engine.traces);
      const correlation = loadCorrelationState();
      engine.changeCorrelator = ChangeCorrelator.fromJSON(correlation.change || {});
      engine.vulnCorrelator = VulnerabilityCorrelator.fromJSON(correlation.vulnerability || {});
      caseRepository.load();
    } catch (error) { reject(error); return; }
    const failed = error => { storagePolicy.release(); reject(error); };
    server.once('error', failed);
    server.listen(port, host, () => {
      server.removeListener('error', failed);
      resolve(server);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    engine.persistNow();
    // server.close() stops accepting NEW connections but leaves established
    // keep-alive sockets open, so a client's pooled idle socket is never told
    // the server is gone. It only finds out by writing to a dead connection and
    // getting ECONNRESET — which is exactly what made Alpha Gate 5 fail on
    // restart. Closing idle connections sends a proper FIN, so clients evict
    // the socket and dial fresh. This is correct graceful-shutdown behaviour for
    // real clients, not just for the test.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    server.close(() => {
      storagePolicy.release();
      resolve();
    });
  });
}

if (require.main === module) {
  startServer(PORT).then(() => {
    console.log(`[VITALIS SERVER] Running live at: http://localhost:${PORT}`);
    console.log(`[VITALIS INGEST] OTLP HTTP Ingestion Endpoint: http://localhost:${PORT}/v1/traces`);
    console.log(`[VITALIS DATA]   Persisting ingested traces to: ${TRACES_FILE}`);
  }).catch(error => { console.error(error.code || 'START_FAILED', error.message); process.exitCode = 1; });

  const shutdown = (signal) => {
    console.log(`[VITALIS SERVER] Received ${signal}, flushing state and shutting down...`);
    stopServer().then(() => process.exit(0));
    // Force-exit if close() hangs for any reason.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { VitalisIngestEngine, RequestDNA, EvidenceGraph, startServer, stopServer, calculateRcaConfidence, scoreHypothesis, dbLockFactors };
