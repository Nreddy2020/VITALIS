/**
 * VITALIS: IBM DB2 live sensory adapter (Tier B)
 *
 * The same pattern as postgres_adapter.js, against DB2's real monitoring
 * interfaces: the MON_GET_* table functions IBM ships for exactly this purpose.
 *
 * ── HONESTY NOTE, PLEASE READ ───────────────────────────────────────────────
 * The SQL below targets real, documented DB2 interfaces, and the row→span
 * mapping in `rowToObservation()` / `toOtelSpan()` is genuinely unit-tested
 * (tests/verify_stage6_ibm_adapter_gates.js) against realistically shaped rows.
 *
 * What has NOT been verified is the live connection: no DB2 instance was
 * reachable from the environment this was written in, so `connect()` and the
 * exact column behaviour of these table functions on your DB2 version have not
 * been executed against a real server. Treat this file as reviewed-and-tested
 * transformation logic plus an UNVERIFIED connection path, and run
 * `selfTest()` against your own instance before trusting it. The Postgres
 * adapter is the one proven end-to-end against a live database.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Requires the `ibm_db` driver (`npm install ibm_db`), which is not a
 * dependency of this project precisely because it cannot be exercised here.
 */

const http = require('http');
const { decodeTraceFromDbClientInfo } = require('../trace_context');

/**
 * Lock waits, with who is blocking whom. MON_GET_APPL_LOCKWAIT reports every
 * application currently waiting on a lock and the holder's application handle.
 */
const LOCK_WAIT_SQL = `
  SELECT
    lw.REQ_APPLICATION_HANDLE   AS BLOCKED_HANDLE,
    lw.APPLICATION_HANDLE       AS HOLDING_HANDLE,
    lw.LOCK_MODE                AS LOCK_MODE,
    lw.LOCK_OBJECT_TYPE         AS LOCK_OBJECT_TYPE,
    lw.LOCK_WAIT_START_TIME     AS LOCK_WAIT_START_TIME,
    act.STMT_TEXT               AS STMT_TEXT,
    conn.CLIENT_APPLNAME        AS CLIENT_APPLNAME,
    conn.CLIENT_ACCTNG          AS CLIENT_ACCTNG,
    act.TOTAL_ACT_TIME          AS TOTAL_ACT_TIME_MS,
    act.LOCK_WAIT_TIME          AS LOCK_WAIT_TIME_MS
  FROM TABLE(MON_GET_APPL_LOCKWAIT(NULL, -2)) AS lw
  LEFT JOIN TABLE(MON_GET_ACTIVITY(NULL, -2)) AS act
    ON act.APPLICATION_HANDLE = lw.REQ_APPLICATION_HANDLE
  LEFT JOIN TABLE(MON_GET_CONNECTION(NULL, -2)) AS conn
    ON conn.APPLICATION_HANDLE = lw.REQ_APPLICATION_HANDLE
`;

/**
 * Connection-pool saturation: connections in use against the configured
 * maximum. MAX_COORDAGENTS of -1 means "automatic" (no fixed ceiling), in which
 * case saturation is genuinely not computable and must be reported as unknown
 * rather than as a number.
 */
const CONNECTION_SQL = `
  SELECT
    (SELECT COUNT(*) FROM TABLE(MON_GET_CONNECTION(NULL, -2))) AS ACTIVE_CONNECTIONS,
    (SELECT VALUE FROM SYSIBMADM.DBMCFG WHERE NAME = 'max_coordagents') AS MAX_COORDAGENTS
  FROM SYSIBM.SYSDUMMY1
`;

/** Buffer pool hit ratio — a real DB2 metric with no Postgres equivalent. */
const BUFFERPOOL_SQL = `
  SELECT
    SUM(POOL_DATA_L_READS + POOL_INDEX_L_READS)                          AS LOGICAL_READS,
    SUM(POOL_DATA_P_READS + POOL_INDEX_P_READS)                          AS PHYSICAL_READS
  FROM TABLE(MON_GET_BUFFERPOOL('', -2))
`;

/** Normalize a statement into a fingerprint; never emit raw literals. */
function fingerprintStatement(sql) {
  if (!sql) return undefined;
  return String(sql)
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, "'?'")
    .replace(/\b\d+\b/g, 'N')
    .trim()
    .slice(0, 120);
}

