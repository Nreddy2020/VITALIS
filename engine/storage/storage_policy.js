'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const journal = require('./trace_journal');
const { validStore } = require('../cases/case_contract');
const MB = 1024 * 1024;
function positive(env, name, fallback) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`${name} must be a positive safe integer`);
  return value;
}
class StoragePolicy {
  constructor(directory, env = process.env) {
    this.directory = path.resolve(directory);
    this.limits = {
      traces: positive(env, 'VITALIS_MAX_TRACES', 10000), spans: positive(env, 'VITALIS_MAX_SPANS', 100000),
      traceBytes: positive(env, 'VITALIS_MAX_TRACE_BYTES', 32 * MB), journalBytes: positive(env, 'VITALIS_MAX_JOURNAL_BYTES', 16 * MB),
      diskBytes: positive(env, 'VITALIS_MAX_STORAGE_BYTES', 128 * MB), auxiliaryBytes: positive(env, 'VITALIS_MAX_AUX_BYTES', 8 * MB),
      auxiliaryRecords: positive(env, 'VITALIS_MAX_AUX_RECORDS', 10000), retentionMs: positive(env, 'VITALIS_RETENTION_MS', 30 * 86400000),
      cases: positive(env, 'VITALIS_MAX_CASES', 1000), caseBytes: positive(env, 'VITALIS_MAX_CASE_BYTES', 8 * MB),
      caseEvents: positive(env, 'VITALIS_MAX_CASE_EVENTS', 200), caseEvidence: positive(env, 'VITALIS_MAX_CASE_EVIDENCE', 20)
    };
    this.issues = []; this.issueCount = 0; this.rejections = 0; this.lastRejection = null; this.lock = null;
  }
  acquire() {
    if (this.lock) return;
    fs.mkdirSync(this.directory, { recursive: true });
    let db;
    try {
      const { DatabaseSync } = require('node:sqlite');
      // Hold a real OS-mediated SQLite writer lock. No PID guessing or lock-file deletion.
      db = new DatabaseSync(path.join(this.directory, 'writer-lock.sqlite'), { timeout: 0 });
      db.exec('BEGIN IMMEDIATE'); this.lock = db;
    } catch (cause) {
      if (db) db.close();
      const e = Error('Cannot acquire exclusive storage writer lock; another writer or unavailable lock runtime must be resolved');
      e.code = 'STORAGE_WRITER_LOCKED'; e.cause = cause; throw e;
    }
  }
  release() {
    if (!this.lock) return;
    try { this.lock.exec('ROLLBACK'); } finally { this.lock.close(); this.lock = null; }
  }
  reject(code, limit, current, proposed) {
    this.rejections++;
    this.lastRejection = { code, limit, current, proposed, at: new Date().toISOString() };
    const error = Error(code === 'STORAGE_RECOVERY_REQUIRED' ? 'Evidence files require recovery review; mutations are blocked' : `Storage limit exceeded: ${limit}`);
    error.code = code; error.details = this.lastRejection; throw error;
  }
  issue(code, file, details = {}) {
    if (this.issues.length < 30) this.issues.push({ code, file, ...details });
    this.issueCount++;
  }
  readFile(name, limit) {
    const file = path.join(this.directory, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) { this.issue('NOT_REGULAR_FILE', name); return null; }
      if (stat.size > limit) { this.issue('FILE_LIMIT_EXCEEDED', name, { bytes: stat.size, limit }); return null; }
      return fs.readFileSync(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') this.issue('FILE_READ_FAILED', name); return null; }
  }
  scan() {
    this.issues = []; this.issueCount = 0;
    if (journal.requiresRecovery(path.join(this.directory, 'ingest-journal.ndjson'))) this.issue('JOURNAL_ROLLBACK_UNVERIFIED', 'ingest-journal.ndjson');
    let snapshot = {}, correlation = {};
    const entries = [];
    const raw = this.readFile('traces.json', this.limits.traceBytes);
    if (raw !== null) {
      try {
        snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
          !Object.values(snapshot).every(h => Array.isArray(h) && h.every(s => s && typeof s === 'object' && typeof s.spanId === 'string'))) throw Error('Bad snapshot shape');
      } catch (_) { snapshot = {}; this.issue('CORRUPT_SNAPSHOT', 'traces.json'); }
    }
    const journalText = this.readFile('ingest-journal.ndjson', this.limits.journalBytes);
    if (journalText !== null) {
      const lines = journalText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try { entries.push(...journal.decodeLine(lines[i])); }
        catch (_) {
          this.issue(i === lines.length - 1 ? 'TORN_JOURNAL_TAIL' : 'CORRUPT_JOURNAL_FRAME', 'ingest-journal.ndjson', {
            line: i + 1, sha256: crypto.createHash('sha256').update(lines[i]).digest('hex') });
        }
      }
    }
    const correlationText = this.readFile('correlation-state.json', this.limits.auxiliaryBytes);
    if (correlationText !== null) {
      try {
        correlation = JSON.parse(correlationText);
        if (!correlation || typeof correlation !== 'object' || Array.isArray(correlation)) throw Error('Bad state');
        if (correlation.change && (!Array.isArray(correlation.change.changeEvents || []) || typeof correlation.change !== 'object')) throw Error('Bad change state');
        if (correlation.vulnerability && (!Array.isArray(correlation.vulnerability.inventories || []) || !Array.isArray(correlation.vulnerability.advisories || []) || typeof correlation.vulnerability !== 'object')) throw Error('Bad inventory state');
      } catch (_) { correlation = {}; this.issue('CORRUPT_CORRELATION_STATE', 'correlation-state.json'); }
    }
    let cases = { schemaVersion: 1, cases: {} };
    const caseText = this.readFile('cases.json', this.limits.caseBytes);
    if (caseText !== null) {
      try {
        const parsed = JSON.parse(caseText);
        if (!validStore(parsed)) throw Error('Invalid case store');
        if (Object.keys(parsed.cases).length > this.limits.cases || Object.values(parsed.cases).some(c => c.history.length > this.limits.caseEvents || c.evidence.length > this.limits.caseEvidence)) {
          this.issue('LOADED_CASE_LIMIT_EXCEEDED', 'cases.json');
        } else cases = parsed;
      } catch (_) { this.issue('CORRUPT_CASE_STORE', 'cases.json'); }
    }
    return { snapshot, entries, correlation, cases };
  }
  load() {
    const { snapshot, entries, correlation } = this.scan();
    const traces = new Map(Object.entries(snapshot));
    for (const e of entries) {
      if (!traces.has(e.traceId)) traces.set(e.traceId, []);
      const hops = traces.get(e.traceId);
      if (!hops.some(h => JSON.stringify(h) === JSON.stringify(e.span))) hops.push(e.span);
    }
    const usage = this.measure(traces);
    for (const key of ['traces', 'spans', 'traceBytes']) {
      if (usage[key] > this.limits[key]) this.issue('LOADED_LIMIT_EXCEEDED', 'trace repository', { limit: key, actual: usage[key], maximum: this.limits[key] });
    }
    // Preserve source files and refuse loading above configured in-memory bounds.
    if (this.issues.some(i => i.code === 'LOADED_LIMIT_EXCEEDED')) traces.clear();
    this.loadIssues = this.issues.filter(i => i.code === 'LOADED_LIMIT_EXCEEDED');
    return { traces, correlation };
  }
  measure(traces) {
    let spans = 0;
    for (const hops of traces.values()) spans += hops.length;
    return { traces: traces.size, spans, traceBytes: Buffer.byteLength(JSON.stringify(Object.fromEntries(traces))) };
  }
  diskBytes() {
    try {
      if (!fs.existsSync(this.directory)) return 0;
      return fs.readdirSync(this.directory, { withFileTypes: true }).filter(e => e.isFile())
        .reduce((sum, e) => sum + fs.statSync(path.join(this.directory, e.name)).size, 0);
    } catch (_) { this.issue('FILE_READ_FAILED', 'storage directory'); return null; }
  }
  requireWritable() {
    this.acquire(); this.scan();
    for (const issue of this.loadIssues || []) this.issue(issue.code, issue.file, issue);
    if (this.issueCount) this.reject(this.issues.every(i => ['NOT_REGULAR_FILE', 'FILE_READ_FAILED'].includes(i.code)) ? 'EVIDENCE_WRITE_FAILED' : 'STORAGE_RECOVERY_REQUIRED', 'recovery', null, null);
  }
  checkLimit(key, current, proposed) {
    if (current === null || proposed === null) this.reject('STORAGE_RECOVERY_REQUIRED', key, current, proposed);
    if (proposed > this.limits[key]) this.reject('STORAGE_CAPACITY_EXCEEDED', key, current, proposed);
  }
  admit(traces, additions, durable = true) {
    this.requireWritable();
    const candidate = new Map([...traces].map(([id, hops]) => [id, [...hops]]));
    for (const { traceId, span } of additions) {
      if (!candidate.has(traceId)) candidate.set(traceId, []);
      candidate.get(traceId).push(span);
    }
    const before = this.measure(traces), after = this.measure(candidate);
    for (const key of ['traces', 'spans', 'traceBytes']) this.checkLimit(key, before[key], after[key]);
    const journalFile = path.join(this.directory, 'ingest-journal.ndjson');
    const journalSize = fs.existsSync(journalFile) ? fs.statSync(journalFile).size : 0;
    const appendBytes = durable ? Buffer.byteLength('\n' + JSON.stringify({ journalVersion: 1, entries: additions }) + '\n') : 0;
    this.checkLimit('journalBytes', journalSize, journalSize + appendBytes);
    const disk = this.diskBytes();
    // Reserve the complete next snapshot in addition to current disk use.
    this.checkLimit('diskBytes', disk, disk === null ? null : disk + appendBytes + after.traceBytes);
  }
  admitAux(value, records) {
    this.requireWritable();
    const bytes = Buffer.byteLength(JSON.stringify(value));
    this.checkLimit('auxiliaryRecords', 0, records);
    this.checkLimit('auxiliaryBytes', 0, bytes);
    const disk = this.diskBytes(); this.checkLimit('diskBytes', disk, disk === null ? null : disk + bytes);
  }
  admitCases(candidate) {
    this.requireWritable();
    this.checkLimit('cases', 0, Object.keys(candidate.cases).length);
    for (const item of Object.values(candidate.cases)) {
      this.checkLimit('caseEvents', 0, item.history.length); this.checkLimit('caseEvidence', 0, item.evidence.length);
    }
    const bytes = Buffer.byteLength(JSON.stringify(candidate)); this.checkLimit('caseBytes', 0, bytes);
    const disk = this.diskBytes(); this.checkLimit('diskBytes', disk, disk === null ? null : disk + bytes);
  }
  snapshotAllowed(traces) {
    this.requireWritable();
    const bytes = this.measure(traces).traceBytes;
    this.checkLimit('traceBytes', 0, bytes);
    const disk = this.diskBytes(); this.checkLimit('diskBytes', disk, disk === null ? null : disk + bytes);
  }
  status(traces, auxiliary = {}) {
    const { cases } = this.scan();
    for (const issue of this.loadIssues || []) this.issue(issue.code, issue.file, issue);
    let old = 0, unknown = 0;
    const now = Date.now();
    const disk = this.diskBytes();
    for (const hops of traces.values()) {
      const times = hops.map(h => h.receivedAt);
      if (times.some(t => !Number.isSafeInteger(t) || t <= 0 || t > now)) unknown++;
      else if (times.length && now - Math.max(...times) >= this.limits.retentionMs) old++;
    }
    return { schemaVersion: 1, state: this.issueCount ? 'RECOVERY_REQUIRED' : 'AVAILABLE', writer: this.lock ? 'EXCLUSIVE_PROCESS_LOCK' : 'NOT_ACQUIRED',
      limits: this.limits, usage: { ...this.measure(traces), diskBytes: disk, ...auxiliary, cases: Object.keys(cases.cases).length, caseBytes: Buffer.byteLength(JSON.stringify(cases)) },
      recovery: { issueCount: this.issueCount, issues: this.issues, sourceFilesPreserved: true, mutationsBlocked: this.issueCount > 0,
        nextStep: this.issueCount ? 'Preserve a copy of evidence files, inspect cited records, and restore or repair in an isolated copy before reopening writes.' : null },
      retention: { mode: 'HOLD_FOR_REVIEW', horizonMs: this.limits.retentionMs, reviewRequiredTraces: old, unknownAgeTraces: unknown,
        deletionEnabled: false, caseEvidence: 'All traces and saved case evidence held; no purge exists.' },
      rejectionsThisProcess: this.rejections, lastRejection: this.lastRejection,
      limitation: 'Local single-writer process. Status is not replicated durability, full disk health, or a production retention compliance guarantee.' };
  }
}
module.exports = { StoragePolicy };
