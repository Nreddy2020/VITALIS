/**
 * VITALIS: learned request baselines
 *
 * WHY THIS EXISTS
 *
 * The product's central claim is that VITALIS follows a request, stays silent
 * when it is healthy, and catches it at the point of deviation. "Deviation"
 * means *different from how this request normally behaves* — so the baseline
 * has to come from how this request normally behaves.
 *
 * It did not. `initGoldenPath()` created a single hardcoded baseline:
 *
 *     Client -> F5-LB -> IHS -> WebSphere -> IBM-MQ -> DB2 -> Stripe   (180ms)
 *
 * Every real ingested trace was compared against that. A real FastAPI request
 * produced:
 *
 *     "Structural Deviation: Expected [Client->F5-LB->IHS->WebSphere->IBM-MQ->
 *      DB2->Stripe], observed [ledger-api->ledger-api->ledger-api->ledger-api]"
 *
 * Which means **100% of real traffic was flagged as deviating**, against a
 * baseline that was fiction, with a message telling the operator their request
 * should have travelled through WebSphere and DB2. A tool that alerts on
 * everything alerts on nothing, and this one was also actively misleading.
 *
 * This is the fourth instance of the same drift — IBM again (`01` §9, `19`,
 * `21`) — and this time at the centre of the product rather than at an edge.
 *
 * WHAT A BASELINE IS HERE
 *
 * Per REQUEST IDENTITY, learned only from observed healthy traces:
 *   - the set of hops the request normally touches
 *   - the distribution of its total duration
 *
 * THE HONESTY RULES, which are the whole point:
 *
 *   1. Below `minObservations`, there is NO baseline. The verdict is UNKNOWN —
 *      never "healthy", never "deviation". A new request is not a broken one.
 *   2. A baseline is only ever compared against the SAME request identity.
 *      Comparing across identities is what produced the fiction above.
 *   3. Only healthy traces are learned from, or the baseline absorbs the
 *      outage it is supposed to detect.
 *   4. Every verdict carries its evidence: the key, the sample size, the
 *      threshold, and how the threshold was derived.
 */

const DEFAULTS = {
  minObservations: 5,     // below this, UNKNOWN — not a verdict
  maxSamples: 200,        // rolling window per key
  latencyFactor: 1.5,     // deviation when total exceeds p95 * factor ...
  latencyFloorMs: 50      // ... and by at least this much, so tiny requests
                          // do not alarm on ordinary jitter
};

/**
 * Request identity: what makes two requests "the same request".
 *
 * Service plus the root span's name. For HTTP handlers instrumented to OTel
 * conventions that is the ROUTE TEMPLATE ("GET /api/accounts/{acct}"), not the
 * concrete URL — so every account id shares one baseline, which is what makes
 * the sample sizes meaningful.
 *
 * Returns null when identity cannot be established. A null key is never
 * bucketed under a fallback: an unidentifiable request gets no baseline rather
 * than being compared against the wrong one.
 */
/**
 * How many independent request roots does this trace contain?
 *
 * A trace is supposed to be ONE request. Real telemetry does not always oblige:
 * on a real FastAPI app, 16 separate HTTP requests arrived under a single trace
 * id — 60 spans, 18 of them request roots, all parented to one long-lived span
 * that was never exported. Something in that app holds an OpenTelemetry context
 * open, so every request is adopted as its child.
 *
 * VITALIS silently collapsed all 16 into one 4-second "request", and would have
 * learned that blob as a baseline sample — poisoning the baseline for every real
 * request of that route. Eighteen requests wearing one trace id is not a request;
 * it is a batch, and saying so is the only honest option.
 */
function traceShape(hops) {
  const ids = new Set(hops.map(h => h.spanId).filter(Boolean));
  const seen = new Set(), duplicateSpanIds = new Set();
  for (const hop of hops) {
    if (hop.spanId && seen.has(hop.spanId)) duplicateSpanIds.add(hop.spanId);
    seen.add(hop.spanId);
  }
  const roots = hops.filter(h => !h.parentSpanId || !ids.has(h.parentSpanId));
  const externalParents = [...new Set(
    hops.filter(h => h.parentSpanId && !ids.has(h.parentSpanId)).map(h => h.parentSpanId)
  )];
  return { spanCount: hops.length, rootCount: roots.length, roots, externalParents, duplicateSpanIds: [...duplicateSpanIds].sort() };
}

