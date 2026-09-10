/**
 * VITALIS: Trace-context propagation
 *
 * This is the piece that decides whether VITALIS can say "this database lock
 * belonged to THAT customer request", or only "there was a lock somewhere".
 * Without propagation, a DB2 or MQ hop can be observed but not attributed, and
 * request attribution is the entire premise of the product.
 *
 * The problem: DB2 and MQ do not carry W3C `traceparent` headers. They do,
 * however, each expose a field the application controls and the monitoring
 * surface reports back:
 *
 *   DB2  — the connection's CLIENT_APPLNAME / CLIENT_ACCTNG client-info fields,
 *          visible in MON_GET_CONNECTION and MON_GET_APPL_LOCKWAIT.
 *          (Postgres's `application_name` is the exact analogue, which is what
 *          lets the propagation loop be proven end-to-end against a real
 *          database — see tests/verify_stage8_propagation_gates.js.)
 *   MQ   — the MQMD CorrelId, a fixed 24-byte binary field carried with every
 *          message and reported by queue monitoring.
 *
 * So the application stamps the trace id into that field when it opens the
 * connection or puts the message, and the adapter reads it back out. This file
 * is the encode/decode pair for both, plus W3C traceparent parsing.
 *
 * Everything here is pure and side-effect free, so it is fully testable without
 * DB2 or MQ present — and the decode side is written to fail closed: an
 * unrecognised or corrupt value returns undefined rather than a plausible-
 * looking trace id, because a WRONG attribution is worse than no attribution.
 */

const TRACE_ID_RE = /^[0-9a-f]{32}$/i;
const SPAN_ID_RE = /^[0-9a-f]{16}$/i;

// A short marker so a trace id can be found inside a field that may also carry
// the application's own text, and so foreign values are not mistaken for ours.
const DB_PREFIX = 'vt=';

/** Is this a well-formed W3C trace id (32 lowercase hex, not all zeroes)? */
function isValidTraceId(traceId) {
  return typeof traceId === 'string'
    && TRACE_ID_RE.test(traceId)
    && !/^0{32}$/.test(traceId);
}

function isValidSpanId(spanId) {
  return typeof spanId === 'string' && SPAN_ID_RE.test(spanId) && !/^0{16}$/.test(spanId);
}

/**
 * Parse a W3C traceparent header: `00-<32 hex trace>-<16 hex span>-<2 hex flags>`.
 * Returns undefined for anything malformed — never a partial guess.
 */
function parseTraceparent(header) {
  if (typeof header !== 'string') return undefined;
  const parts = header.trim().split('-');
  if (parts.length !== 4) return undefined;
  const [version, traceId, spanId, flags] = parts;
  if (!/^[0-9a-f]{2}$/i.test(version) || version.toLowerCase() === 'ff') return undefined;
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) return undefined;
  if (!/^[0-9a-f]{2}$/i.test(flags)) return undefined;
  return {
    version: version.toLowerCase(),
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    flags: flags.toLowerCase(),
    sampled: (parseInt(flags, 16) & 0x01) === 1
  };
}

function formatTraceparent({ traceId, spanId, sampled = true, version = '00' }) {
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    throw new Error('formatTraceparent requires a valid 32-hex traceId and 16-hex spanId');
  }
  return `${version}-${traceId.toLowerCase()}-${spanId.toLowerCase()}-${sampled ? '01' : '00'}`;
}

// ---------------------------------------------------------------------------
// Database client-info propagation (DB2 CLIENT_APPLNAME, Postgres application_name)
// ---------------------------------------------------------------------------

/**
 * DB2's CLIENT_APPLNAME is limited to 255 bytes and Postgres truncates
 * application_name at NAMEDATALEN-1 (63 bytes by default), so the encoding must
 * stay short. `vt=<32 hex>` is 35 characters, leaving room for an application
 * label alongside it.
 *
 * @param traceId  a valid W3C trace id
 * @param appLabel optional application name to keep alongside it, for DBAs
 *                 reading pg_stat_activity or MON_GET_CONNECTION by eye
 */
function encodeTraceForDbClientInfo(traceId, appLabel) {
  if (!isValidTraceId(traceId)) throw new Error(`encodeTraceForDbClientInfo: invalid traceId "${traceId}"`);
  const encoded = DB_PREFIX + traceId.toLowerCase();
  if (!appLabel) return encoded;
  // Trace id last so a truncating server loses the label, not the attribution.
  const label = String(appLabel).replace(/\s+/g, '-').slice(0, 24);
  return `${label} ${encoded}`;
}

