'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const journal = require('../engine/storage/trace_journal');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-journal-test-'));
process.env.VITALIS_DATA_DIR = dir;
process.env.VITALIS_API_KEY = 'journal-test';
delete process.env.VITALIS_BUILD_INVENTORY;
const { startServer, stopServer, VitalisIngestEngine } = require('../server');
const headers = { 'x-vitalis-api-key': 'journal-test', 'content-type': 'application/json' };
const base = 'http://127.0.0.1:4362';
const file = path.join(dir, 'ingest-journal.ndjson');
const checks = [];
const payload = (id, duration = 10) => ({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'storage-proof' } }] },
  scopeSpans: [{ spans: [{ traceId: id.repeat(32), spanId: '1'.repeat(16), kind: 2, name: 'GET /proof',
    startTimeUnixNano: '1789039155000000000', endTimeUnixNano: String(1789039155000000000n + BigInt(duration) * 1000000n) }] }] }] });
const post = p => fetch(base + '/v1/traces', { method: 'POST', headers, body: JSON.stringify(p) });
const get = id => fetch(base + '/api/investigations/' + id.repeat(32), { headers });
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
async function main() {
  await startServer(4362, '127.0.0.1');
  try {
    await test('Real journal open failure returns 503 without publishing the batch', async () => {
      fs.mkdirSync(file); // An actual EISDIR failure in this disposable test directory.
      const r = await post(payload('a')); assert.equal(r.status, 503);
      assert.equal((await r.json()).status, 'EVIDENCE_WRITE_FAILED'); assert.equal((await get('a')).status, 404);
      fs.rmdirSync(file); // Empty directory created above; no recursive removal.
    });
    await test('Successful retry is framed and visible only after durable append', async () => {
      assert.equal((await post(payload('a'))).status, 200); assert.equal((await get('a')).status, 200);
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 1); assert.equal(journal.decodeLine(lines[0]).length, 1);
    });
    await test('Malformed identity later in a batch cannot partially commit earlier spans', async () => {
      const p = payload('f'); p.resourceSpans[0].scopeSpans[0].spans.push({ spanId: 'missing-trace' });
      const before = fs.readFileSync(file);
      assert.equal((await post(p)).status, 400); assert.equal((await get('f')).status, 404);
      assert.deepEqual(fs.readFileSync(file), before);
    });
    await test('Partial write ENOSPC rolls back bytes and does not publish new evidence', async () => {
      const before = fs.readFileSync(file);
      const originalOpen = fs.openSync, originalWrite = fs.writeFileSync;
      let target;
      fs.openSync = function (p, ...args) { const fd = originalOpen.call(fs, p, ...args); if (p === file) target = fd; return fd; };
      fs.writeFileSync = function (fd, body, ...args) {
        if (fd === target) {
          originalWrite.call(fs, fd, Buffer.from(body).subarray(0, 12));
          const e = Error('Injected ENOSPC after partial write'); e.code = 'ENOSPC'; throw e;
        }
        return originalWrite.call(fs, fd, body, ...args);
      };
      try { assert.equal((await post(payload('b'))).status, 503); }
      finally { fs.openSync = originalOpen; fs.writeFileSync = originalWrite; }
      assert.deepEqual(fs.readFileSync(file), before); assert.equal((await get('b')).status, 404);
    });
    await test('Failed snapshot replacement preserves the previous readable snapshot', () => {
      const snapshot = path.join(dir, 'snapshot-proof.json'); journal.writeSnapshot(snapshot, { old: true });
      const rename = fs.renameSync;
      fs.renameSync = function (a, b) { if (b === snapshot) throw Error('Injected replacement failure'); return rename.call(fs, a, b); };
      try { assert.throws(() => journal.writeSnapshot(snapshot, { new: true }), /replacement failure/); }
      finally { fs.renameSync = rename; }
      assert.deepEqual(JSON.parse(fs.readFileSync(snapshot)), { old: true });
    });
    await test('fsync failure refuses acknowledgment and rolls back the uncommitted batch', async () => {
      const before = fs.readFileSync(file), sync = fs.fsyncSync; let fail = true;
      fs.fsyncSync = function (fd) { if (fail) { fail = false; throw Error('Injected fsync failure'); } return sync.call(fs, fd); };
      try { assert.equal((await post(payload('e'))).status, 503); }
      finally { fs.fsyncSync = sync; }
      assert.deepEqual(fs.readFileSync(file), before); assert.equal((await get('e')).status, 404);
    });
    await test('Restart retains conflicts; D2 preserves torn evidence and blocks further writes', async () => {
      assert.equal((await post(payload('a', 20))).status, 200);
      fs.appendFileSync(file, '{"journalVersion":1,"entries":[{"traceId":"unacknowledged');
      const restored = new VitalisIngestEngine();
      assert.equal(restored.traces.get('a'.repeat(32)).length, 2);
      assert.equal(restored.traces.has('unacknowledged'), false);
      // D2 intentionally tightens D1: do not append/compact damaged evidence.
      const damaged = fs.readFileSync(file);
      assert.equal((await post(payload('c'))).status, 503);
      assert.equal(new VitalisIngestEngine().traces.has('c'.repeat(32)), false);
      assert.deepEqual(fs.readFileSync(file), damaged);
    });
  } finally { await stopServer(); }

  await test('Acknowledged batch survives forced process termination before snapshot', async () => {
    const childDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-journal-kill-'));
    const entry = path.join(__dirname, '..', 'server.js');
    const childCode = `const { startServer } = require(${JSON.stringify(entry)}); startServer(4363,'127.0.0.1').then(()=>process.send('ready'));`;
    const boot = async () => {
      const p = spawn(process.execPath, ['-e', childCode], { env: { ...process.env, VITALIS_DATA_DIR: childDir }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let err = ''; p.stderr.on('data', b => { err += b; });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { p.kill(); reject(Error('Child did not start: ' + err)); }, 10000);
        p.once('message', () => { clearTimeout(timer); resolve(); });
        p.once('error', e => { clearTimeout(timer); reject(e); });
      }); return p;
    };
    const kill = p => new Promise(resolve => { p.once('exit', resolve); p.kill('SIGKILL'); });
    let child = await boot();
    try {
      const r = await fetch('http://127.0.0.1:4363/v1/traces', { method: 'POST', headers, body: JSON.stringify(payload('d')) });
      assert.equal(r.status, 200);
      assert.equal(fs.existsSync(path.join(childDir, 'traces.json')), false, 'Kill test must exercise journal recovery before snapshot');
      await kill(child); child = await boot();
      const recovered = await fetch('http://127.0.0.1:4363/api/investigations/' + 'd'.repeat(32), { headers });
      assert.equal(recovered.status, 200); assert.equal((await recovered.json()).timing.valueMs, 10);
    } finally { if (child.exitCode === null && child.signalCode === null) await kill(child); }
  });
  fs.mkdirSync('artifacts/investigation', { recursive: true });
  fs.writeFileSync('artifacts/investigation/journal-verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks,
    limits: ['Local filesystem/process crash boundary, not replicated durability or certified power-loss recovery', 'D2 adds visible recovery and capacity bounds; automated case-aware purge remains unfinished'] }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
