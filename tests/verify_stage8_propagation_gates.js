/**
 * VITALIS STAGE 8 — Trace-context propagation
 *
 * This closes the gap that mattered most: a DB or MQ hop that is *observed* but
 * not *attributed* to a specific request. Attribution is the entire premise of
 * the product, and until now the Postgres adapter was handed a trace id by
 * whoever called it rather than recovering the real one from the database.
 *
 * The end-to-end loop is proven against a LIVE Postgres, because
 * `application_name` is the exact analogue of DB2's `CLIENT_APPLNAME`: the
 * application stamps the trace id on its connection, the database reports it
 * back through its own monitoring view, and the adapter recovers it. The same
 * mechanism, same encoding, same decode path is what runs against DB2 — only
 * the column name differs.
 *
 *  P1  Encode/decode round-trips for the DB client-info field, and a foreign or
 *      corrupt value yields undefined rather than a plausible-looking trace id.
 *  P2  MQMD CorrelId (24 bytes) round-trips, and another application's CorrelId
 *      is not misread as ours.
 *  P3  W3C traceparent parsing accepts valid headers and rejects malformed ones.
 *  P4  **LIVE**: two real Postgres sessions each stamp a DIFFERENT real trace id
 *      on their connection, one genuinely blocks behind the other, and the
 *      adapter recovers the blocked session's own trace id from the database —
 *      attributing the lock to the right request, and naming the blocking
 *      request too.
 *  P5  **LIVE**: a session that propagates NOTHING is reported as unattributed
 *      rather than being given a borrowed or invented trace id.
 *
 * Outputs: artifacts/stage8-propagation-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');

const tc = require('../engine/trace_context');
const { makePool, observeOnce, pollAndReport } = require('../engine/adapters/postgres_adapter');
const db2 = require('../engine/adapters/db2_live_adapter');

const TEST_API_KEY = 'stage8-propagation-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage8-'));
const { startServer, stopServer } = require('../server');
const TEST_PORT = 4334;

const PG = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'vitalis_pilot'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(options) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': TEST_API_KEY, ...(options.headers || {}) } };
  return new Promise((resolve, reject) => {
    const r = http.request(options, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b || '{}') }); } catch (e) { resolve({ status: res.statusCode, raw: b }); } });
    });
    r.on('error', reject);
    r.end();
  });
}

async function run() {
  console.log('==================================================================');
  console.log('        VITALIS STAGE 8 — TRACE-CONTEXT PROPAGATION               ');
  console.log('==================================================================\n');
  const report = { version: '1.0', testRun: `VITALIS-STAGE8-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };

  // ---------------- P1: DB client-info encoding ----------------
  console.log('--- [GATE P1] DB client-info encode/decode, and fails closed ---');
  const traceA = tc.newTraceId();
  const encoded = tc.encodeTraceForDbClientInfo(traceA, 'checkout-svc');
  const roundTrip = tc.decodeTraceFromDbClientInfo(encoded) === traceA;
  const fitsPostgres = Buffer.byteLength(encoded) <= 63;   // Postgres NAMEDATALEN-1
  const failsClosed =
    tc.decodeTraceFromDbClientInfo('psql') === undefined &&
    tc.decodeTraceFromDbClientInfo('') === undefined &&
    tc.decodeTraceFromDbClientInfo(undefined) === undefined &&
    tc.decodeTraceFromDbClientInfo('vt=nothex') === undefined &&
    tc.decodeTraceFromDbClientInfo('vt=' + '0'.repeat(32)) === undefined;  // all-zero is invalid
  report.gates.dbClientInfoRoundTrip = (roundTrip && fitsPostgres && failsClosed) ? 'PASS' : 'FAIL';
  console.log(`> Encoded: "${encoded}" (${Buffer.byteLength(encoded)} bytes, fits Postgres 63-byte limit: ${fitsPostgres})`);
  console.log(`> Round-trips to the same trace id: ${roundTrip}`);
  console.log(`> Foreign/corrupt values return undefined rather than a guess: ${failsClosed}`);
  console.log(`RESULT GATE P1: [${report.gates.dbClientInfoRoundTrip}]\n`);

  // ---------------- P2: MQMD CorrelId ----------------
  console.log('--- [GATE P2] MQMD CorrelId (24 bytes) round-trip ---');
  const traceB = tc.newTraceId();
  const spanB = tc.newSpanId();
  const correl = tc.encodeTraceForMqCorrelId(traceB, spanB);
  const decoded = tc.decodeTraceFromMqCorrelId(correl);
  const hexRoundTrip = tc.decodeTraceFromMqCorrelId(correl.toString('hex'));
  const foreign = tc.decodeTraceFromMqCorrelId(Buffer.alloc(24, 0x41));   // another app's CorrelId
  const wrongLength = tc.decodeTraceFromMqCorrelId(Buffer.alloc(16, 0));
  const p2 = correl.length === 24 && decoded && decoded.traceId === traceB
    && hexRoundTrip && hexRoundTrip.traceId === traceB
    && foreign === undefined && wrongLength === undefined;
  report.gates.mqCorrelIdRoundTrip = p2 ? 'PASS' : 'FAIL';
  console.log(`> CorrelId is exactly ${correl.length} bytes (MQMD requires 24)`);
  console.log(`> Decodes from Buffer and from the hex MQSC prints: ${!!decoded && !!hexRoundTrip}`);
  console.log(`> Another application's CorrelId is not misread as ours: ${foreign === undefined}`);
  console.log(`RESULT GATE P2: [${report.gates.mqCorrelIdRoundTrip}]\n`);

  // ---------------- P3: W3C traceparent ----------------
  console.log('--- [GATE P3] W3C traceparent parsing ---');
  const good = tc.formatTraceparent({ traceId: traceA, spanId: spanB });
  const parsed = tc.parseTraceparent(good);
  const rejects = ['', 'garbage', '00-short-0000000000000000-01',
    `00-${'0'.repeat(32)}-${spanB}-01`, `ff-${traceA}-${spanB}-01`]
    .every(h => tc.parseTraceparent(h) === undefined);
  const p3 = !!parsed && parsed.traceId === traceA && parsed.sampled === true && rejects;
  report.gates.traceparentParsing = p3 ? 'PASS' : 'FAIL';
  console.log(`> "${good}" -> traceId ${parsed && parsed.traceId}, sampled ${parsed && parsed.sampled}`);
  console.log(`> Malformed / all-zero / version-ff headers all rejected: ${rejects}`);
  console.log(`RESULT GATE P3: [${report.gates.traceparentParsing}]\n`);

  // Bonus: the same decode path used by the DB2 adapter, on a realistic row.
  const db2Row = db2.rowToObservation({
    BLOCKED_HANDLE: 4711, HOLDING_HANDLE: 8123,
    CLIENT_APPLNAME: tc.encodeTraceForDbClientInfo(traceA, 'wasapp'),
    TOTAL_ACT_TIME_MS: 3982, LOCK_WAIT_TIME_MS: 2100
  }, {});
  console.log(`  (DB2 adapter recovers the same trace id from CLIENT_APPLNAME: ${db2Row.traceId === traceA})\n`);
  report.db2RowRecoversTrace = db2Row.traceId === traceA;

  // ================= LIVE POSTGRES =================
  await startServer(TEST_PORT);
  let holder, blocker, unattributed, pool;
  try {
    const setup = new Client(PG);
    await setup.connect();
    await setup.query('CREATE TABLE IF NOT EXISTS inventory_items (sku_id INT PRIMARY KEY, qty INT NOT NULL);');
    await setup.query('INSERT INTO inventory_items (sku_id, qty) VALUES (847, 100) ON CONFLICT (sku_id) DO UPDATE SET qty = 100;');
    await setup.end();

    console.log('--- [GATE P4] LIVE: the adapter recovers the blocked request\'s OWN trace id ---');
    const holderTrace = tc.newTraceId();
    const blockedTrace = tc.newTraceId();

    // Each connection stamps its own real trace id, exactly as an instrumented
    // application would via dbConnectionOptionsForTrace().
    holder = new Client({ ...PG, ...tc.dbConnectionOptionsForTrace(holderTrace, { appLabel: 'cart-svc' }) });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM inventory_items WHERE sku_id = 847 FOR UPDATE;');

    blocker = new Client({ ...PG, ...tc.dbConnectionOptionsForTrace(blockedTrace, { appLabel: 'checkout-svc' }) });
    await blocker.connect();
    const blockedQuery = blocker.query('UPDATE inventory_items SET qty = qty - 1 WHERE sku_id = 847;');
    blockedQuery.catch(() => {});
    await sleep(1600);

    pool = makePool(PG);
    const fallback = tc.newTraceId();   // deliberately WRONG — must not be used
    const results = await pollAndReport(pool, { host: 'localhost', port: TEST_PORT, apiKey: TEST_API_KEY }, fallback);
    const r = results.find(x => x.observation.blockedPid === blocker.processID);

    const recoveredOwn = !!r && r.traceId === blockedTrace;
    const usedRealNotFallback = !!r && r.traceId !== fallback && r.attributed === true;
    const namedBlocker = !!r && r.observation.blockingTraceId === holderTrace;

    // And the span really landed under the recovered trace id in VITALIS.
    const trace = await req({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${blockedTrace}`, method: 'GET' });
    const landedUnderRealTrace = (trace.data.hops || []).length > 0;
    const candidateText = JSON.stringify((trace.data.candidates || [])[0] || {});
    const blockerNamedInEvidence = candidateText.includes(holderTrace);

    report.gates.liveTraceRecoveredFromDatabase =
      (recoveredOwn && usedRealNotFallback && namedBlocker && landedUnderRealTrace) ? 'PASS' : 'FAIL';
    console.log(`> Blocked session stamped   : ${blockedTrace}`);
    console.log(`> Adapter recovered         : ${r && r.traceId}  (matches: ${recoveredOwn})`);
    console.log(`> Caller's fallback id      : ${fallback}  (correctly NOT used: ${usedRealNotFallback})`);
    console.log(`> Blocking request named    : ${r && r.observation.blockingTraceId}  (matches holder: ${namedBlocker})`);
    console.log(`> Span landed under the real trace in VITALIS: ${landedUnderRealTrace}`);
    console.log(`> Blocking request cited in the RCA evidence: ${blockerNamedInEvidence}`);
    console.log(`RESULT GATE P4: [${report.gates.liveTraceRecoveredFromDatabase}]\n`);
    report.recovered = { blockedTrace, holderTrace, adapterRecovered: r && r.traceId };

    await holder.query('ROLLBACK');
    await blockedQuery.catch(() => {});

    // ---------------- P5: no propagation -> honestly unattributed ----------------
    console.log('--- [GATE P5] LIVE: a session that propagates nothing is UNATTRIBUTED ---');
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM inventory_items WHERE sku_id = 847 FOR UPDATE;');

    unattributed = new Client({ ...PG, application_name: 'legacy-batch-job' });   // no trace id at all
    await unattributed.connect();
    const q2 = unattributed.query('UPDATE inventory_items SET qty = qty - 1 WHERE sku_id = 847;');
    q2.catch(() => {});
    await sleep(1600);

    const obs = await observeOnce(pool);
    const bare = obs.find(o => o.blockedPid === unattributed.processID);
    const honest = !!bare && bare.traceId === undefined;
    // It still reports the lock — observable, just not attributable.
    const stillObserved = !!bare && bare.lockWaitMs > 0 && bare.blockingPid === holder.processID;
    report.gates.unpropagatedSessionReportedUnattributed = (honest && stillObserved) ? 'PASS' : 'FAIL';
    console.log(`> Session application_name  : "legacy-batch-job" (no trace id)`);
    console.log(`> Recovered trace id        : ${bare && bare.traceId} (must be undefined, not invented)`);
    console.log(`> Lock still observed anyway: ${stillObserved} (waited ${bare && Math.round(bare.lockWaitMs)}ms)`);
    console.log(`RESULT GATE P5: [${report.gates.unpropagatedSessionReportedUnattributed}]\n`);

    await holder.query('ROLLBACK');
    await q2.catch(() => {});

  } finally {
    for (const c of [holder, blocker, unattributed]) { try { if (c) await c.end(); } catch (e) {} }
    try { if (pool) await pool.end(); } catch (e) {}
    await stopServer();
    console.log('[CLEANUP] Locks released, connections closed, server stopped.\n');
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 8 PROPAGATION GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log('==================================================================');

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage8-propagation-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
