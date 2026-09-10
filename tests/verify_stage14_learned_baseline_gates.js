/**
 * VITALIS STAGE 14 — Learned request baselines
 *
 * The defect this stage fixes sat at the centre of the product.
 *
 * `initGoldenPath()` created ONE hardcoded baseline —
 * `Client->F5-LB->IHS->WebSphere->IBM-MQ->DB2->Stripe`, 180ms — and every real
 * ingested trace was compared against it. A real FastAPI request produced:
 *
 *   "Structural Deviation: Expected [Client->F5-LB->IHS->WebSphere->IBM-MQ->
 *    DB2->Stripe], observed [ledger-api->ledger-api->ledger-api->ledger-api]"
 *
 * 100% of real traffic flagged as deviating, against fiction, with a message
 * telling the operator their request should have gone through WebSphere. The
 * fourth instance of the IBM drift (`01` §9, `19`, `21`) — this time in the
 * core loop rather than at an edge.
 *
 *  B1  With no baseline the verdict is UNKNOWN — never HEALTHY, never DEVIATION.
 *  B2  After enough healthy observations a baseline is LEARNED and normal
 *      traffic reads HEALTHY.
 *  B3  A latency outlier is a DEVIATION, with the percentile evidence shown.
 *  B4  A structural change (a hop that vanishes) is a DEVIATION.
 *  B5  Degraded and errored traces are NOT learned from — the baseline must not
 *      absorb the outage it exists to detect.
 *  B6  Request identity is STABLE when a hop gets slow.
 *  B7  Two different requests never share a baseline.
 *  B8  Baselines are rebuilt from persisted traces after a restart.
 *  B9  A trace carrying many request roots is a BATCH — never learned from,
 *      never given a request-level verdict. Shape taken from real telemetry.
 *
 * Outputs: artifacts/stage14-baseline-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BaselineLearner, requestKey } = require('../engine/baseline_learner');

const report = { suite: 'stage14-learned-baseline', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}

/** A realistic 3-hop request: root HTTP span, an auth hop, a DB hop. */
function trace(i, { dbMs = 20, status = 'OK', dropDb = false } = {}) {
  const hops = [
    { spanId: `r${i}`, service: 'orders-api', name: 'GET /orders/{id}', durationMs: 60, observedAt: 1000 + i, status: 'OK' },
    { spanId: `a${i}`, parentSpanId: `r${i}`, service: 'orders-api', name: 'verify-token', durationMs: 10, observedAt: 1001 + i, status: 'OK' }
  ];
  if (!dropDb) {
    hops.push({ spanId: `d${i}`, parentSpanId: `r${i}`, service: 'postgres', name: 'SELECT orders', durationMs: dbMs, observedAt: 1002 + i, status });
  }
  return hops;
}

console.log('==================================================================');
console.log('VITALIS STAGE 14 — LEARNED BASELINE GATES');
console.log('==================================================================');

// ---------------------------------------------------------------- B1
{
  const l = new BaselineLearner();
  const first = l.compare(trace(0));
  l.observe(trace(0), 'T0');
  const second = l.compare(trace(1));
  const passed = first.verdict === 'UNKNOWN' && first.baselineSource === 'NONE'
    && second.verdict === 'UNKNOWN' && second.observations === 1
    && /not healthy and not deviating/.test(second.reason);
  report.evidence.B1 = { first, second };
  gate('B1_noBaselineIsUnknown', 'B1 No baseline yields UNKNOWN, never HEALTHY', passed, [
    `first request  : ${first.verdict} (${first.baselineSource})`,
    `after 1 sample : ${second.verdict}, ${second.observations}/${second.minObservations} observations`,
    `reason         : ${second.reason}`
  ]);
}

// ---------------------------------------------------------------- B2
{
  const l = new BaselineLearner();
  for (let i = 0; i < 6; i++) l.observe(trace(i, { dbMs: 18 + i }), `T${i}`);
  const v = l.compare(trace(99, { dbMs: 21 }));
  const passed = v.verdict === 'HEALTHY' && v.baselineSource === 'LEARNED'
    && v.observations === 6 && v.deviations.length === 0;
  report.evidence.B2 = v;
  gate('B2_healthyTrafficReadsHealthy', 'B2 Normal traffic against a learned baseline', passed, [
    `verdict      : ${v.verdict} (${v.baselineSource}, ${v.observations} observations)`,
    `key          : ${v.key}`,
    `p50/p95      : ${v.baseline.p50}ms / ${v.baseline.p95}ms`
  ]);
}

