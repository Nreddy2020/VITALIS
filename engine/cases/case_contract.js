'use strict';
const crypto = require('node:crypto');
const { PrivacySanitizer } = require('../privacy_sanitizer');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = ['OPEN', 'INVESTIGATING', 'BLOCKED'];
const KINDS = ['DATA', 'CAPABILITY', 'PERMISSION', 'EXPERTISE'];
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function fail(code, message, status = 400) { const error = Error(message); error.code = code; error.httpStatus = status; throw error; }
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('CASE_INVALID_INPUT', `${label} must be 1-${max} characters`);
  return PrivacySanitizer.sanitizeText(value.trim());
}
function command(input, create = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('CASE_INVALID_INPUT', 'A case command object is required');
  const allowed = create ? ['operationId', 'title', 'actorLabel', 'note', 'traceId', 'investigationRevision']
    : ['operationId', 'expectedRevision', 'actorLabel', 'note', 'action', 'state', 'blockerKind', 'traceId', 'investigationRevision'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('CASE_INVALID_INPUT', 'Unsupported case command field');
  if (!UUID.test(input.operationId)) fail('CASE_INVALID_INPUT', 'operationId must be a lowercase UUID');
  const out = { operationId: input.operationId, actorLabel: text(input.actorLabel, 'Operator label', 100), note: text(input.note, 'Decision note', 2000) };
  if (create) { out.action = 'CREATE'; out.title = text(input.title, 'Title', 200); }
  else {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('CASE_INVALID_INPUT', 'expectedRevision must be a positive integer');
    out.expectedRevision = input.expectedRevision;
    if (!['NOTE', 'SET_STATE', 'ATTACH_EVIDENCE'].includes(input.action)) fail('CASE_TRANSITION_UNAVAILABLE', 'Only notes, investigation state and evidence attachment are enabled', 422);
    out.action = input.action;
    if (input.action === 'SET_STATE') {
      if (!STATES.includes(input.state)) fail('CASE_TRANSITION_UNAVAILABLE', 'Verified recovery and approval/execution states are unavailable', 422);
      out.state = input.state;
      if (input.state === 'BLOCKED') {
        if (!KINDS.includes(input.blockerKind)) fail('CASE_INVALID_INPUT', 'A blocker kind is required'); out.blockerKind = input.blockerKind;
      } else if (input.blockerKind !== undefined) fail('CASE_INVALID_INPUT', 'Only BLOCKED can declare a blocker');
    } else if (input.state !== undefined || input.blockerKind !== undefined) fail('CASE_INVALID_INPUT', 'State fields require SET_STATE');
  }
  if (create || out.action === 'ATTACH_EVIDENCE') {
    if (typeof input.traceId !== 'string' || !input.traceId || input.traceId.length > 128 || !HASH.test(input.investigationRevision)) fail('CASE_INVALID_INPUT', 'A bounded trace ID and exact investigation revision are required');
    out.traceId = input.traceId; out.investigationRevision = input.investigationRevision;
  } else if (input.traceId !== undefined || input.investigationRevision !== undefined) fail('CASE_INVALID_INPUT', 'Evidence fields require ATTACH_EVIDENCE');
  return out;
}
function snapshot(traceId, spans, report) {
  if (!Array.isArray(spans) || !spans.length || spans.length > 1000 || report.traceId !== traceId || !HASH.test(report.revision)) fail('CASE_EVIDENCE_UNAVAILABLE', 'A bounded retained request investigation is required', 422);
  const evidence = { traceId, investigationRevision: report.revision, spans: structuredClone(spans), investigation: structuredClone(report) };
  return { ...evidence, id: hash(evidence), capturedAt: new Date().toISOString() };
}
function evolve(previous, cmd, evidence, now = new Date().toISOString()) {
  const next = previous ? structuredClone(previous) : { schemaVersion: 1, id: cmd.operationId, title: cmd.title, createdAt: now, state: 'OPEN', revision: 0, evidence: [], history: [] };
  if (cmd.action === 'SET_STATE') {
    const transitions = { OPEN: ['INVESTIGATING', 'BLOCKED'], INVESTIGATING: ['BLOCKED'], BLOCKED: ['INVESTIGATING'] };
    if (!transitions[next.state].includes(cmd.state)) fail('CASE_TRANSITION_UNAVAILABLE', `Transition ${next.state} to ${cmd.state} is unavailable`, 422);
    next.state = cmd.state;
  }
  if (evidence && !next.evidence.some(item => item.id === evidence.id)) next.evidence.push(evidence);
  next.revision++; next.updatedAt = now;
  next.history.push({ revision: next.revision, operationId: cmd.operationId, requestHash: hash(cmd), action: cmd.action,
    state: next.state, at: now, actor: { label: cmd.actorLabel, provenance: 'OPERATOR_DECLARED' }, note: cmd.note,
    ...(cmd.blockerKind ? { blockerKind: cmd.blockerKind } : {}), ...(evidence ? { evidenceId: evidence.id } : {}) });
  return next;
}
function validStore(store) {
  if (!store || store.schemaVersion !== 1 || !store.cases || typeof store.cases !== 'object' || Array.isArray(store.cases)) return false;
  if (store.checksum !== hash({ schemaVersion: store.schemaVersion, cases: store.cases })) return false;
  return Object.entries(store.cases).every(([id, item]) => {
    if (!UUID.test(id) || !item || item.id !== id || item.schemaVersion !== 1 || !STATES.includes(item.state) ||
      typeof item.title !== 'string' || !item.title || item.title.length > 200 || !Array.isArray(item.history) || !item.history.length ||
      item.revision !== item.history.length || !Array.isArray(item.evidence) || !item.evidence.length) return false;
    const ids = new Set();
    if (!item.evidence.every(e => {
      if (!e || typeof e.traceId !== 'string' || !Array.isArray(e.spans) || !e.spans.length || e.spans.length > 1000 ||
        !e.investigation || e.investigation.traceId !== e.traceId || e.investigation.revision !== e.investigationRevision || !HASH.test(e.investigationRevision)) return false;
      if (hash({ traceId: e.traceId, investigationRevision: e.investigationRevision, spans: e.spans, investigation: e.investigation }) !== e.id || ids.has(e.id)) return false;
      ids.add(e.id); return true;
    })) return false;
    const operations = new Set();
    return item.history.every((event, index) => {
      if (!event || event.revision !== index + 1 || !UUID.test(event.operationId) || operations.has(event.operationId) || !HASH.test(event.requestHash) ||
        !STATES.includes(event.state) || !['CREATE', 'NOTE', 'SET_STATE', 'ATTACH_EVIDENCE'].includes(event.action) ||
        typeof event.note !== 'string' || !event.note || event.note.length > 2000 || !event.actor || event.actor.provenance !== 'OPERATOR_DECLARED' ||
        typeof event.actor.label !== 'string' || !event.actor.label || event.actor.label.length > 100 || (event.evidenceId && !ids.has(event.evidenceId))) return false;
      operations.add(event.operationId); return true;
    }) && item.history[0].action === 'CREATE' && item.history.at(-1).state === item.state;
  });
}
module.exports = { UUID, command, snapshot, evolve, validStore, hash, fail };