function requestKey(hops) {
  if (!Array.isArray(hops) || hops.length === 0) return null;

  // More than one root means this is not one request. Return no identity, so it
  // is never learned from and never compared against a baseline built from real
  // single requests.
  const shape = traceShape(hops);
  if (shape.rootCount > 1 || shape.duplicateSpanIds.length) return null;

  // Root = the span whose parent is not part of this trace.
  //
  // This was originally "the longest-running span", which is a serious bug: a
  // slow downstream hop becomes the longest span, so a request's IDENTITY
  // changed whenever it got slow. It would then be compared against a
  // different baseline — or none — precisely when something was going wrong,
  // which is the one moment the comparison has to hold still.
  const ids = new Set(hops.map(h => h.spanId).filter(Boolean));
  const roots = hops.filter(h => !h.parentSpanId || !ids.has(h.parentSpanId));
  const candidates = roots.length ? roots : hops;

  // Deterministic tie-break for traces with several parentless spans (common
  // in synthetic fixtures, rare in real OTel output): earliest observation,
  // then span id. Never duration — see above.
  const root = [...candidates].sort((a, b) =>
    (a.observedAt || 0) - (b.observedAt || 0) ||
    String(a.spanId || '').localeCompare(String(b.spanId || ''))
  )[0];

  const service = root.service || root.node;
  const name = root.name;
  if (!service || !name) return null;
  return `${service}::${name}`;
}

function structureOf(hops) {
  // A SET, not an ordered path. Span ordering within one process is an artefact
  // of scheduling and export batching, and treating it as significant would
  // produce deviations that mean nothing.
  return [...new Set(hops.map(h => `${h.service || h.node}::${h.name || ''}`))].sort();
}

