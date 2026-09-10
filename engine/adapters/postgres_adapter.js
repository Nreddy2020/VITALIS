/**
 * VITALIS STAGE 1: Postgres Sensory Adapter (REAL — not a shape normalizer)
 *
 * Unlike db2_adapter.js / f5_adapter.js / etc. (which reshape telemetry someone
 * else already collected), this adapter genuinely connects to a live Postgres
 * instance, queries its real system catalogs, and emits real OTel spans.
 * It exists to prove the Tier B pattern in ADAPTER_CONTRACT.md against a real
 * database rather than a mocked one, since no real DB2/WebSphere/MQ instance
 * is reachable from this environment.
 *
 * What it actually observes from Postgres:
 * - Blocked queries and who is blocking them (pg_locks / pg_blocking_pids)
 * - How long each blocked query has been waiting (now() - query_start)
 * - Connection pool saturation (active connections / max_connections)
 *
 * What it deliberately does NOT report: db.cpu_utilization_pct. Postgres has
 * no built-in per-session CPU% without extensions (e.g. pg_stat_kcache) that
 * aren't guaranteed present, so this adapter leaves that attribute out rather
 * than fabricate it — VITALIS then correctly reports it as UNKNOWN.
 */

const http = require('http');
const { Pool } = require('pg');
const { decodeTraceFromDbClientInfo } = require('../trace_context');

function makePool(pgConfig = {}) {
  return new Pool({
    host: pgConfig.host || process.env.PGHOST || 'localhost',
    port: pgConfig.port || process.env.PGPORT || 5432,
    user: pgConfig.user || process.env.PGUSER || 'postgres',
    password: pgConfig.password || process.env.PGPASSWORD,
    database: pgConfig.database || process.env.PGDATABASE || 'postgres',
    max: 3
  });
}

// The standard "who is blocking whom" query, built on pg_blocking_pids() —
// no custom lock-graph traversal needed, Postgres exposes this directly.
// `application_name` is selected for both sides because that is where the
// application stamps its trace id (engine/trace_context.js). It is Postgres's
// direct analogue of DB2's CLIENT_APPLNAME, and it is what turns "a query is
// blocked" into "THIS request is blocked, by THAT one".
const BLOCKED_QUERIES_SQL = `
  SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocked.query_start AS blocked_query_start,
    blocked.application_name AS blocked_application_name,
    blocking.pid AS blocking_pid,
    blocking.application_name AS blocking_application_name
  FROM pg_stat_activity AS blocked
  CROSS JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocking_pid_raw(pid)
  JOIN pg_stat_activity AS blocking ON blocking.pid = blocking_pid_raw.pid
  WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0;
`;

const POOL_SATURATION_SQL = `
  SELECT
    (SELECT count(*) FROM pg_stat_activity) AS active_connections,
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections;
`;

// A crude but honest query fingerprint: normalize whitespace and literal
// values so the same query SHAPE always yields the same fingerprint, without
// exposing actual parameter values (see engine/privacy_sanitizer.js).
function fingerprintQuery(sql) {
  if (!sql) return undefined;
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\b\d+\b/g, 'N')
    .replace(/'[^']*'/g, "'?'")
    .trim()
    .slice(0, 120);
}

async function observeOnce(pool) {
  const [blockedResult, poolResult] = await Promise.all([
    pool.query(BLOCKED_QUERIES_SQL),
    pool.query(POOL_SATURATION_SQL)
  ]);

  const saturationPct = Math.round(
    (poolResult.rows[0].active_connections / poolResult.rows[0].max_connections) * 100
  );

  const now = Date.now();
  return blockedResult.rows.map(row => {
    const lockWaitMs = row.blocked_query_start ? now - new Date(row.blocked_query_start).getTime() : undefined;
    return {
      blockedPid: row.blocked_pid,
      blockingPid: row.blocking_pid,
      lockWaitMs,
      queryFingerprint: fingerprintQuery(row.blocked_query),
      connectionPoolSaturationPct: saturationPct,
      // Recovered from the connection, not supplied by the caller. Undefined
      // when the application did not propagate a trace id — the hop is then
      // observable but unattributable, and saying so is the honest outcome.
      traceId: decodeTraceFromDbClientInfo(row.blocked_application_name),
      blockingTraceId: decodeTraceFromDbClientInfo(row.blocking_application_name)
    };
  });
}