/**
 * Map one raw DB2 lock-wait row to a VITALIS observation.
 * Pure and side-effect free, which is what makes it unit-testable without DB2.
 * Anything DB2 did not report stays undefined — never defaulted.
 */
function rowToObservation(row, { saturationPct, bufferPoolHitRatioPct, now = Date.now() } = {}) {
  if (!row) return null;

  // Prefer DB2's own accumulated lock-wait time; fall back to elapsed wait only
  // when a real start time is present.
  let lockWaitMs = row.LOCK_WAIT_TIME_MS !== undefined && row.LOCK_WAIT_TIME_MS !== null
    ? Number(row.LOCK_WAIT_TIME_MS)
    : undefined;
  if (lockWaitMs === undefined && row.LOCK_WAIT_START_TIME) {
    const started = new Date(row.LOCK_WAIT_START_TIME).getTime();
    if (!isNaN(started)) lockWaitMs = now - started;
  }

  return {
    blockedHandle: row.BLOCKED_HANDLE !== undefined ? Number(row.BLOCKED_HANDLE) : undefined,
    holdingHandle: row.HOLDING_HANDLE !== undefined ? Number(row.HOLDING_HANDLE) : undefined,
    lockMode: row.LOCK_MODE || undefined,
    lockObjectType: row.LOCK_OBJECT_TYPE || undefined,
    lockWaitMs,
    executionDurationMs: row.TOTAL_ACT_TIME_MS !== undefined && row.TOTAL_ACT_TIME_MS !== null
      ? Number(row.TOTAL_ACT_TIME_MS) : undefined,
    queryFingerprint: fingerprintStatement(row.STMT_TEXT),
    // Recovered from the connection's own client-info, exactly as the Postgres
    // adapter recovers it from application_name. Undefined when the application
    // did not propagate — observable but unattributable, and said so.
    traceId: decodeTraceFromDbClientInfo(row.CLIENT_APPLNAME)
          || decodeTraceFromDbClientInfo(row.CLIENT_ACCTNG),
    connectionPoolSaturationPct: saturationPct,
    bufferPoolHitRatioPct
  };
}

/**
 * Saturation from a raw connection row. Returns undefined — not a number — when
 * DB2 is configured with automatic agents (-1), because there is no ceiling to
 * be a percentage of.
 */
function computeSaturationPct(connRow) {
  if (!connRow) return undefined;
  const active = Number(connRow.ACTIVE_CONNECTIONS);
  const max = Number(connRow.MAX_COORDAGENTS);
  if (!isFinite(active) || !isFinite(max) || max <= 0) return undefined;
  return Math.round((active / max) * 100);
}

/** Buffer pool hit ratio from raw read counters; undefined when nothing was read. */
function computeBufferPoolHitRatio(bpRow) {
  if (!bpRow) return undefined;
  const logical = Number(bpRow.LOGICAL_READS);
  const physical = Number(bpRow.PHYSICAL_READS);
  if (!isFinite(logical) || !isFinite(physical) || logical <= 0) return undefined;
  return Math.round(((logical - physical) / logical) * 1000) / 10;
}

/**
 * Convert an observation to an OTel span following ADAPTER_CONTRACT.md.
 * `db.cpu_utilization_pct` is omitted: DB2 exposes host CPU through
 * ENV_GET_SYSTEM_RESOURCES, which is a separate call and not guaranteed
 * permitted, so it is left unreported rather than guessed.
 */
function toOtelSpan(traceId, observation, durationMs) {
  const attributes = [{ key: 'db.system', value: { stringValue: 'db2' } }];
  const push = (key, value, type = 'intValue') => {
    if (value === undefined || value === null) return;
    attributes.push({ key, value: { [type]: type === 'intValue' ? Math.round(Number(value)) : value } });
  };

  push('db.holding_lock_pid', observation.holdingHandle);
  push('db.lock_wait_ms', observation.lockWaitMs);
  push('db.connection_pool.saturation_pct', observation.connectionPoolSaturationPct);
  if (observation.queryFingerprint) {
    attributes.push({ key: 'db.query.fingerprint', value: { stringValue: observation.queryFingerprint } });
  }
  if (observation.bufferPoolHitRatioPct !== undefined) {
    attributes.push({ key: 'db2.bufferpool.hit_ratio_pct', value: { doubleValue: observation.bufferPoolHitRatioPct } });
  }
  if (observation.lockMode) {
    attributes.push({ key: 'db2.lock.mode', value: { stringValue: observation.lockMode } });
  }

  return {
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'DB2' } }] },
    scopeSpans: [{ spans: [{
      traceId,
      spanId: `sp-db2-${observation.blockedHandle !== undefined ? observation.blockedHandle : 'unknown'}`,
      name: 'DB-Query',
      durationMs: durationMs !== undefined ? durationMs : (observation.executionDurationMs || 0),
      attributes
    }] }]
  };
}