/** Per-hop p50/p95, over the observations in which that hop actually appeared. */
function hopStats(values) {
  const byHop = new Map();
  for (const v of values) {
    for (const [k, ms] of Object.entries(v.perHop || {})) {
      if (!byHop.has(k)) byHop.set(k, []);
      byHop.get(k).push(ms);
    }
  }
  const out = {};
  for (const [k, arr] of byHop) {
    const sorted = arr.sort((a, z) => a - z);
    out[k] = { observations: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

class BaselineLearner {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.baselines = new Map();   // key -> { samples[], structures:Map<sig,count>, lastUpdated }
  }

  /**
   * Is this trace healthy enough to learn from?
   *
   * DEGRADED is excluded as well as ERROR. Learning from degraded traffic makes
   * the baseline absorb the very outage it exists to detect: after enough slow
   * requests, "slow" becomes normal and the tool goes quiet at exactly the
   * wrong moment. Caught when a 2,814ms outlier was learned into its own
   * baseline and raised its p95.
   */
  static isHealthy(hops) {
    return hops.length > 0 && !hops.some(h => h.status === 'ERROR' || h.status === 'DEGRADED');
  }

  /**
   * Record an observation. Returns the key used, or null if the trace was not
   * learnable. Unhealthy traces are deliberately not learned from.
   */
  observe(hops, traceId) {
    const key = requestKey(hops);
    if (!key || !BaselineLearner.isHealthy(hops)) {
      // Late conflicting/error evidence invalidates an earlier partial sample.
      if (traceId) for (const baseline of this.baselines.values()) baseline.samples.delete(traceId);
      return null;
    }

    if (!this.baselines.has(key)) {
      this.baselines.set(key, { samples: new Map(), lastUpdated: 0 });
    }
    const b = this.baselines.get(key);
    const total = hops.reduce((s, h) => s + (h.durationMs || 0), 0);

    // Keyed by trace id, so a trace whose spans arrive in several OTLP batches
    // REPLACES its earlier partial observation instead of contributing two
    // samples — one of them a fragment of a request that never existed.
    const id = traceId || `anon-${b.samples.size}`;
    // Per-hop durations as well as the total, so a claim about ONE hop
    // ("this DB call is 90x its normal") has a real number behind it instead
    // of a hardcoded divisor.
    const perHop = {};
    for (const h of hops) {
      const k = `${h.service || h.node}::${h.name || ''}`;
      perHop[k] = (perHop[k] || 0) + (h.durationMs || 0);
    }
    b.samples.set(id, { total, sig: structureOf(hops).join('|'), perHop });
    while (b.samples.size > this.options.maxSamples) {
      b.samples.delete(b.samples.keys().next().value);
    }
    b.lastUpdated = Date.now();
    return key;
  }

  /** The learned baseline for a key, or null when there is not enough evidence. */
  get(key) {
    const b = this.baselines.get(key);
    if (!b || b.samples.size < this.options.minObservations) return null;
    const values = [...b.samples.values()];
    const sorted = values.map(v => v.total).sort((a, z) => a - z);
    const counts = new Map();
    for (const v of values) counts.set(v.sig, (counts.get(v.sig) || 0) + 1);
    let common = null, best = -1;
    for (const [sig, n] of counts) if (n > best) { best = n; common = sig; }
    return {
      key,
      observations: b.samples.size,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      structure: common ? common.split('|') : [],
      structureAgreement: b.samples.size ? best / b.samples.size : 0,
      hops: hopStats(values)
    };
  }

  /**
   * Compare a trace against its own learned baseline.
   *
   * Always returns a verdict of UNKNOWN | HEALTHY | DEVIATION, plus the
   * evidence behind it. UNKNOWN is a real answer and callers must not fold it
   * into either of the others.
   */
  compare(hops) {
    const shape = traceShape(hops || []);
    if (shape.duplicateSpanIds.length) {
      return { verdict: 'UNKNOWN', key: null, baselineSource: 'NONE', deviations: [], shape,
        reason: 'Multiple retained observations share a span ID. Request identity is ambiguous; inspect the investigation conflict evidence before baseline comparison. No sender-side cause is established.' };
    }
    if (shape.rootCount > 1) {
      return {
        verdict: 'UNKNOWN', key: null, baselineSource: 'NONE', deviations: [], shape,
        reason: `this trace id carries ${shape.rootCount} independent request roots across ` +
          `${shape.spanCount} spans — it is a batch, not a request, so no request-level verdict is possible. ` +
          `Every root shares the parent span ${shape.externalParents.join(', ') || '(none)'}, which was never ` +
          `ingested: something in the sender holds an OpenTelemetry context open, so each request is adopted ` +
          `as its child. Fix it at the sender; VITALIS will not guess where one request ends and the next begins.`
      };
    }
    const key = requestKey(hops);
    if (!key) {
      return { verdict: 'UNKNOWN', key: null, baselineSource: 'NONE', deviations: [], shape,
        reason: 'request identity could not be established from these spans, so no baseline applies' };
    }
    const b = this.baselines.get(key);
    const seen = b ? b.samples.size : 0;
    const baseline = this.get(key);

    if (!baseline) {
      return {
        verdict: 'UNKNOWN', key, baselineSource: 'NONE', observations: seen,
        minObservations: this.options.minObservations, deviations: [],
        reason: `no baseline yet for this request — ${seen} of ${this.options.minObservations} healthy observations needed. ` +
                `A request with no baseline is not healthy and not deviating; it is unmeasured.`
      };
    }

    const deviations = [];
    const total = hops.reduce((s, h) => s + (h.durationMs || 0), 0);
    const structure = structureOf(hops);

    const missing = baseline.structure.filter(s => !structure.includes(s));
    const added = structure.filter(s => !baseline.structure.includes(s));
    for (const m of missing) {
      deviations.push({ type: 'STRUCTURE_MISSING', detail: `hop normally present is absent: ${m}`, evidence: `seen in ${Math.round(baseline.structureAgreement * 100)}% of ${baseline.observations} healthy observations` });
    }
    for (const a of added) {
      deviations.push({ type: 'STRUCTURE_ADDED', detail: `hop not seen in the baseline: ${a}`, evidence: `absent from all ${baseline.observations} healthy observations of this request` });
    }

    const threshold = Math.max(baseline.p95 * this.options.latencyFactor, baseline.p95 + this.options.latencyFloorMs);
    if (total > threshold) {
      deviations.push({
        type: 'LATENCY',
        detail: `total ${total}ms exceeds the deviation threshold of ${Math.round(threshold)}ms`,
        evidence: `p50 ${baseline.p50}ms, p95 ${baseline.p95}ms over ${baseline.observations} healthy observations; ` +
                  `threshold = max(p95 x ${this.options.latencyFactor}, p95 + ${this.options.latencyFloorMs}ms)`
      });
    }

    return {
      verdict: deviations.length ? 'DEVIATION' : 'HEALTHY',
      key, baselineSource: 'LEARNED', observations: baseline.observations,
      observedTotalMs: total, deviations, baseline
    };
  }

  /** Rebuild every baseline from persisted traces after a restart. */
  rebuildFrom(tracesMap) {
    let learned = 0;
    for (const [traceId, hops] of tracesMap.entries()) if (this.observe(hops, traceId)) learned++;
    return { tracesConsidered: tracesMap.size, learned, keys: this.baselines.size };
  }

  summary() {
    const out = [];
    for (const key of this.baselines.keys()) {
      const b = this.baselines.get(key);
      const ready = this.get(key);
      out.push({ key, observations: b.samples.size, ready: !!ready, p95: ready ? ready.p95 : null });
    }
    return out.sort((a, z) => z.observations - a.observations);
  }
}

module.exports = { BaselineLearner, requestKey, structureOf, hopStats, traceShape, DEFAULTS };
