'use strict';
// Read-only, bounded client -> server evaluation. No edge from co-presence.
const crypto = require('crypto');
const fs = require('fs');
const { evaluate, parseVersion, OPERATORS } = require('./version_ops');
const defaultRules = require('./relationship_rules.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const exact = value => typeof value === 'string' && /^\d+(\.\d+)*$/.test(value) && parseVersion(value)?.segments.every(Number.isSafeInteger);
const client = h => h.kind === 3 || h.kind === 'SPAN_KIND_CLIENT';
const server = h => h.kind === 2 || h.kind === 'SPAN_KIND_SERVER';
const attr = (h, key) => {
  const a = (h.attributes || []).filter(a => a.key === key);
  return a.length === 1 ? a[0].value?.stringValue : undefined;
};
function validateRules(rules) {
  if (!Array.isArray(rules)) throw Error('Relationship rules must be an array');
  const ids = new Set();
  for (const r of rules) {
    if (!r.id || ids.has(r.id) || !r.fromPackage || !r.toPackage || !r.claim ||
        !Array.isArray(r.fromVersion) || !r.fromVersion.length ||
        ![...r.fromVersion, r.constraint].every(c => c && OPERATORS.includes(c.op) && c.value !== undefined) ||
        !/^https:\/\//.test(r.source?.url || '') || !r.source?.section ||
        !Number.isFinite(Date.parse(r.source?.recordedAt)) || !Number.isFinite(Date.parse(r.source?.reviewBy)) ||
        Date.parse(r.source.reviewBy) < Date.parse(r.source.recordedAt)) throw Error('Invalid or unsourced relationship rule');
    new URL(r.source.url);
    ids.add(r.id);
  }
  return rules;
}
function shape(hops) {
  const reasons = [];
  const ids = new Map();
  for (const h of hops) {
    if (!/^[a-f0-9]{16}$/.test(h.spanId || '') || /^0+$/.test(h.spanId || '') || ids.has(h.spanId)) reasons.push('Invalid, missing or duplicate span ID');
    if (h.timingValid !== true) reasons.push('Missing or invalid span start/end timestamps');
    ids.set(h.spanId, h);
  }
  const roots = hops.filter(h => !h.parentSpanId);
  if (roots.length !== 1) reasons.push(`Expected one root; observed ${roots.length}`);
  for (const h of hops) {
    if (h.parentSpanId && !ids.has(h.parentSpanId)) reasons.push(`Missing parent ${h.parentSpanId}`);
    const seen = new Set();
    let current = h;
    while (current) {
      if (seen.has(current.spanId)) { reasons.push('Cycle in parent links'); break; }
      seen.add(current.spanId);
      current = ids.get(current.parentSpanId);
    }
  }
  return { state: reasons.length ? 'UNKNOWN' : 'OBSERVED_TREE', reasons: [...new Set(reasons)], roots: roots.map(h => h.spanId) };
}
function deployment(h, inventories) {
  const matches = inventories.filter(i => i.service === h.service && i.artifactDigest === h.artifactDigest);
  let reason;
  const i = matches[0];
  if (!digest(h.artifactDigest)) reason = 'Missing or invalid deployed SHA-256 artifact digest';
  else if (matches.length !== 1) reason = 'No unique inventory for this service and deployed digest';
  else if (!i.declaredBy || !i.evidence || !Array.isArray(i.packages)) reason = 'Inventory lacks attribution, evidence reference, or packages';
  else if (!h.serviceVersion || !i.declaredVersion) reason = 'Missing reported or declared service version';
  else if (h.serviceVersion !== i.declaredVersion) reason = 'Reported service version disagrees with digest-bound inventory';
  return {
    spanId: h.spanId, parentSpanId: h.parentSpanId, kind: h.kind, operation: h.name, observedAt: h.observedAt, service: h.service,
    deployed: { version: h.serviceVersion, artifactDigest: h.artifactDigest, provenance: 'OBSERVED', basis: 'Sender-reported resource attributes; not independently attested' },
    declared: i ? { version: i.declaredVersion, declaredBy: i.declaredBy, evidence: i.evidence } : null,
    resolved: i?.packages || [],
    inventoryHash: i ? hash(i) : null,
    state: reason ? 'UNKNOWN' : 'CORRELATED',
    reason: reason || 'Exact digest joined to attributed inventory; collector and inventory are trusted inputs, not cryptographic attestation'
  };
}
function analyseRelationships(trace, inventories = [], rules = defaultRules, now = new Date(), expectedInteractions = []) {
  validateRules(rules);
  if (!Array.isArray(inventories)) throw Error('Inventories must be an array');
  const hops = Array.isArray(trace?.hops) ? trace.hops : [];
  const traceShape = shape(hops);
  if (!/^[a-f0-9]{32}$/.test(trace?.traceId || '') || /^0+$/.test(trace?.traceId || '')) {
    traceShape.state = 'UNKNOWN'; traceShape.reasons.push('Invalid or absent trace ID');
  }
  const deployments = hops.map(h => deployment(h, inventories));
  const byId = new Map(hops.map((h, i) => [h.spanId, { h, d: deployments[i] }]));
  const relationships = [];
  const unchecked = [];
  for (const h of hops) {
    const parent = byId.get(h.parentSpanId);
    if (parent && parent.h.service !== h.service && !(client(parent.h) && server(h))) {
      unchecked.push({ spanId: h.spanId, reason: 'Cross-service parent link lacks CLIENT -> SERVER kinds; interaction not evaluated' });
    }
    if (!client(h)) continue;
    const targets = hops.filter(t => t.parentSpanId === h.spanId && server(t) && t.service !== h.service);
    if (targets.length !== 1) {
      unchecked.push({ spanId: h.spanId, reason: 'Client span has no unique remote SERVER child; peer identity and compatibility UNKNOWN' });
      continue;
    }
    const t = targets[0];
    const from = byId.get(h.spanId).d, to = byId.get(t.spanId).d;
    const edge = { from: h.service, to: t.service, clientSpanId: h.spanId, serverSpanId: t.spanId,
      observed: 'SERVER parentSpanId equals CLIENT spanId, across distinct services', provenance: 'OBSERVED',
      status: 'UNKNOWN', findings: [], causalClaim: 'NONE: a prerequisite violation is not proof of the cause of this request outcome' };
    const candidates = rules.filter(r => from.resolved.some(p => p.name === r.fromPackage) && to.resolved.some(p => p.name === r.toPackage));
    for (const r of candidates) {
      const a = from.resolved.filter(p => p.name === r.fromPackage);
      const b = to.resolved.filter(p => p.name === r.toPackage);
      const missing = [];
      if (attr(h, 'vitalis.client.package') !== r.fromPackage) missing.push('Observe which client package made this call; installed inventory alone does not prove use');
      if (traceShape.state !== 'OBSERVED_TREE') missing.push('Repair missing, duplicate, cyclic or multiple-root trace evidence');
      if (from.state !== 'CORRELATED' || to.state !== 'CORRELATED') missing.push('Supply consistent digest-bound deployment inventories on both endpoints');
      if (a.length !== 1 || b.length !== 1 || !exact(a[0]?.resolved) || !exact(b[0]?.resolved)) missing.push('Supply unique exact resolved package versions; declarations are not installed evidence');
      const scope = a.length === 1 && exact(a[0]?.resolved) ? r.fromVersion.map(c => evaluate(c, a[0].resolved).result) : ['UNKNOWN'];
      if (scope.includes('VIOLATED')) continue;
      if (scope.includes('UNKNOWN')) missing.push('Source version rule applicability is unknown');
      if (!Number.isFinite(+now) || +now < Date.parse(r.source.recordedAt) || +now > Date.parse(r.source.reviewBy) + 86400000 - 1) missing.push('Review stale or future-dated rule against its vendor source');
      const conditions = Object.entries(r.when || {});
      if (conditions.some(([k, v]) => attr(h, k) !== undefined && attr(h, k) !== v)) continue;
      if (conditions.some(([k]) => attr(h, k) === undefined)) missing.push('Observe the connection setting used by this client span');
      const result = missing.length ? { result: 'UNKNOWN', reason: missing.join('; ') } : evaluate(r.constraint, b[0].resolved);
      edge.findings.push({ ruleId: r.id, claim: r.claim, source: r.source, status: result.result,
        provenance: result.result === 'UNKNOWN' ? 'UNKNOWN' : 'INFERRED', reason: result.reason,
        versions: { from: a, to: b }, conditions: Object.fromEntries(conditions.map(([k]) => [k, attr(h, k) ?? null])),
        wouldChangeVerdict: missing.length ? missing : ['A corrected deployment inventory, interaction observation, or revised vendor prerequisite would trigger re-evaluation'] });
    }
    edge.status = edge.findings.some(f => f.status === 'VIOLATED') ? 'VIOLATED'
      : edge.findings.length && edge.findings.every(f => f.status === 'SATISFIED') ? 'CHECKED_PREREQUISITES' : 'UNKNOWN';
    if (!edge.findings.length) edge.reason = 'No applicable sourced rule for this observed boundary; add a reviewed rule and exact inventory evidence';
    relationships.push(edge);
  }
  if (!Array.isArray(expectedInteractions)) throw Error('Expected interactions must be an array');
  const expectedCoverage = expectedInteractions.map(e => ({ ...e, provenance: 'DECLARED',
    state: e.declaredBy && e.evidence && relationships.some(r => r.from === e.from && r.to === e.to) ? 'OBSERVED_BOUNDARY' : 'UNKNOWN',
    reason: !e.declaredBy || !e.evidence ? 'Expected interaction lacks attribution or evidence reference' : 'Expectation does not create an edge or establish compatibility' }));
  return { schemaVersion: 1, traceId: trace?.traceId, evaluatedAt: now.toISOString(), inputHash: hash({ trace, inventories, rules, expectedInteractions }),
    ruleSetHash: hash(rules), fixture: trace?.fixture === true || inventories.some(i => i.fixture === true), traceShape, deployments, relationships, unchecked, expectedCoverage,
    status: traceShape.state !== 'OBSERVED_TREE' ? 'UNKNOWN' : relationships.some(r => r.status === 'VIOLATED') ? 'VIOLATED' : 'UNKNOWN',
    coverage: { observedBoundaries: relationships.length, checkedBoundaries: relationships.filter(r => r.status !== 'UNKNOWN').length,
      unknownBoundaries: relationships.filter(r => r.status === 'UNKNOWN').length, uncheckedInteractions: unchecked.length },
    limitation: 'Only observed CLIENT -> SERVER boundaries and listed prerequisites are evaluated. Missing spans, async links, uninstrumented peers, unlisted rules and runtime behavior remain UNKNOWN. No whole-request compatibility or causal assurance.' };
}
function configuredReport(trace) {
  try {
    const config = process.env.VITALIS_BUILD_INVENTORY ? JSON.parse(fs.readFileSync(process.env.VITALIS_BUILD_INVENTORY, 'utf8')) : [];
    const report = analyseRelationships(trace, Array.isArray(config) ? config : config.builds, defaultRules, new Date(), config.expectedInteractions || []);
    report.evidenceContext = config.evidenceContext || 'Telemetry origin is not independently verified by this report';
    return report;
  } catch (e) { return { status: 'UNKNOWN', error: `Compatibility evidence unavailable: ${e.message}` }; }
}
module.exports = { analyseRelationships, configuredReport, validateRules, shape };