// ---------------------------------------------------------------- B3
{
  const l = new BaselineLearner();
  for (let i = 0; i < 8; i++) l.observe(trace(i, { dbMs: 20 }), `T${i}`);
  const v = l.compare(trace(99, { dbMs: 2800 }));
  const lat = v.deviations.find(d => d.type === 'LATENCY');
  const passed = v.verdict === 'DEVIATION' && !!lat && /p95/.test(lat.evidence);
  report.evidence.B3 = v;
  gate('B3_latencyOutlierIsDeviation', 'B3 A latency outlier is caught, with evidence', passed, [
    `verdict  : ${v.verdict}`,
    `detail   : ${lat && lat.detail}`,
    `evidence : ${lat && lat.evidence}`
  ]);
}

// ---------------------------------------------------------------- B4
{
  const l = new BaselineLearner();
  for (let i = 0; i < 8; i++) l.observe(trace(i), `T${i}`);
  const v = l.compare(trace(99, { dropDb: true }));   // the DB hop vanishes
  const miss = v.deviations.find(d => d.type === 'STRUCTURE_MISSING');
  const passed = v.verdict === 'DEVIATION' && !!miss && /postgres/.test(miss.detail);
  report.evidence.B4 = v;
  gate('B4_missingHopIsDeviation', 'B4 A hop that normally exists but is absent', passed, [
    `verdict  : ${v.verdict}`,
    `detail   : ${miss && miss.detail}`,
    `evidence : ${miss && miss.evidence}`
  ]);
}

// ---------------------------------------------------------------- B5
{
  const l = new BaselineLearner();
  for (let i = 0; i < 8; i++) l.observe(trace(i, { dbMs: 20 }), `T${i}`);
  const healthyP95 = l.get(requestKey(trace(0))).p95;
  // Twenty degraded and errored traces try to teach the baseline that slow is normal.
  for (let i = 100; i < 120; i++) {
    l.observe(trace(i, { dbMs: 3000, status: 'DEGRADED' }), `D${i}`);
    l.observe(trace(i + 500, { dbMs: 3000, status: 'ERROR' }), `E${i}`);
  }
  const after = l.get(requestKey(trace(0)));
  const stillCaught = l.compare(trace(999, { dbMs: 2800 }));
  const passed = after.observations === 8 && after.p95 === healthyP95 && stillCaught.verdict === 'DEVIATION';
  report.evidence.B5 = { healthyP95, after, stillCaught: stillCaught.verdict };
  gate('B5_unhealthyTrafficNotLearned', 'B5 Degraded/errored traffic never enters the baseline', passed, [
    `p95 before 40 bad traces : ${healthyP95}ms`,
    `p95 after                : ${after.p95}ms (unchanged — the outage was not absorbed)`,
    `observations             : ${after.observations} (still only the healthy ones)`,
    `outlier still caught     : ${stillCaught.verdict}`
  ]);
}

// ---------------------------------------------------------------- B6
{
  // The original implementation chose the root as the LONGEST span, so a slow
  // DB hop silently became the request's identity — and the request stopped
  // matching its own baseline at the exact moment it broke.
  const normal = requestKey(trace(1, { dbMs: 20 }));
  const slow = requestKey(trace(2, { dbMs: 9000 }));
  const passed = normal === slow && normal === 'orders-api::GET /orders/{id}';
  report.evidence.B6 = { normal, slow };
  gate('B6_identityStableUnderSlowness', 'B6 Identity does not change when a hop gets slow', passed, [
    `normal request (db 20ms)  : ${normal}`,
    `slow request  (db 9000ms) : ${slow}`,
    `identical                 : ${normal === slow}`
  ]);
}

