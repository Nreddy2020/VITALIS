'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const checks = [];
const entry = path.resolve(__dirname, '../server.js');
const key = 'storage-policy-test';
const headers = { 'x-vitalis-api-key': key, 'content-type': 'application/json' };
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-storage-policy-'));
const payload = (id, sid = '1') => ({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'storage-test' } }] }, scopeSpans: [{ spans: [
  { traceId: id.repeat(32), spanId: sid.repeat(16), kind: 2, name: 'GET /check', startTimeUnixNano: '1789039155000000000', endTimeUnixNano: '1789039155010000000' }
] }] }] });
async function boot(dir, env = {}) {
  const code = `const s=require(${JSON.stringify(entry)});s.startServer(0,'127.0.0.1').then(server=>process.send({ok:true,port:server.address().port})).catch(e=>{process.send({ok:false,code:e.code,message:e.message});process.exitCode=1;});process.on('message',m=>{if(m==='stop')s.stopServer().then(()=>process.exit());});`;
  const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, VITALIS_DATA_DIR: dir, VITALIS_API_KEY: key, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = ''; child.stderr.on('data', b => { errors += b; });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Server startup timed out: ' + errors)); }, 10000);
    child.once('message', m => { clearTimeout(timer); resolve(m); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); if (code && !child.connected) reject(Error('Server exited before readiness: ' + errors)); });
  });
  return { child, ...ready, base: ready.port ? 'http://127.0.0.1:' + ready.port : null };
}
async function stop(s, hard = false) {
  if (s.child.exitCode !== null || s.child.signalCode !== null) return;
  const done = new Promise(resolve => s.child.once('exit', resolve));
  if (hard || !s.ok) s.child.kill('SIGKILL'); else s.child.send('stop');
  await done;
}
const post = (s, p, route = '/v1/traces') => fetch(s.base + route, { method: 'POST', headers, body: JSON.stringify(p) });
const get = async (s, route) => (await fetch(s.base + route, { headers })).json();
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
async function main() {
  await test('Actual second writer is rejected; first remains usable; crash releases OS lock', async () => {
    const dir = fresh(); let first = await boot(dir), second;
    try {
      assert.equal(first.ok, true); assert.equal((await post(first, payload('a'))).status, 200);
      second = await boot(dir); assert.equal(second.ok, false); assert.equal(second.code, 'STORAGE_WRITER_LOCKED'); await stop(second);
      assert.equal((await post(first, payload('b'))).status, 200);
      await stop(first, true); first = await boot(dir); assert.equal(first.ok, true);
      assert.equal((await get(first, '/api/traces')).traceCount, 2);
    } finally { await stop(first); if (second) await stop(second); }
    const reopened = await boot(dir); assert.equal(reopened.ok, true); await stop(reopened);
  });
  for (const mode of ['middle', 'tail', 'snapshot', 'oversized']) {
    await test(`Actual ${mode} damage is visible, source bytes preserved and writes blocked`, async () => {
      const dir = fresh(), file = path.join(dir, mode === 'snapshot' || mode === 'oversized' ? 'traces.json' : 'ingest-journal.ndjson');
      const span = { spanId: '1'.repeat(16), kind: 2, service: 'fixture', name: 'readable', startTimeUnixNano: '1789039155000000000', endTimeUnixNano: '1789039155010000000' };
      const frame = JSON.stringify({ journalVersion: 1, entries: [{ traceId: 'c'.repeat(32), span }] });
      if (mode === 'middle') fs.writeFileSync(file, frame + '\n{broken}\n' + frame + '\n');
      if (mode === 'tail') fs.writeFileSync(file, frame + '\n{"unfinished');
      if (mode === 'snapshot') { fs.writeFileSync(file, '{broken'); fs.writeFileSync(path.join(dir, 'ingest-journal.ndjson'), frame + '\n'); }
      if (mode === 'oversized') fs.writeFileSync(file, ' '.repeat(1025));
      const before = digest(file), s = await boot(dir, mode === 'oversized' ? { VITALIS_MAX_TRACE_BYTES: '1024' } : {});
      try {
        assert.equal(s.ok, true);
        assert.equal((await fetch(s.base + '/api/storage')).status, 401);
        const health = await get(s, '/api/storage'); assert.equal(health.state, 'RECOVERY_REQUIRED'); assert.ok(health.recovery.issueCount > 0);
        assert.equal((await post(s, payload('d'))).status, 503);
        if (mode !== 'oversized') assert.equal((await get(s, '/api/traces')).traceCount, 1, 'Intact evidence remains visible');
      } finally { await stop(s); }
      assert.equal(digest(file), before, 'Neither shutdown nor rejected writes may overwrite source damage');
    });
  }
  const cases = [
    ['traces', { VITALIS_MAX_TRACES: '1' }, payload('b')],
    ['spans', { VITALIS_MAX_SPANS: '1' }, payload('a', '2')],
    ['traceBytes', { VITALIS_MAX_TRACE_BYTES: '600' }, payload('b')],
    ['journalBytes', { VITALIS_MAX_JOURNAL_BYTES: '600' }, payload('b')],
    ['diskBytes', { VITALIS_MAX_STORAGE_BYTES: '1500' }, payload('b')]
  ];
  for (const [limit, env, next] of cases) {
    await test(`HTTP ${limit} quota rejects a complete batch without partial publication`, async () => {
      const dir = fresh(); const s = await boot(dir, env);
      try {
        assert.equal((await post(s, payload('a'))).status, 200, 'Initial batch fits');
        const r = await post(s, next); assert.equal(r.status, 503);
        const detail = await r.json(); assert.equal(detail.status, 'STORAGE_CAPACITY_EXCEEDED'); assert.equal(detail.details.limit, limit);
        const health = await get(s, '/api/storage'); assert.equal(health.usage.traces, 1); assert.equal(health.usage.spans, 1); assert.equal(health.lastRejection.limit, limit);
      } finally { await stop(s); }
      if (['traces', 'spans', 'traceBytes'].includes(limit)) {
        const reopened = await boot(dir, env);
        try { assert.equal((await post(reopened, next)).status, 503); assert.equal((await get(reopened, '/api/storage')).usage.spans, 1); }
        finally { await stop(reopened); }
      }
    });
  }
  await test('Auxiliary resource record and byte caps apply before memory/correlation publication', async () => {
    const s = await boot(fresh(), { VITALIS_MAX_AUX_RECORDS: '1', VITALIS_MAX_AUX_BYTES: '300' });
    try {
      assert.equal((await post(s, { resourceMetrics: [{ value: 'one' }] }, '/v1/metrics')).status, 200);
      assert.equal((await post(s, { resourceLogs: [{ value: 'two' }] }, '/v1/logs')).status, 503);
      const r = await post(s, { changeEvents: [{ id: 'large-change', timestamp: new Date().toISOString(), description: 'x'.repeat(1000) }] }, '/v1/changes');
      assert.equal(r.status, 503); assert.equal((await get(s, '/api/overview')).coverage.changeEventsKnown, 0);
      assert.equal((await get(s, '/api/storage')).usage.auxiliaryRecords, 1);
    } finally { await stop(s); }
  });
  await test('Expired and unknown-age evidence remain held across restart; no purge action exists', async () => {
    const dir = fresh(); let s = await boot(dir, { VITALIS_RETENTION_MS: '1' });
    try {
      assert.equal((await post(s, payload('a'))).status, 200); await stop(s); s = await boot(dir, { VITALIS_RETENTION_MS: '1' });
      const health = await get(s, '/api/storage'); assert.equal(health.retention.reviewRequiredTraces, 1);
      assert.equal(health.retention.deletionEnabled, false); assert.equal(health.usage.traces, 1);
      assert.equal((await post(s, {}, '/api/storage/purge')).status, 404);
    } finally { await stop(s); }
    const file = path.join(dir, 'traces.json'), snapshot = JSON.parse(fs.readFileSync(file));
    delete snapshot['a'.repeat(32)][0].receivedAt; fs.writeFileSync(file, JSON.stringify(snapshot));
    s = await boot(dir, { VITALIS_RETENTION_MS: '1' });
    try { assert.equal((await get(s, '/api/storage')).retention.unknownAgeTraces, 1); }
    finally { await stop(s); }
  });
  fs.mkdirSync('artifacts/storage-d2', { recursive: true });
  fs.writeFileSync('artifacts/storage-d2/verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks,
    limits: ['Local filesystem/process locking only', 'Retention holds data; automatic purge and case-aware deletion are not implemented', 'Metrics/logs bounded in memory and remain non-durable'] }, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { boot, stop, post, get, fresh, payload, headers };
