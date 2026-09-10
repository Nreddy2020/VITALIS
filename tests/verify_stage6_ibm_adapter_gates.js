/**
 * VITALIS STAGE 6 — IBM DB2 / MQ adapters
 *
 * SCOPE, STATED PLAINLY. No DB2 instance and no MQ queue manager was reachable
 * from the environment these adapters were written in. This suite therefore
 * proves exactly two things, and claims nothing beyond them:
 *
 *   1. The old normalizers no longer fabricate. This is fully proven.
 *   2. The raw-telemetry → OTel-span transformation is correct, exercised
 *      against realistically shaped DB2 rows and real MQSC output text.
 *
 * It does NOT prove the live connection to DB2 or MQ. Both adapters ship a
 * selfTest() to run against your own infrastructure for that, and both say so
 * in their headers. The Postgres adapter remains the only one proven
 * end-to-end against a live database.
 *
 *  F1  Db2Adapter no longer invents values for absent telemetry.
 *  F2  MqAdapter no longer invents values — in particular no Math.random()
 *      message id presented as OBSERVED.
 *  D1  DB2 lock-wait rows map to correct observations, and unreported fields
 *      stay undefined.
 *  D2  DB2 saturation/hit-ratio maths is right, including refusing to compute
 *      saturation when MAX_COORDAGENTS is -1 (automatic).
 *  D3  DB2 spans carry only observed attributes and satisfy ADAPTER_CONTRACT.md,
 *      and the RCA engine reads them correctly end-to-end.
 *  M1  Real MQSC output parses into correct queue observations.
 *  M2  A queue with depth and ZERO consumers is FAILED, distinctly from merely busy.
 *  M3  MQ spans carry only observed attributes.
 *
 * Outputs: artifacts/stage6-ibm-adapter-gate-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Db2Adapter } = require('../engine/adapters/db2_adapter');
const { MqAdapter } = require('../engine/adapters/mq_adapter');
const db2 = require('../engine/adapters/db2_live_adapter');
const mq = require('../engine/adapters/mq_live_adapter');

const TEST_API_KEY = 'stage6-ibm-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage6-'));
const { startServer, stopServer } = require('../server');
const TEST_PORT = 4332;

function req(options, postData = null) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': TEST_API_KEY, ...(options.headers || {}) } };
  return new Promise((resolve, reject) => {
    const r = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    r.on('error', reject);
    if (postData) r.write(JSON.stringify(postData));
    r.end();
  });
}

// Real MQSC output shape, as `runmqsc` actually prints it.
const MQSC_QSTATUS = `
5724-H72 (C) Copyright IBM Corp. 1994, 2023.
Starting MQSC for queue manager QM_PAYMENTS_01.

     1 : DISPLAY QSTATUS(DEV.CHECKOUT.IN) TYPE(QUEUE) CURDEPTH IPPROCS OPPROCS LGETDATE LGETTIME
AMQ8450I: Display queue status details.
   QUEUE(DEV.CHECKOUT.IN)                  TYPE(QUEUE)
   CURDEPTH(842)                           IPPROCS(0)
   OPPROCS(3)                              LGETDATE(2026-09-09)
   LGETTIME(04.12.51)
One MQSC command read.
`;

const MQSC_QATTRS = `
     1 : DISPLAY QLOCAL(DEV.CHECKOUT.IN) MAXDEPTH
AMQ8409I: Display Queue details.
   QUEUE(DEV.CHECKOUT.IN)                  TYPE(QLOCAL)
   MAXDEPTH(5000)
One MQSC command read.
`;

async function run() {
  console.log('==================================================================');
  console.log('   VITALIS STAGE 6 — IBM DB2 / MQ ADAPTERS (mapping proven)       ');
  console.log('==================================================================');
  console.log('SCOPE: transformation logic and de-fabrication are proven here.');
  console.log('       The LIVE connection to DB2/MQ is NOT — no instance was');
  console.log('       reachable. Run each adapter\'s selfTest() against your own.\n');

  const report = {
    version: '1.0', testRun: `VITALIS-STAGE6-${Date.now()}`, timestamp: new Date().toISOString(),
    scope: {
      proven: ['de-fabrication of normalizers', 'raw->OTel transformation', 'RCA reads DB2 spans end-to-end'],
      notProven: ['live DB2 connection (ibm_db)', 'live MQ runmqsc execution']
    },
    gates: {}
  };

  await startServer(TEST_PORT);
  try {
    // ---------------- F1: DB2 normalizer no longer fabricates ----------------
    console.log('--- [GATE F1] Db2Adapter invents nothing for absent telemetry ---');
    const emptyDb2 = Db2Adapter.extractEvidence({});
    const txt1 = JSON.stringify(emptyDb2);
    const noInventedSql = !/SELECT \* FROM inventory_items/.test(txt1);
    const noInventedNumbers = !txt1.includes('99.4') && !txt1.includes('142.8') && !txt1.includes('PROD_BANK_DB2') && !txt1.includes('"connectionPoolSaturationPct":22');
    const honestProvenance = emptyDb2.provenance === 'PARTIAL' && emptyDb2.status === 'UNKNOWN';
    const listsMissing = Array.isArray(emptyDb2.unobserved) && emptyDb2.unobserved.length === 3;
    report.gates.db2NormalizerDoesNotFabricate = (noInventedSql && noInventedNumbers && honestProvenance && listsMissing) ? 'PASS' : 'FAIL';
    console.log(`> With empty input: status=${emptyDb2.status}, provenance=${emptyDb2.provenance}, attributes=${JSON.stringify(emptyDb2.attributes)}`);
    console.log(`> Old invented values (fake SQL, 99.4, 142.8, PROD_BANK_DB2, 22) absent: ${noInventedSql && noInventedNumbers}`);
    console.log(`> Unobserved fields named explicitly: ${JSON.stringify(emptyDb2.unobserved)}`);
    console.log(`RESULT GATE F1: [${report.gates.db2NormalizerDoesNotFabricate}]\n`);

    // ---------------- F2: MQ normalizer no longer fabricates ----------------
    console.log('--- [GATE F2] MqAdapter invents nothing — especially not a message id ---');
    const emptyMq = MqAdapter.extractEvidence({});
    const txt2 = JSON.stringify(emptyMq);
    const noFakeMsgId = !/MSG-\d+/.test(txt2) && emptyMq.attributes.messageId === undefined;
    const noFakeQmgr = !txt2.includes('QM_PAYMENTS_01') && !txt2.includes('DEV.CHECKOUT.IN');
    const mqHonest = emptyMq.provenance === 'PARTIAL' && emptyMq.status === 'UNKNOWN';
    // Two calls must not differ: the old version produced a different random id each time.
    const stable = JSON.stringify(MqAdapter.extractEvidence({}).attributes) === JSON.stringify(emptyMq.attributes);
    report.gates.mqNormalizerDoesNotFabricate = (noFakeMsgId && noFakeQmgr && mqHonest && stable) ? 'PASS' : 'FAIL';
    console.log(`> With empty input: status=${emptyMq.status}, provenance=${emptyMq.provenance}, attributes=${JSON.stringify(emptyMq.attributes)}`);
    console.log(`> No randomly generated message id presented as OBSERVED: ${noFakeMsgId}`);
    console.log(`> Two identical calls return identical output (old version did not): ${stable}`);
    console.log(`RESULT GATE F2: [${report.gates.mqNormalizerDoesNotFabricate}]\n`);

    // ---------------- D1: DB2 row mapping ----------------
    console.log('--- [GATE D1] DB2 lock-wait rows map correctly; gaps stay undefined ---');
    const fullRow = {
      BLOCKED_HANDLE: 4711, HOLDING_HANDLE: 8123, LOCK_MODE: 'X', LOCK_OBJECT_TYPE: 'ROW',
      STMT_TEXT: "UPDATE INVENTORY SET QTY = QTY - 1 WHERE SKU_ID = 847 AND REGION = 'EU'",
      TOTAL_ACT_TIME_MS: 3982, LOCK_WAIT_TIME_MS: 2100
    };
    const obsFull = db2.rowToObservation(fullRow, { saturationPct: 98, bufferPoolHitRatioPct: 99.4 });
    const sparseRow = { BLOCKED_HANDLE: 5, HOLDING_HANDLE: 6 };     // DB2 reported nothing else
    const obsSparse = db2.rowToObservation(sparseRow, {});

    const mappedRight = obsFull.holdingHandle === 8123 && obsFull.lockWaitMs === 2100
      && obsFull.executionDurationMs === 3982 && obsFull.connectionPoolSaturationPct === 98;
    const literalsStripped = obsFull.queryFingerprint === "UPDATE INVENTORY SET QTY = QTY - N WHERE SKU_ID = N AND REGION = '?'";
    const gapsUndefined = obsSparse.lockWaitMs === undefined && obsSparse.executionDurationMs === undefined
      && obsSparse.queryFingerprint === undefined && obsSparse.connectionPoolSaturationPct === undefined;
    report.gates.db2RowMapping = (mappedRight && literalsStripped && gapsUndefined) ? 'PASS' : 'FAIL';
    console.log(`> Full row -> ${JSON.stringify(obsFull)}`);
    console.log(`> Literal values stripped from fingerprint: ${literalsStripped}`);
    console.log(`> Sparse row leaves unreported fields undefined: ${gapsUndefined}`);
    console.log(`RESULT GATE D1: [${report.gates.db2RowMapping}]\n`);

    // ---------------- D2: DB2 arithmetic ----------------
    console.log('--- [GATE D2] Saturation and hit-ratio maths, including the -1 case ---');
    const sat = db2.computeSaturationPct({ ACTIVE_CONNECTIONS: 196, MAX_COORDAGENTS: 200 });
    const satAuto = db2.computeSaturationPct({ ACTIVE_CONNECTIONS: 196, MAX_COORDAGENTS: -1 });
    const hit = db2.computeBufferPoolHitRatio({ LOGICAL_READS: 1000, PHYSICAL_READS: 6 });
    const hitNone = db2.computeBufferPoolHitRatio({ LOGICAL_READS: 0, PHYSICAL_READS: 0 });
    const ok = sat === 98 && satAuto === undefined && hit === 99.4 && hitNone === undefined;
    report.gates.db2Arithmetic = ok ? 'PASS' : 'FAIL';
    console.log(`> 196/200 connections -> ${sat}%`);
    console.log(`> MAX_COORDAGENTS=-1 (automatic) -> ${satAuto} (must be undefined, not a number)`);
    console.log(`> 1000 logical / 6 physical reads -> ${hit}% hit ratio; no reads -> ${hitNone}`);
    console.log(`RESULT GATE D2: [${report.gates.db2Arithmetic}]\n`);

    // ---------------- D3: DB2 span -> RCA end to end ----------------
    console.log('--- [GATE D3] DB2 span satisfies the contract and the RCA engine reads it ---');
    const span = db2.toOtelSpan('TX-STAGE6-DB2', obsFull, obsFull.executionDurationMs);
    const keys = span.scopeSpans[0].spans[0].attributes.map(a => a.key);
    const hasContract = ['db.system', 'db.holding_lock_pid', 'db.lock_wait_ms', 'db.connection_pool.saturation_pct', 'db.query.fingerprint']
      .every(k => keys.includes(k));
    // CPU is deliberately not reported by this adapter.
    const noCpu = !keys.includes('db.cpu_utilization_pct');

    const sparseSpan = db2.toOtelSpan('TX-STAGE6-DB2-SPARSE', obsSparse, 0);
    const sparseKeys = sparseSpan.scopeSpans[0].spans[0].attributes.map(a => a.key);
    const sparseOmits = !sparseKeys.includes('db.lock_wait_ms') && !sparseKeys.includes('db.query.fingerprint');

    await req({ hostname: 'localhost', port: TEST_PORT, path: '/v1/traces', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { resourceSpans: [span] });
    const evaluated = await req({ hostname: 'localhost', port: TEST_PORT, path: '/api/traces/TX-STAGE6-DB2', method: 'GET' });
    const cand = (evaluated.data.candidates || [])[0];
    const candText = JSON.stringify(cand || {});
    const rcaReadsIt = !!cand && candText.includes('2100') && candText.includes('#8123') && /UNKNOWN/.test(candText);

    report.gates.db2SpanEndToEnd = (hasContract && noCpu && sparseOmits && rcaReadsIt) ? 'PASS' : 'FAIL';
    console.log(`> Span attributes: ${JSON.stringify(keys)}`);
    console.log(`> Contract keys present: ${hasContract}; CPU correctly not claimed: ${noCpu}`);
    console.log(`> Sparse observation omits unreported keys entirely: ${sparseOmits}`);
    console.log(`> RCA cites real lock wait 2100ms and holder #8123, CPU as UNKNOWN: ${rcaReadsIt}`);
    console.log(`RESULT GATE D3: [${report.gates.db2SpanEndToEnd}]\n`);

    // ---------------- M1: MQSC parsing ----------------
    console.log('--- [GATE M1] Real MQSC output parses correctly ---');
    const qobs = mq.parseQueueStatus(MQSC_QSTATUS, MQSC_QATTRS, { queueManager: 'QM_PAYMENTS_01' });
    const parsedRight = qobs.queueName === 'DEV.CHECKOUT.IN' && qobs.queueDepth === 842
      && qobs.maxQueueDepth === 5000 && qobs.depthSaturationPct === 17
      && qobs.openInputCount === 0 && qobs.openOutputCount === 3;
    const noMaxObs = mq.parseQueueStatus(MQSC_QSTATUS, '', { queueManager: 'QM_PAYMENTS_01' });
    const honestWithoutMax = noMaxObs.maxQueueDepth === undefined && noMaxObs.depthSaturationPct === undefined;
    report.gates.mqscParsing = (parsedRight && honestWithoutMax) ? 'PASS' : 'FAIL';
    console.log(`> Parsed: ${JSON.stringify(qobs)}`);
    console.log(`> Without MAXDEPTH, saturation is undefined rather than guessed: ${honestWithoutMax}`);
    console.log(`RESULT GATE M1: [${report.gates.mqscParsing}]\n`);

    // ---------------- M2: no-consumer detection ----------------
    console.log('--- [GATE M2] Depth with zero consumers is FAILED, not merely busy ---');
    const stuck = mq.assessQueue(qobs);                                    // IPPROCS(0), 842 messages
    const busy = mq.assessQueue({ queueDepth: 4200, maxQueueDepth: 5000, openInputCount: 4, depthSaturationPct: 84 });
    const healthy = mq.assessQueue({ queueDepth: 3, maxQueueDepth: 5000, openInputCount: 2, depthSaturationPct: 0 });
    const unknown = mq.assessQueue({});
    const distinguishes = stuck.status === 'FAILED' && /zero open input handles/.test(stuck.reason)
      && busy.status === 'DEGRADED' && healthy.status === 'SUCCESS' && unknown.status === 'UNKNOWN';
    report.gates.mqNoConsumerDetection = distinguishes ? 'PASS' : 'FAIL';
    console.log(`> 842 msgs, 0 consumers -> ${stuck.status}: ${stuck.reason}`);
    console.log(`> 4200/5000 with 4 consumers -> ${busy.status}: ${busy.reason}`);
    console.log(`> Depth not reported -> ${unknown.status}: ${unknown.reason}`);
    console.log(`RESULT GATE M2: [${report.gates.mqNoConsumerDetection}]\n`);

    // ---------------- M3: MQ span ----------------
    console.log('--- [GATE M3] MQ spans carry only observed attributes ---');
    const mqSpan = mq.toOtelSpan('TX-STAGE6-MQ', qobs, stuck, 0);
    const mqKeys = mqSpan.scopeSpans[0].spans[0].attributes.map(a => a.key);
    const mqHasReal = ['messaging.system', 'messaging.destination.name', 'messaging.ibmmq.queue_depth', 'messaging.ibmmq.open_input_count']
      .every(k => mqKeys.includes(k));
    const bareSpan = mq.toOtelSpan('TX-BARE', { queueName: 'Q1' }, { status: 'UNKNOWN' }, 0);
    const bareKeys = bareSpan.scopeSpans[0].spans[0].attributes.map(a => a.key);
    const bareOmits = !bareKeys.includes('messaging.ibmmq.queue_depth') && !bareKeys.includes('messaging.ibmmq.max_queue_depth');
    report.gates.mqSpanShape = (mqHasReal && bareOmits) ? 'PASS' : 'FAIL';
    console.log(`> Span attributes: ${JSON.stringify(mqKeys)}`);
    console.log(`> A bare observation omits unreported depth keys: ${bareOmits}`);
    console.log(`RESULT GATE M3: [${report.gates.mqSpanShape}]\n`);

  } finally {
    await stopServer();
    console.log('[CLEANUP] Test server stopped.\n');
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log('==================================================================');
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 6 IBM ADAPTER GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log('REMINDER: live DB2/MQ connectivity remains UNVERIFIED — run each');
  console.log('          adapter\'s selfTest() against your own infrastructure.');
  console.log('==================================================================');

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage6-ibm-adapter-gate-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
