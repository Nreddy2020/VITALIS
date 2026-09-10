'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { stop, get, post, fresh, headers } = require('./verify_storage_policy');
const TRACE_COUNT = 200, SPANS = 10, CONCURRENCY = 10;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? null;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { requests: sorted.length, p50Ms: quantile(sorted, .5), p95Ms: quantile(sorted, .95), p99Ms: quantile(sorted, .99), maxMs: sorted.at(-1) };
}
async function phase(count, task) {
  let next = 0; const latencies = [], results = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < count) {
      const index = next++, begin = performance.now(); results[index] = await task(index); latencies.push(performance.now() - begin);
    }
  }));
  const elapsedMs = performance.now() - started;
  return { ...stats(latencies), elapsedMs, completedPerSecond: count * 1000 / elapsedMs, results };
}
function payload(index) {
  return { resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'capacity-fixture' } }] }, scopeSpans: [{ spans:
    Array.from({ length: SPANS }, (_, i) => ({ traceId: (index + 1).toString(16).padStart(32, '0'), spanId: (i + 1).toString(16).padStart(16, '0'),
      parentSpanId: i ? '1'.padStart(16, '0') : undefined, kind: i ? 1 : 2, name: i ? 'internal-step' : 'GET /synthetic-capacity',
      startTimeUnixNano: '1789039155000000000', endTimeUnixNano: '1789039155010000000',
      attributes: [{ key: 'http.status_code', value: { intValue: 200 } }] })) }] }] };
}
async function boot(dir) {
  const entry = path.resolve('server.js');
  const code = `const s=require(${JSON.stringify(entry)});let sampledMaxRss=0,sampledMaxHeap=0,samples=0;function sample(){const m=process.memoryUsage();sampledMaxRss=Math.max(sampledMaxRss,m.rss);sampledMaxHeap=Math.max(sampledMaxHeap,m.heapUsed);samples++;return m;}const timer=setInterval(sample,50);timer.unref();s.startServer(0,'127.0.0.1').then(server=>process.send({ok:true,port:server.address().port})).catch(e=>{process.send({ok:false,code:e.code});process.exitCode=1;});process.on('message',m=>{if(m==='stop')s.stopServer().then(()=>process.exit());if(m==='measure')process.send({measurement:{current:sample(),sampledMaxRss,sampledMaxHeap,samples,cpuMicroseconds:process.cpuUsage()}});});`;
  const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, VITALIS_API_KEY: headers['x-vitalis-api-key'], VITALIS_DATA_DIR: dir,
    VITALIS_MAX_TRACES: String(TRACE_COUNT), VITALIS_MAX_SPANS: String(TRACE_COUNT * SPANS), VITALIS_RATE_LIMIT_PER_MIN: '2000', VITALIS_DURABLE_INGEST: 'true' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', buffer => { stderr += buffer; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Capacity child startup timeout: ' + stderr)); }, 10000);
    child.once('message', message => { clearTimeout(timer); resolve(message); }); child.once('error', reject);
  });
  assert.equal(ready.ok, true); return { child, ...ready, base: 'http://127.0.0.1:' + ready.port };
}
async function memory(server) {
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Memory IPC timeout')), 10000);
    server.child.once('message', message => { clearTimeout(timer); resolve(message.measurement); });
  }); server.child.send('measure'); return ready;
}
async function inventory(server) {
  const revisions = [];
  for (let offset = 0; offset < TRACE_COUNT; offset += 100) {
    const page = await get(server, '/api/investigations?limit=100&offset=' + offset);
    assert.equal(page.total, TRACE_COUNT); revisions.push(...page.items.map(item => [item.traceId, item.revision]));
  }
  return revisions;
}
async function main() {
  const dir = fresh(); let server = await boot(dir);
  const out = path.resolve('artifacts/storage-d4'); fs.mkdirSync(out, { recursive: true });
  const report = { status: 'RUNNING', runAt: new Date().toISOString(), workload: { type: 'SYNTHETIC_LOCAL_HTTP', traceBatches: TRACE_COUNT, spansPerBatch: SPANS,
    concurrency: CONCURRENCY, durable: true, payloadBytesPerBatch: Buffer.byteLength(JSON.stringify(payload(0))) },
    environment: { node: process.version, platform: process.platform, osRelease: os.release(), cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, hostMemoryBytes: os.totalmem() },
    disposableStore: dir, phases: {} };
  try {
    report.memoryBefore = await memory(server); report.limits = (await get(server, '/api/storage')).limits;
    report.phases.ingest = await phase(TRACE_COUNT, async index => {
      const response = await post(server, payload(index)); assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.ingestedSpans, SPANS); return { status: response.status, ingested: result.ingestedSpans };
    });
    console.log('Ingest measurement:', JSON.stringify({ ...report.phases.ingest, results: undefined }));
    const before = await get(server, '/api/storage'); assert.equal(before.usage.traces, TRACE_COUNT); assert.equal(before.usage.spans, TRACE_COUNT * SPANS);
    const revisions = await inventory(server);
    report.phases.retryAtQuota = await phase(TRACE_COUNT, async index => {
      const response = await post(server, payload(index)); assert.equal(response.status, 200);
      const result = await response.json(); assert.equal(result.ingestedSpans, 0); assert.equal(result.duplicateSpans, SPANS); return { status: response.status, duplicates: result.duplicateSpans };
    });
    const rejected = await post(server, payload(TRACE_COUNT)); assert.equal(rejected.status, 503); report.quotaRejection = await rejected.json();
    assert.equal(report.quotaRejection.status, 'STORAGE_CAPACITY_EXCEEDED'); assert.equal(report.quotaRejection.details.limit, 'traces');
    report.phases.investigationRead = await phase(20, async index => {
      const page = await get(server, '/api/investigations?limit=100&offset=' + (index % 2 ? 100 : 0)); assert.equal(page.total, TRACE_COUNT); assert.equal(page.items.length, 100); return { items: page.items.length };
    });
    report.memoryAfter = await memory(server); report.storageBeforeCrash = await get(server, '/api/storage');
    const readTrace = async index => {
      const id = (index + 1).toString(16).padStart(32, '0'); const trace = await get(server, '/api/traces/' + id); return trace.hops;
    };
    const evidenceBefore = (await phase(TRACE_COUNT, readTrace)).results;
    const evidenceHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    report.evidenceBeforeCrashSha256 = evidenceHash(evidenceBefore);
    const crashAt = performance.now(); await stop(server, true); server = await boot(dir); report.restartMs = performance.now() - crashAt;
    assert.deepEqual(await inventory(server), revisions);
    const evidenceAfter = (await phase(TRACE_COUNT, readTrace)).results;
    assert.deepEqual(evidenceAfter, evidenceBefore); report.evidenceAfterCrashSha256 = evidenceHash(evidenceAfter);
    report.storageAfterCrash = await get(server, '/api/storage'); assert.equal(report.storageAfterCrash.usage.spans, TRACE_COUNT * SPANS);
    report.correctness = { acknowledgedSpans: TRACE_COUNT * SPANS, retainedSpans: report.storageAfterCrash.usage.spans, acknowledgedLoss: 0,
      retriesAddedSpans: 0, revisionsIdenticalAfterRestart: true, completeRetainedEvidenceIdentical: true, newTraceAtQuotaRejected: true };
    report.status = 'PASS'; report.limitations = ['One bounded synthetic local run; no production SLO or sustained-load capacity established',
      'Client latency includes queueing/network/parsing; sampled memory is not an exact peak or leak test', 'Forced process exit, not host power loss; no physical disk-full test',
      'Authentication is local API key; no tenant isolation or vendor connector tested'];
    console.log('PASS D4: 2000 acknowledged spans recovered, exact retries add zero; report:', out);
  } catch (error) { report.status = 'FAIL'; report.error = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(out, 'capacity-report.json'), JSON.stringify(report, null, 2)); await stop(server); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