// ---------------------------------------------------------------- B7
{
  const l = new BaselineLearner();
  for (let i = 0; i < 8; i++) l.observe(trace(i, { dbMs: 20 }), `T${i}`);
  const other = [{ spanId: 'x1', service: 'billing-api', name: 'POST /invoices', durationMs: 900, observedAt: 5000, status: 'OK' }];
  const v = l.compare(other);
  const passed = v.verdict === 'UNKNOWN' && v.key === 'billing-api::POST /invoices' && v.observations === 0;
  report.evidence.B7 = v;
  gate('B7_baselinesAreNotShared', 'B7 A different request gets its own (absent) baseline', passed, [
    `orders-api baseline observations : 8`,
    `billing-api verdict              : ${v.verdict} — ${v.observations} observations of its own`,
    `NOT judged against orders-api    : ${v.key !== 'orders-api::GET /orders/{id}'}`
  ]);
}

// ---------------------------------------------------------------- B8
{
  const persisted = new Map();
  for (let i = 0; i < 7; i++) persisted.set(`T${i}`, trace(i, { dbMs: 20 }));
  const fresh = new BaselineLearner();
  const stats = fresh.rebuildFrom(persisted);
  const v = fresh.compare(trace(99, { dbMs: 2800 }));
  const passed = stats.learned === 7 && stats.keys === 1 && v.verdict === 'DEVIATION';
  report.evidence.B8 = { stats, verdict: v.verdict };
  gate('B8_baselinesSurviveRestart', 'B8 Baselines rebuild from persisted traces', passed, [
    `traces restored : ${stats.tracesConsidered}, learned ${stats.learned}, keys ${stats.keys}`,
    `outlier verdict after restart : ${v.verdict}`
  ]);
}

// ---------------------------------------------------------------- B9
{
  // Shape taken from REAL telemetry: a live FastAPI app sent 16 HTTP requests
  // under ONE trace id — 60 spans, 18 request roots, all parented to a single
  // long-lived span that was never exported. VITALIS collapsed them into one
  // 4-second "request" and would have learned that blob as a baseline sample.
  const batch = [];
  for (let i = 0; i < 18; i++) {
    batch.push({ spanId: `r${i}`, parentSpanId: 'NEVER_INGESTED', service: 'finlife-api',
      name: 'GET /', durationMs: 2, observedAt: 1000 + i, status: 'OK' });
    batch.push({ spanId: `c${i}`, parentSpanId: `r${i}`, service: 'finlife-api',
      name: 'GET / http send', durationMs: 0, observedAt: 1001 + i, status: 'OK' });
  }
  const l = new BaselineLearner();
  for (let i = 0; i < 8; i++) l.observe(trace(i, { dbMs: 20 }), `T${i}`);
  const p95Before = l.get(requestKey(trace(0))).p95;

  const learned = l.observe(batch, 'BATCH');
  const v = l.compare(batch);
  const shape = require('../engine/baseline_learner').traceShape(batch);

  const passed = shape.rootCount === 18
    && learned === null                       // never learned from
    && v.verdict === 'UNKNOWN'
    && /batch, not a request/.test(v.reason)
    && l.get(requestKey(trace(0))).p95 === p95Before;   // baseline untouched
  report.evidence.B9 = { shape: { spanCount: shape.spanCount, rootCount: shape.rootCount }, learned, reason: v.reason };
  gate('B9_multiRootTraceIsNotOneRequest', 'B9 A trace with many roots is a batch, not a request', passed, [
    `spans / roots     : ${shape.spanCount} / ${shape.rootCount}`,
    `learned from it   : ${learned} (must be null — baselines must not absorb a batch)`,
    `verdict           : ${v.verdict}`,
    `unrelated baseline p95 unchanged: ${l.get(requestKey(trace(0))).p95 === p95Before}`
  ]);
}

report.finishedAt = new Date().toISOString();
const allPassed = failures === 0;
console.log('\n==================================================================');
console.log(`OVERALL: ${allPassed ? 'ALL STAGE 14 BASELINE GATES PASSED' : `${failures} GATE(S) FAILED`}`);
console.log('==================================================================');
const dir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'stage14-baseline-gate-report.json'), JSON.stringify(report, null, 2));
process.exit(allPassed ? 0 : 1);
