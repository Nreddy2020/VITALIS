'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { boot, stop, post, get, fresh, payload, headers } = require('./verify_storage_policy');
const checks = [];
const spanOf = p => p.resourceSpans[0].scopeSpans[0].spans[0];
const detail = s => get(s, '/api/traces/' + 'a'.repeat(32));
const investigate = s => get(s, '/api/investigations/' + 'a'.repeat(32));
const bytes = (dir, file) => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file)) : Buffer.alloc(0);
const counts = body => ({ ingestedSpans: body.ingestedSpans, duplicateSpans: body.duplicateSpans, conflictingSpans: body.conflictingSpans });
async function submit(s, p, expected) {
  const response = await post(s, p); assert.equal(response.status, 200);
  const body = await response.json(); if (expected) assert.deepEqual(counts(body), expected);
  return body;
}
const accepted = (n = 1, d = 0, c = 0) => ({ ingestedSpans: n, duplicateSpans: d, conflictingSpans: c });
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }

async function replayCapture(s) {
  const dir = path.resolve('artifacts/mobile-pilot/run-002');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'capture-index.json')));
  const total = accepted(0);
  for (const capture of index) {
    const body = fs.readFileSync(path.join(dir, capture.file));
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'), capture.sha256);
    const response = await fetch(s.base + '/v1/traces', { method: 'POST', headers: { ...headers, 'content-type': capture.contentType }, body });
    assert.equal(response.status, 200); const result = await response.json();
    for (const key of Object.keys(total)) total[key] += result[key];
  }
  return total;
}

