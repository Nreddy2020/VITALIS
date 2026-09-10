'use strict';
// Pure read model. No adapters, persistence, app names, commands or side effects.
const crypto = require('node:crypto');
const { observationKey } = require('../storage/observation_identity');
const VERSION = '1.1.0';
const MAX_SPANS = 1000;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const validId = (v, length) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(v) && !/^0+$/.test(v);
function nano(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  if (!['string', 'number'].includes(typeof value) || !/^[0-9]{1,20}$/.test(String(value))) return undefined;
  const n = BigInt(value);
  return n > 0n && n <= 18446744073709551615n ? String(n) : undefined;
}
function timing(span) {
  const start = nano(span.startTimeUnixNano), end = nano(span.endTimeUnixNano);
  if (!start || !end || BigInt(end) < BigInt(start)) return null;
  const delta = BigInt(end) - BigInt(start);
  if (delta > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(delta) / 1e6;
}
function normalized(h) {
  return {
    spanId: h.spanId, parentSpanId: h.parentSpanId || null, kind: h.kind,
    service: h.service, name: h.name, startTimeUnixNano: h.startTimeUnixNano,
    endTimeUnixNano: h.endTimeUnixNano, otelStatusCode: h.otelStatusCode,
    serviceVersion: h.serviceVersion, artifactDigest: h.artifactDigest,
    deploymentEnvironment: h.deploymentEnvironment,
    attributes: [...(Array.isArray(h.attributes) ? h.attributes : [])].sort((a, b) => canonical(a).localeCompare(canonical(b)))
  };
}
function httpStatus(h) {
  const values = (h.attributes || []).filter(a => ['http.response.status_code', 'http.status_code'].includes(a.key))
    .map(a => a.value?.intValue);
  if (!values.length) return { value: null, conflict: false };
  const parsed = values.map(v => typeof v === 'number' ? v : typeof v === 'string' && /^\d{3}$/.test(v) ? Number(v) : NaN);
  const valid = parsed.every(v => Number.isInteger(v) && v >= 100 && v <= 599);
  return valid && new Set(parsed).size === 1 ? { value: parsed[0], conflict: false } : { value: null, conflict: true };
}
const procedures = {
  TRACE_IDENTITY: ['Recover the request identity', 'Collect the missing parent/root spans or resolve conflicting same-ID observations.', 'One nonconflicting root and exact parent links; no inferred edges.'],
  TIMING: ['Collect original span timestamps', 'Export start and end timestamps at the sender; do not replace them with ingest time.', 'Valid timestamps on each cited span; root duration derived only from its own interval.'],
  OUTCOME: ['Establish the observed response', 'Inspect root HTTP status or explicit span status; collect missing or contradictory outcome evidence.', 'A nonconflicting root response signal, separately from business acceptance.'],
  PEER: ['Collect the missing peer evidence', 'Check export and propagation for the cited client/expected boundary using the existing monitoring system.', 'A matching remote SERVER parent link, or an attributed explanation of the visibility limit.'],
  DEPLOYMENT: ['Identify the running deployment', 'Obtain the running artifact digest and attributed exact package inventory from the deployment system.', 'Consistent digest-bound inventory; a version label alone does not establish identity.'],
  EXPECTATIONS: ['Describe the expected journey', 'Register attributed expected interactions for this journey and its environment.', 'Expected boundaries can be compared with observations without creating synthetic edges.'],
  COMPATIBILITY: ['Review compatibility coverage', 'Inspect available reviewed rules and their exact package scope; obtain missing source evidence.', 'A sourced rule and applicable identity evidence, or an explicit uncovered boundary.'],
  BUSINESS: ['Verify the functional result', 'Define and observe the business acceptance condition without capturing sensitive response payloads.', 'A journey-specific functional assertion; HTTP success alone is insufficient.'],
  LIMIT: ['Narrow the evidence set', 'Inspect why this trace exceeds the analysis bound; repair batching or use a supported bounded analysis.', 'A bounded trace without discarded evidence or an explicitly documented partial analysis.'],
  SIGNAL: ['Inspect the observed error', 'Follow the referenced error span in the request tree and inspect its sanitized diagnostics.', 'Supporting and contradicting evidence recorded; the error location is not assumed to be the cause.']
};
function buildInvestigation({ traceId, hops = [], compatibility = null }) {
  const gaps = [];
  const add = (code, kind, reason, refs = []) => gaps.push({ id: code, kind, reason, spanIds: refs.slice(0, 20), referenceCount: refs.length });
  const overLimit = hops.length > MAX_SPANS;
  const raw = overLimit ? [] : hops.map(normalized);
  const byId = new Map(), identities = new Map(), conflicts = new Set();
  let duplicates = 0;
  for (const [index, h] of raw.entries()) {
    const identity = observationKey(hops[index]);
    if (byId.has(h.spanId)) {
      if (identities.get(h.spanId) === identity) duplicates++;
      else conflicts.add(h.spanId);
    } else { byId.set(h.spanId, h); identities.set(h.spanId, identity); }
  }
  const spans = [...byId.values()].sort((a, b) => String(a.spanId).localeCompare(String(b.spanId)));
  const roots = spans.filter(h => !h.parentSpanId);
  const reasons = [];
  if (overLimit) { reasons.push('Analysis span limit exceeded'); add('LIMIT', 'CAPABILITY', `Trace has ${hops.length} observations; maximum is ${MAX_SPANS}. No partial request conclusion is produced.`); }
  if (!validId(traceId, 32)) reasons.push('Invalid trace ID');
  if (roots.length !== 1) reasons.push(`Expected one root; observed ${roots.length}`);
  if (conflicts.size) reasons.push('Conflicting observations share a span ID');
  for (const h of spans) {
    if (!validId(h.spanId, 16)) reasons.push('Invalid span ID');
    if (h.parentSpanId && (!validId(h.parentSpanId, 16) || !byId.has(h.parentSpanId))) reasons.push('Missing or invalid parent');
    const seen = new Set(); let current = h;
    while (current) {
      if (seen.has(current.spanId)) { reasons.push('Cycle in parent links'); break; }
      seen.add(current.spanId); current = byId.get(current.parentSpanId);
    }
  }
  const shape = { state: reasons.length ? 'UNKNOWN' : 'OBSERVED_TREE', reasons: [...new Set(reasons)], duplicatesCollapsed: duplicates, conflicts: [...conflicts].sort() };
  if (reasons.length) add('TRACE_IDENTITY', 'DATA', shape.reasons.join('; '), [...conflicts]);
  const root = shape.state === 'OBSERVED_TREE' ? roots[0] : null;
  const missingTiming = spans.filter(h => timing(h) === null).map(h => h.spanId);
  if (missingTiming.length) add('TIMING', 'DATA', 'Original valid start/end timestamps are missing. Legacy duration defaults are not evidence.', missingTiming);
  const duration = root ? timing(root) : null;
  const rootTiming = { valueMs: duration, provenance: duration === null ? 'UNKNOWN' : 'OBSERVED', spanId: root?.spanId || null,
    basis: 'Root span end minus start; not summed span time, critical path or proof of complete capture.' };
  const http = root ? httpStatus(root) : { value: null, conflict: false };
  const code = root?.otelStatusCode;
  const conflict = http.conflict || (http.value !== null && ((code === 2 && http.value < 400) || (code === 1 && http.value >= 400)));
  let state = 'UNKNOWN';
  if (root && !conflict) {
    state = http.value !== null ? http.value >= 500 ? 'HTTP_SERVER_ERROR' : http.value >= 400 ? 'HTTP_CLIENT_ERROR' : 'HTTP_RESPONSE_OBSERVED'
      : code === 2 ? 'SPAN_ERROR_REPORTED' : code === 1 ? 'SPAN_OK_REPORTED' : 'UNKNOWN';
  }
  const outcome = { state, provenance: state === 'UNKNOWN' ? 'UNKNOWN' : 'OBSERVED', spanId: root?.spanId || null,
    httpStatusCode: http.value, otelStatusCode: code ?? null, businessResult: 'UNKNOWN', conflict };
  if (state === 'UNKNOWN') add('OUTCOME', 'DATA', conflict ? 'Outcome attributes conflict; inspect original observations.' : 'No unambiguous root outcome is reported.', root ? [root.spanId] : []);
  const signals = spans.filter(h => !conflicts.has(h.spanId)).flatMap(h => {
    const status = httpStatus(h);
    return h.otelStatusCode === 2 || status.value >= 400
      ? [{ code: h.otelStatusCode === 2 ? 'SPAN_ERROR_REPORTED' : 'HTTP_ERROR_RESPONSE', provenance: 'OBSERVED', spanId: h.spanId,
        service: h.service, operation: h.name, httpStatusCode: status.value, causalClaim: 'NONE' }] : [];
  });
  if (!compatibility || compatibility.error) add('COMPATIBILITY', 'CAPABILITY', 'Compatibility analysis is unavailable or configuration is invalid; no clean result is inferred.');
  else {
    const peers = (compatibility.unchecked || []).map(u => u.spanId);
    const expectedMissing = (compatibility.expectedCoverage || []).filter(e => e.state !== 'OBSERVED_BOUNDARY');
    if (peers.length || expectedMissing.length) add('PEER', 'DATA', `${peers.length} observed client gaps; ${expectedMissing.length} declared interactions remain unobserved.`, peers);
    if (!(compatibility.expectedCoverage || []).length) add('EXPECTATIONS', 'DATA', 'No attributed expected-interaction inventory is available; completeness cannot be measured.');
    if ((compatibility.deployments || []).some(d => d.state !== 'CORRELATED')) add('DEPLOYMENT', 'DATA', 'Running artifact/package identity is not consistently bound to inventory.');
    if (compatibility.status === 'UNKNOWN') add('COMPATIBILITY', 'DATA', 'Compatibility is not established for this request; inspect boundary-specific rules and evidence.');
  }
  add('BUSINESS', 'CAPABILITY', 'No journey-specific functional acceptance contract is evaluated by this version.');
  const stepKeys = [...(signals.length ? ['SIGNAL'] : []), ...gaps.map(g => g.id)];
  const nextSteps = [...new Set(stepKeys)].map((key, index) => ({ order: index + 1, id: key, provenance: 'RECOMMENDED', mode: 'READ_ONLY',
    title: procedures[key][0], instruction: procedures[key][1], validation: procedures[key][2], gapIds: key === 'SIGNAL' ? [] : [key],
    spanIds: key === 'SIGNAL' ? signals.map(s => s.spanId).slice(0, 20) : gaps.find(g => g.id === key).spanIds }));
  const c = compatibility && { status: compatibility.status, ruleSetHash: compatibility.ruleSetHash, evidenceContext: compatibility.evidenceContext,
    error: compatibility.error, expectedCoverage: compatibility.expectedCoverage, relationships: compatibility.relationships,
    deployments: (compatibility.deployments || []).map(({ observedAt, ...d }) => d) };
  return { schemaVersion: 1, engineVersion: VERSION, traceId,
    revision: hash({ version: VERSION, traceId, observations: overLimit ? [] : hops.map(observationKey).sort(), count: hops.length, compatibility: c }),
    evidenceContext: compatibility?.evidenceContext || 'UNKNOWN — source environment and capture mode not established',
    shape, outcome, timing: rootTiming, signals, gaps, nextSteps,
    triage: signals.length ? 'ERROR_OBSERVED' : gaps.length ? 'EVIDENCE_NEEDED' : 'REVIEW',
    operation: root ? { service: root.service, name: root.name, spanId: root.spanId } : null,
    coverage: { observationsReceived: hops.length, uniqueSpans: overLimit ? null : spans.length, completeCapture: 'UNKNOWN', productionImpact: 'UNKNOWN' },
    execution: { enabled: false, state: 'NOT_REQUESTED' },
    limitation: 'Observed retained evidence only. No verified business outcome, population impact, causal diagnosis or repair execution.' };
}
module.exports = { buildInvestigation, nano, MAX_SPANS };