/**
 * Recover a trace id from a client-info field. Returns undefined when the field
 * is absent, foreign, or corrupt — deliberately, because attributing a database
 * lock to the wrong customer request is worse than admitting it is unattributed.
 */
function decodeTraceFromDbClientInfo(clientInfo) {
  if (typeof clientInfo !== 'string') return undefined;
  const match = new RegExp(DB_PREFIX + '([0-9a-f]{32})', 'i').exec(clientInfo);
  if (!match) return undefined;
  const traceId = match[1].toLowerCase();
  return isValidTraceId(traceId) ? traceId : undefined;
}

// ---------------------------------------------------------------------------
// IBM MQ propagation (MQMD CorrelId)
// ---------------------------------------------------------------------------

/**
 * MQMD CorrelId is exactly 24 bytes. A W3C trace id is 16 bytes, so the trace
 * fits with 8 bytes to spare: a 4-byte magic so foreign CorrelIds set by other
 * applications are not misread as ours, then the 16-byte trace id, then 4 bytes
 * of the span id for a coarse parent hint.
 *
 *   bytes 0-3   magic 'VTLS'
 *   bytes 4-19  trace id (16 bytes)
 *   bytes 20-23 first 4 bytes of span id
 */
const MQ_CORRELID_BYTES = 24;
const MQ_MAGIC = Buffer.from('VTLS', 'ascii');

function encodeTraceForMqCorrelId(traceId, spanId) {
  if (!isValidTraceId(traceId)) throw new Error(`encodeTraceForMqCorrelId: invalid traceId "${traceId}"`);
  const buf = Buffer.alloc(MQ_CORRELID_BYTES, 0);
  MQ_MAGIC.copy(buf, 0);
  Buffer.from(traceId, 'hex').copy(buf, 4);
  if (isValidSpanId(spanId)) Buffer.from(spanId, 'hex').subarray(0, 4).copy(buf, 20);
  return buf;
}

/**
 * Decode a CorrelId. Accepts a Buffer or the 48-char hex string MQ tooling
 * usually prints. Anything without our magic is another application's
 * correlation id and returns undefined — it is not ours to interpret.
 */
function decodeTraceFromMqCorrelId(correlId) {
  let buf;
  if (Buffer.isBuffer(correlId)) buf = correlId;
  else if (typeof correlId === 'string') {
    const hex = correlId.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== MQ_CORRELID_BYTES * 2) return undefined;
    buf = Buffer.from(hex, 'hex');
  } else return undefined;

  if (buf.length !== MQ_CORRELID_BYTES) return undefined;
  if (!buf.subarray(0, 4).equals(MQ_MAGIC)) return undefined;

  const traceId = buf.subarray(4, 20).toString('hex');
  if (!isValidTraceId(traceId)) return undefined;
  const spanPrefix = buf.subarray(20, 24).toString('hex');
  return { traceId, spanIdPrefix: /^0{8}$/.test(spanPrefix) ? undefined : spanPrefix };
}

// ---------------------------------------------------------------------------
// Convenience for application teams
// ---------------------------------------------------------------------------

/**
 * Build the connection options an application should use so its database
 * sessions are attributable. Works for `pg` today (application_name) and
 * documents the DB2 equivalent for the ibm_db driver.
 */
function dbConnectionOptionsForTrace(traceId, { appLabel, driver = 'pg' } = {}) {
  const value = encodeTraceForDbClientInfo(traceId, appLabel);
  if (driver === 'pg') return { application_name: value };
  if (driver === 'ibm_db') {
    // ibm_db exposes these as connection-string attributes; the same string can
    // also be set at runtime with SYSPROC.WLM_SET_CLIENT_INFO.
    return { CLIENTAPPLNAME: value, CLIENTACCTSTR: `vt=${traceId}` };
  }
  throw new Error(`dbConnectionOptionsForTrace: unsupported driver "${driver}"`);
}

/** A fresh, valid W3C trace id — for tests and for applications with no upstream context. */
function newTraceId() {
  return require('crypto').randomBytes(16).toString('hex');
}

function newSpanId() {
  return require('crypto').randomBytes(8).toString('hex');
}

module.exports = {
  isValidTraceId, isValidSpanId,
  parseTraceparent, formatTraceparent,
  encodeTraceForDbClientInfo, decodeTraceFromDbClientInfo,
  encodeTraceForMqCorrelId, decodeTraceFromMqCorrelId,
  dbConnectionOptionsForTrace,
  newTraceId, newSpanId,
  DB_PREFIX, MQ_CORRELID_BYTES
};