// ---------------------------------------------------------------------------
// Live connection path — UNVERIFIED against a real DB2 instance. See header.
// ---------------------------------------------------------------------------

function loadDriver() {
  try {
    return require('ibm_db');
  } catch (err) {
    throw new Error(
      'The ibm_db driver is not installed. Run `npm install ibm_db` on a host with the ' +
      'IBM Data Server Driver available. It is deliberately not a dependency of this ' +
      'project because it could not be exercised where this adapter was written.'
    );
  }
}

/** @param connStr e.g. "DATABASE=SAMPLE;HOSTNAME=host;PORT=50000;UID=u;PWD=p;" */
async function connect(connStr) {
  const ibmdb = loadDriver();
  return new Promise((resolve, reject) => {
    ibmdb.open(connStr, (err, conn) => err ? reject(err) : resolve(conn));
  });
}

function query(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.query(sql, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

/** One observation pass against a live DB2. */
async function observeOnce(conn) {
  const [lockRows, connRows, bpRows] = await Promise.all([
    query(conn, LOCK_WAIT_SQL),
    query(conn, CONNECTION_SQL).catch(() => []),
    query(conn, BUFFERPOOL_SQL).catch(() => [])
  ]);
  const saturationPct = computeSaturationPct(connRows[0]);
  const bufferPoolHitRatioPct = computeBufferPoolHitRatio(bpRows[0]);
  return lockRows
    .map(r => rowToObservation(r, { saturationPct, bufferPoolHitRatioPct }))
    .filter(Boolean);
}

function postToVitalis(vitalisConfig, resourceSpans) {
  const body = JSON.stringify({ resourceSpans });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: vitalisConfig.host || 'localhost',
      port: vitalisConfig.port || 4318,
      path: '/v1/traces',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vitalis-api-key': vitalisConfig.apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function pollAndReport(conn, vitalisConfig, traceId) {
  const observations = await observeOnce(conn);
  const results = [];
  for (const obs of observations) {
    const span = toOtelSpan(traceId, obs, obs.executionDurationMs);
    results.push({ observation: obs, postResult: await postToVitalis(vitalisConfig, [span]) });
  }
  return results;
}

/**
 * Run this against YOUR DB2 before trusting the connection path. It reports
 * exactly which of the three monitoring queries your instance and privileges
 * actually allow, instead of failing opaquely at 3am.
 */
async function selfTest(connStr) {
  const results = { driver: false, connection: false, lockWaitQuery: false, connectionQuery: false, bufferPoolQuery: false, errors: {} };
  let conn;
  try { loadDriver(); results.driver = true; }
  catch (err) { results.errors.driver = err.message; return results; }

  try { conn = await connect(connStr); results.connection = true; }
  catch (err) { results.errors.connection = err.message; return results; }

  for (const [key, sql] of [['lockWaitQuery', LOCK_WAIT_SQL], ['connectionQuery', CONNECTION_SQL], ['bufferPoolQuery', BUFFERPOOL_SQL]]) {
    try { await query(conn, sql); results[key] = true; }
    catch (err) { results.errors[key] = err.message; }
  }
  try { conn.closeSync(); } catch (e) {}
  return results;
}

module.exports = {
  LOCK_WAIT_SQL, CONNECTION_SQL, BUFFERPOOL_SQL,
  fingerprintStatement, rowToObservation, computeSaturationPct, computeBufferPoolHitRatio,
  toOtelSpan, connect, observeOnce, pollAndReport, postToVitalis, selfTest
};

// CLI: node engine/adapters/db2_live_adapter.js selftest "DATABASE=...;HOSTNAME=...;"
if (require.main === module) {
  const [cmd, connStr] = process.argv.slice(2);
  if (cmd === 'selftest' && connStr) {
    selfTest(connStr).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.connection ? 0 : 1); });
  } else {
    console.log('usage: node engine/adapters/db2_live_adapter.js selftest "<DB2 connection string>"');
    process.exit(1);
  }
}
