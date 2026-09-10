'use strict';
const path = require('node:path');
const journal = require('./trace_journal');
const { command, evolve, hash, fail } = require('../cases/case_contract');
class CaseRepository {
  constructor(policy) { this.policy = policy; this.state = { schemaVersion: 1, cases: {} }; }
  load() { this.state = this.policy.scan().cases; }
  get(id) { const item = this.state.cases[id]; if (!item) fail('CASE_NOT_FOUND', 'Case not found', 404); return structuredClone(item); }
  list({ offset, limit, traceId }) {
    const items = Object.values(this.state.cases).filter(c => !traceId || c.evidence.some(e => e.traceId === traceId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null,
      items: items.slice(offset, offset + limit).map(c => ({ id: c.id, title: c.title, state: c.state, revision: c.revision, updatedAt: c.updatedAt,
        traceIds: [...new Set(c.evidence.map(e => e.traceId))], decisions: c.history.length, evidenceSnapshots: c.evidence.length })) };
  }
  execute(input, id, resolveEvidence) {
    const cmd = command(input, !id), caseId = id || cmd.operationId;
    this.policy.requireWritable();
    const previous = this.state.cases[caseId];
    if (id && !previous) fail('CASE_NOT_FOUND', 'Case not found', 404);
    const retry = previous?.history.find(event => event.operationId === cmd.operationId);
    if (retry) {
      if (retry.requestHash !== hash(cmd)) fail('CASE_OPERATION_CONFLICT', 'Operation ID already used for a different command', 409);
      return { case: structuredClone(previous), duplicate: true };
    }
    if (!id && previous) fail('CASE_OPERATION_CONFLICT', 'Case ID already exists', 409);
    if (id && cmd.expectedRevision !== previous.revision) fail('CASE_REVISION_CONFLICT', 'Case changed; refresh and review before resubmitting your decision', 409);
    const evidence = cmd.traceId ? resolveEvidence(cmd.traceId, cmd.investigationRevision) : null;
    const next = evolve(previous, cmd, evidence);
    const candidate = { schemaVersion: 1, cases: { ...this.state.cases, [caseId]: next } };
    candidate.checksum = hash(candidate);
    this.policy.admitCases(candidate);
    try { journal.writeSnapshot(path.join(this.policy.directory, 'cases.json'), candidate); }
    catch (cause) { const error = Error('Case decision could not be durably saved'); error.code = 'EVIDENCE_WRITE_FAILED'; error.cause = cause; throw error; }
    this.state = candidate;
    return { case: structuredClone(next), duplicate: false };
  }
}
module.exports = { CaseRepository };