async function main() {
  await test('Within-batch retries at quota add one observation; later retries preserve disk, age and revision', async () => {
    const dir = fresh(); let s = await boot(dir, { VITALIS_MAX_SPANS: '1', VITALIS_MAX_TRACES: '1' });
    try {
      const p = payload('a'); p.resourceSpans[0].scopeSpans[0].spans.push(structuredClone(spanOf(p)));
      await submit(s, p, accepted(1, 1)); await stop(s); s = await boot(dir, { VITALIS_MAX_SPANS: '1', VITALIS_MAX_TRACES: '1' });
      const before = await detail(s), inv = await investigate(s);
      const snap = bytes(dir, 'traces.json'), journal = bytes(dir, 'ingest-journal.ndjson');
      await submit(s, p, accepted(0, 2));
      assert.deepEqual((await detail(s)).hops, before.hops);
      assert.equal((await investigate(s)).revision, inv.revision);
      assert.deepEqual(bytes(dir, 'traces.json'), snap); assert.deepEqual(bytes(dir, 'ingest-journal.ndjson'), journal);
      assert.equal((await get(s, '/api/storage')).usage.spans, 1);
    } finally { await stop(s); }
  });
  await test('Canonical keys and unordered attributes dedup; ordered value arrays and retained fields conflict', async () => {
    const s = await boot(fresh());
    try {
      const p = payload('a'); spanOf(p).attributes = [{ key: 'ordered', value: { arrayValue: { values: [{ intValue: 1 }, { intValue: 2 }] } } }, { key: 'http.status_code', value: { intValue: 200 } }];
      await submit(s, p, accepted());
      const before = await investigate(s);
      const reordered = structuredClone(p); spanOf(reordered).attributes.reverse();
      spanOf(reordered).attributes[0] = { value: { intValue: 200 }, key: 'http.status_code' };
      await submit(s, reordered, accepted(0, 1)); assert.equal((await investigate(s)).revision, before.revision);
      const changed = structuredClone(p); spanOf(changed).attributes[0].value.arrayValue.values.reverse();
      await submit(s, changed, accepted(1, 0, 1));
      const conflict = await investigate(s); assert.equal(conflict.shape.state, 'UNKNOWN'); assert.notEqual(conflict.revision, before.revision);
      const legacy = (await detail(s)).baseline;
      assert.equal(legacy.verdict, 'UNKNOWN'); assert.match(legacy.reason, /identity is ambiguous/); assert.doesNotMatch(legacy.reason, /it is a batch|holds an OpenTelemetry/);
      await submit(s, changed, accepted(0, 1)); await submit(s, p, accepted(0, 1));
      assert.equal((await get(s, '/api/storage')).usage.spans, 2);
      const versioned = structuredClone(p); versioned.resourceSpans[0].resource.attributes.push({ key: 'service.version', value: { stringValue: '2.0.0' } });
      await submit(s, versioned, accepted(1, 0, 1));
    } finally { await stop(s); }
  });
  await test('Missing timestamps do not turn arrival time into identity; changed legacy duration remains a conflict', async () => {
    const dir = fresh(); let s = await boot(dir);
    try {
      const p = payload('a'); delete spanOf(p).startTimeUnixNano; delete spanOf(p).endTimeUnixNano;
      spanOf(p).durationMs = 7; await submit(s, p, accepted()); await stop(s); s = await boot(dir);
      const before = await detail(s); await submit(s, p, accepted(0, 1));
      assert.deepEqual((await detail(s)).hops, before.hops); assert.equal((await investigate(s)).timing.valueMs, null);
      spanOf(p).durationMs = 8; await submit(s, p, accepted(1, 0, 1)); assert.equal((await investigate(s)).shape.state, 'UNKNOWN');
    } finally { await stop(s); }
  });
  await test('Concurrent HTTP retries have one durable winner; forced restart preserves both conflict variants', async () => {
    const dir = fresh(); let s = await boot(dir);
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => submit(s, payload('a'))));
      assert.equal(results.reduce((n, r) => n + r.ingestedSpans, 0), 1);
      assert.equal(results.reduce((n, r) => n + r.duplicateSpans, 0), 11);
      const conflict = payload('a'); spanOf(conflict).name = 'GET /changed'; await submit(s, conflict, accepted(1, 0, 1));
      const revision = (await investigate(s)).revision;
      assert.equal(fs.existsSync(path.join(dir, 'traces.json')), false, 'Force crash before first snapshot');
      await stop(s, true); s = await boot(dir);
      await submit(s, payload('a'), accepted(0, 1)); await submit(s, conflict, accepted(0, 1));
      assert.equal((await investigate(s)).revision, revision); assert.equal((await detail(s)).hops.length, 2);
    } finally { await stop(s); }
  });
  await test('Mixed batch quota and malformed later row reject without partial publication', async () => {
    const s = await boot(fresh(), { VITALIS_MAX_SPANS: '2' });
    try {
      await submit(s, payload('a'));
      const mixed = payload('a'); mixed.resourceSpans.push(...payload('b').resourceSpans, ...payload('c').resourceSpans);
      assert.equal((await post(s, mixed)).status, 503); assert.equal((await get(s, '/api/storage')).usage.spans, 1);
      mixed.resourceSpans.pop(); await submit(s, mixed, accepted(1, 1));
      const bad = payload('c'); bad.resourceSpans.push(...payload('d').resourceSpans); delete spanOf({ resourceSpans: [bad.resourceSpans[1]] }).spanId;
      assert.equal((await post(s, bad)).status, 400); assert.equal((await get(s, '/api/storage')).usage.spans, 2);
      const conflict = payload('a'); spanOf(conflict).name = 'GET /different'; assert.equal((await post(s, conflict)).status, 503);
      assert.equal((await detail(s)).hops.length, 1); await submit(s, payload('a'), accepted(0, 1));
    } finally { await stop(s); }
  });
  await test('Recovery hold rejects even an exact retry and preserves damaged journal bytes', async () => {
    const dir = fresh(); let s = await boot(dir);
    try {
      await submit(s, payload('a')); await stop(s);
      fs.appendFileSync(path.join(dir, 'ingest-journal.ndjson'), '{damaged}\n');
      const before = bytes(dir, 'ingest-journal.ndjson'); s = await boot(dir);
      const response = await post(s, payload('a')); assert.equal(response.status, 503); assert.equal((await response.json()).status, 'STORAGE_RECOVERY_REQUIRED');
      assert.equal((await detail(s)).hops.length, 1); await stop(s); assert.deepEqual(bytes(dir, 'ingest-journal.ndjson'), before);
    } finally { await stop(s); }
  });
  await test('Historical duplicate snapshot rows are preserved without further retry growth', async () => {
    const dir = fresh(); let s = await boot(dir);
    try {
      await submit(s, payload('a')); await stop(s);
      const file = path.join(dir, 'traces.json'), snapshot = JSON.parse(fs.readFileSync(file));
      const hops = snapshot['a'.repeat(32)]; hops.push({ ...hops[0], receivedAt: hops[0].receivedAt + 1 }); fs.writeFileSync(file, JSON.stringify(snapshot));
      s = await boot(dir); await submit(s, payload('a'), accepted(0, 1)); assert.equal((await detail(s)).hops.length, 2);
    } finally { await stop(s); }
  });
  await test('Original FIN capture in original encodings replays twice without added evidence or changed revisions', async () => {
    const s = await boot(fresh());
    try {
      const first = await replayCapture(s); assert.ok(first.ingestedSpans > 0);
      const list = await get(s, '/api/investigations?limit=100'), before = await get(s, '/api/storage');
      const second = await replayCapture(s); assert.deepEqual(second, accepted(0, first.ingestedSpans + first.duplicateSpans));
      assert.deepEqual(await get(s, '/api/investigations?limit=100'), list);
      assert.equal((await get(s, '/api/storage')).usage.spans, before.usage.spans);
      assert.equal((await get(s, '/api/investigations/c4b6bfebbdf71a25e26d910fb1681aab')).coverage.observationsReceived, 8);
    } finally { await stop(s); }
  });
  await test('Retry emits no new-evidence subscription event or baseline observation', async () => {
    process.env.VITALIS_DATA_DIR = fresh(); process.env.VITALIS_API_KEY = 'retry-test';
    const { VitalisIngestEngine } = require('../server'); const engine = new VitalisIngestEngine();
    let events = 0, samples = 0;
    const unsub = engine.subscribe(() => events++); const observe = engine.baselines.observe.bind(engine.baselines);
    engine.baselines.observe = (...args) => { samples++; return observe(...args); };
    try {
      assert.deepEqual(counts(engine.ingestOtelSpans(payload('a').resourceSpans)), accepted());
      assert.deepEqual(counts(engine.ingestOtelSpans(payload('a').resourceSpans)), accepted(0, 1));
      assert.equal(events, 1); assert.equal(samples, 1);
      const changed = payload('a'); spanOf(changed).name = 'GET /late-conflict'; engine.ingestOtelSpans(changed.resourceSpans);
      assert.equal([...engine.baselines.baselines.values()].reduce((n, baseline) => n + baseline.samples.size, 0), 0, 'Late conflict removes prior partial baseline sample');
    } finally { unsub(); engine.persistNow(); }
  });
  fs.mkdirSync('artifacts/storage-d3', { recursive: true });
  fs.writeFileSync('artifacts/storage-d3/verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks,
    limitations: ['Identity covers retained sanitized fields only; not discarded OTLP fields or source attestation', 'Historical rows are preserved, not migrated or purged', 'Local process tests; production load and power loss untested'] }, null, 2));
}
module.exports = { replayCapture, counts, accepted };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