function toOtelSpan(traceId, observation, durationMs) {
  const attributes = [
    { key: 'db.holding_lock_pid', value: { intValue: observation.blockingPid } },
    { key: 'db.connection_pool.saturation_pct', value: { intValue: observation.connectionPoolSaturationPct } }
  ];
  if (observation.lockWaitMs !== undefined) {
    attributes.push({ key: 'db.lock_wait_ms', value: { intValue: Math.round(observation.lockWaitMs) } });
  }
  if (observation.queryFingerprint) {
    attributes.push({ key: 'db.query.fingerprint', value: { stringValue: observation.queryFingerprint } });
  }
  if (observation.blockingTraceId) {
    // The request holding the lock, when it also propagated a trace id. This is
    // the answer to "who is blocking my checkout?" — a different request, named.
    attributes.push({ key: 'db.blocking_trace_id', value: { stringValue: observation.blockingTraceId } });
  }
  // db.cpu_utilization_pct deliberately omitted — not observable from Postgres core.

  return {
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'Postgres' } }] },
    scopeSpans: [{ spans: [{
      traceId, spanId: `sp-pg-${observation.blockedPid}`, name: 'DB-Query', durationMs, attributes
    }] }]
  };
}

function postToVitalis(vitalisConfig, resourceSpans) {
  const body = JSON.stringify({ resourceSpans });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: vitalisConfig.host || 'localhost',
      port: vitalisConfig.port || 4318,
      path: '/v1/traces',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vitalis-api-key': vitalisConfig.apiKey, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Observe Postgres once and, for each blocked query found, report it to
 * VITALIS as a real span under the given traceId. Returns what it observed
 * (useful for tests / logging) — reports nothing if nothing is blocked.
 */
async function pollAndReport(pool, vitalisConfig, fallbackTraceId) {
  const observations = await observeOnce(pool);
  const results = [];
  for (const obs of observations) {
    const durationMs = obs.lockWaitMs !== undefined ? Math.round(obs.lockWaitMs) : 0;
    // The trace id RECOVERED from the blocked connection wins. The caller's id
    // is only a fallback for sessions that propagated nothing — attribution
    // should come from the database, not from whoever happened to call us.
    const traceId = obs.traceId || fallbackTraceId;
    const span = toOtelSpan(traceId, obs, durationMs);
    const postResult = await postToVitalis(vitalisConfig, [span]);
    results.push({ observation: obs, traceId, attributed: !!obs.traceId, postResult });
  }
  return results;
}

module.exports = { makePool, observeOnce, toOtelSpan, pollAndReport, fingerprintQuery };

// Runnable directly: node engine/adapters/postgres_adapter.js
// Polls the configured Postgres instance every 2s and reports any blocked
// query it finds to VITALIS under a fixed demo trace id, until Ctrl+C.
if (require.main === module) {
  const traceId = process.env.VITALIS_TRACE_ID || 'TX-PG-PILOT-001';
  const vitalisConfig = { host: process.env.VITALIS_HOST || 'localhost', port: process.env.PORT || 4318, apiKey: process.env.VITALIS_API_KEY };
  if (!vitalisConfig.apiKey) {
    console.error('[postgres_adapter] Set VITALIS_API_KEY to the same key your VITALIS server is using.');
    process.exit(1);
  }
  const pool = makePool();
  console.log(`[postgres_adapter] Polling Postgres for lock contention, reporting to VITALIS at ${vitalisConfig.host}:${vitalisConfig.port} under trace ${traceId}`);
  setInterval(async () => {
    try {
      const results = await pollAndReport(pool, vitalisConfig, traceId);
      if (results.length > 0) {
        console.log(`[postgres_adapter] Reported ${results.length} blocked-query observation(s):`, results.map(r => r.observation));
      }
    } catch (err) {
      console.error('[postgres_adapter] observation error:', err.message);
    }
  }, 2000);
}
