'use strict';
const fs = require('node:fs');
const path = require('node:path');
const recoveryRequired = new Set();

// One frame per ingest batch. A torn final frame cannot publish half a batch.
// fsync acknowledges the local OS/storage boundary; it is not replica durability.
function appendBatch(file, entries) {
  if (!entries.length) return;
  if (recoveryRequired.has(file)) {
    const error = new Error('Journal recovery required before further ingestion');
    error.code = 'EVIDENCE_WRITE_FAILED'; error.rollbackFailed = true; throw error;
  }
  let fd, previous;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fd = fs.openSync(file, 'a');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Error('Journal destination is not a regular file');
    previous = stat.size;
    fs.writeFileSync(fd, '\n' + JSON.stringify({ journalVersion: 1, entries }) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } catch (cause) {
    let rollbackFailed = false;
    if (fd !== undefined && previous !== undefined) {
      // Windows append-only handles cannot always truncate. Open a write handle
      // for rollback; this local journal has one process/writer by contract.
      let rollbackFd;
      try {
        rollbackFd = fs.openSync(file, 'r+'); fs.ftruncateSync(rollbackFd, previous); fs.fsyncSync(rollbackFd);
      } catch (_) { rollbackFailed = true; }
      finally { if (rollbackFd !== undefined) fs.closeSync(rollbackFd); }
    }
    const error = new Error('Evidence journal write failed; ingest was not acknowledged');
    if (rollbackFailed) recoveryRequired.add(file);
    error.code = 'EVIDENCE_WRITE_FAILED'; error.cause = cause; error.rollbackFailed = rollbackFailed;
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function writeSnapshot(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.next-' + process.pid;
  const fd = fs.openSync(temporary, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value), 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  // Same-directory rename preserves the old valid snapshot until replacement.
  // Directory fsync/power-loss semantics are platform-specific and not certified.
  fs.renameSync(temporary, file);
}

function truncate(file) {
  if (!fs.existsSync(file)) return;
  const fd = fs.openSync(file, 'w');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function decodeLine(line) {
  const record = JSON.parse(line);
  if (!record || typeof record !== 'object') throw Error('Invalid journal record');
  if (record.journalVersion !== undefined) {
    if (record.journalVersion !== 1 || !Array.isArray(record.entries)) throw Error('Unsupported journal frame');
    if (!record.entries.every(e => e && typeof e.traceId === 'string' && e.traceId && e.span && typeof e.span === 'object' && typeof e.span.spanId === 'string')) throw Error('Invalid journal batch');
    return record.entries;
  }
  if (typeof record.traceId === 'string' && record.traceId && record.span && typeof record.span.spanId === 'string') return [record];
  throw Error('Invalid legacy journal record');
}
module.exports = { appendBatch, writeSnapshot, truncate, decodeLine, requiresRecovery: file => recoveryRequired.has(file) };
