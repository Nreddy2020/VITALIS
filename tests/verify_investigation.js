'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { buildInvestigation: build, nano } = require('../engine/investigation/request_investigation');
const traceId = 'a'.repeat(32);
const span = (id, parent, start = 0, end = 100) => ({ spanId: id.repeat(16), parentSpanId: parent?.repeat(16),
  kind: parent ? 3 : 2, service: 'example-service', name: 'GET /check',
  startTimeUnixNano: String(1789039155000000000n + BigInt(start) * 1000000n),
  endTimeUnixNano: String(1789039155000000000n + BigInt(end) * 1000000n),
  attributes: [{ key: 'http.response.status_code', value: { intValue: 200 } }] });
const checks = [];
async function test(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
async function main() {
  await test('Root timing excludes nested and parallel overlap', () => {
    const r = build({ traceId, hops: [span('1'), span('2', '1', 1, 90), span('3', '1', 2, 95)] });
    assert.equal(r.timing.valueMs, 100); assert.equal(r.outcome.httpStatusCode, 200);
    assert.equal(r.outcome.businessResult, 'UNKNOWN'); assert.equal(r.execution.enabled, false);
  });
  await test('Missing and unsafe timing cannot use the legacy 10ms default', () => {
    const h = span('1'); delete h.startTimeUnixNano; h.durationMs = 10;
    assert.equal(build({ traceId, hops: [h] }).timing.valueMs, null);
    assert.equal(nano(1789039155000000000), undefined);
    assert.equal(nano('18446744073709551616'), undefined);
  });
  await test('Submillisecond timing remains precise', () => {
    const h = span('1'); h.endTimeUnixNano = String(BigInt(h.startTimeUnixNano) + 123456n);
    assert.equal(build({ traceId, hops: [h] }).timing.valueMs, 0.123456);
  });
  await test('Missing roots, cycles, malformed IDs and conflicting IDs refuse request outcome', () => {
    const conflict = span('1'); conflict.endTimeUnixNano = span('1', null, 0, 200).endTimeUnixNano;
    for (const hops of [[span('2', '1')], [span('1'), span('2')], [span('1', '2'), span('2', '1')], [span('z')], [span('1'), conflict]]) {
      const r = build({ traceId, hops }); assert.equal(r.shape.state, 'UNKNOWN'); assert.equal(r.outcome.state, 'UNKNOWN'); assert.equal(r.timing.valueMs, null);
    }
  });
  await test('Exact retries collapse; arrival order does not change the revision', () => {
    const a = span('1'), b = span('2', '1');
    const r = build({ traceId, hops: [a, b, a] }); assert.equal(r.shape.duplicatesCollapsed, 1); assert.equal(r.shape.state, 'OBSERVED_TREE');
    assert.equal(r.revision, build({ traceId, hops: [b, a, a] }).revision);
    assert.notEqual(r.revision, build({ traceId, hops: [a, b] }).revision);
  });
  await test('Child error is observable without inventing root business failure', () => {
    const child = span('2', '1'); child.otelStatusCode = 2; child.attributes = [];
    const r = build({ traceId, hops: [span('1'), child] }); assert.equal(r.signals.length, 1);
    assert.equal(r.outcome.state, 'HTTP_RESPONSE_OBSERVED'); assert.equal(r.outcome.businessResult, 'UNKNOWN'); assert.equal(r.triage, 'ERROR_OBSERVED');
  });
  await test('Conflicting status aliases and explicit errors are disclosed', () => {
    const h = span('1'); h.attributes.push({ key: 'http.status_code', value: { intValue: 500 } });
    assert.equal(build({ traceId, hops: [h] }).outcome.conflict, true);
    h.attributes.pop(); h.otelStatusCode = 2;
    assert.equal(build({ traceId, hops: [h] }).outcome.state, 'UNKNOWN');
    h.attributes = []; delete h.otelStatusCode;
    assert.equal(build({ traceId, hops: [h] }).outcome.state, 'UNKNOWN');
  });
  await test('No invented permissions, business result, recovery state or executable recommendations', () => {
    const r = build({ traceId, hops: [span('1')] });
    assert.ok(r.gaps.every(g => !['PERMISSION', 'EXPERTISE'].includes(g.kind)));
    assert.ok(r.nextSteps.every(s => s.mode === 'READ_ONLY' && s.validation && !s.command));
    assert.ok(r.gaps.some(g => g.id === 'BUSINESS')); assert.equal(r.execution.state, 'NOT_REQUESTED');
  });
  await test('Oversized traces return an explicit analysis limit', () => {
    const r = build({ traceId, hops: Array(1001).fill(span('1')) });
    assert.equal(r.timing.valueMs, null); assert.ok(r.gaps.some(g => g.id === 'LIMIT'));
  });

  fs.mkdirSync('artifacts/investigation', { recursive: true });
  process.env.VITALIS_API_KEY = 'local-investigation-test';
  process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'investigation-'));
  delete process.env.VITALIS_BUILD_INVENTORY;
  const { startServer, stopServer } = require('../server');
  const base = 'http://127.0.0.1:4361';
  await startServer(4361, '127.0.0.1');
  const headers = { 'x-vitalis-api-key': process.env.VITALIS_API_KEY };
  const get = suffix => fetch(base + suffix, { headers });
  const { NodeTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { ROOT_CONTEXT, SpanKind, defaultTextMapGetter } = require('@opentelemetry/api');
  const { W3CTraceContextPropagator } = require('@opentelemetry/core');
  const { createFetchObserver } = require('../engine/ingestion/fetch_observer');
  const provider = new NodeTracerProvider({ resource: resourceFromAttributes({ 'service.name': 'node-investigation-api' }),
    spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: base + '/v1/traces', headers }))] });
  const tracer = provider.getTracer('investigation-live-test'), propagator = new W3CTraceContextPropagator();
  const app = http.createServer((req, res) => {
    const parent = propagator.extract(ROOT_CONTEXT, req.headers, defaultTextMapGetter);
    const s = tracer.startSpan('GET /check', { kind: SpanKind.SERVER }, parent);
    const status = req.url === '/check?fault=1' ? 500 : 200;
    s.setAttribute('http.response.status_code', status); if (status === 500) s.setStatus({ code: 2 });
    res.writeHead(status); res.end('test response'); s.end();
  });
  const exports = [];
  let reports;
  try {
    await test('New APIs reject unauthenticated calls, bad pagination and absent traces', async () => {
      assert.equal((await fetch(base + '/api/investigations')).status, 401);
      assert.equal((await fetch(base + '/api/investigations/' + traceId)).status, 401);
      assert.equal((await get('/api/investigations?limit=101')).status, 400);
      assert.equal((await get('/api/investigations?offset=-1')).status, 400);
      assert.equal((await get('/api/investigations/' + traceId)).status, 404);
    });
    await new Promise(r => app.listen(0, '127.0.0.1', r));
    const observedFetch = createFetchObserver({ fetch, randomBytes: crypto.randomBytes, select: () => ({ spanName: 'GET /check' }),
      serviceName: 'node-investigation-client', emit: payload => { const p = fetch(base + '/v1/traces', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) }); exports.push(p); return p; } });
    await test('Real Node HTTP 500 and 200 requests become distinct evidenced investigations', async () => {
      const origin = 'http://127.0.0.1:' + app.address().port;
      assert.equal((await observedFetch(origin + '/check?fault=1')).status, 500);
      assert.equal((await observedFetch(origin + '/check')).status, 200);
      await Promise.all(exports); await provider.forceFlush();
      const listing = await (await get('/api/investigations')).json(); assert.equal(listing.total, 2);
      reports = await Promise.all(listing.items.map(i => get('/api/investigations/' + i.traceId).then(r => r.json())));
      const failed = reports.find(r => r.outcome.httpStatusCode === 500), successful = reports.find(r => r.outcome.httpStatusCode === 200);
      assert.ok(failed && successful); assert.equal(failed.triage, 'ERROR_OBSERVED');
      assert.equal(successful.triage, 'EVIDENCE_NEEDED');
      assert.ok(reports.every(r => r.shape.state === 'OBSERVED_TREE' && r.timing.valueMs !== null && r.coverage.uniqueSpans === 2));
      assert.ok(reports.every(r => r.outcome.businessResult === 'UNKNOWN'));
      const page = await (await get('/api/investigations?limit=1')).json(); assert.equal(page.items.length, 1); assert.equal(page.nextOffset, 1);
    });
    await test('Recorded FIN mobile traces use the same investigation path and original timing', async () => {
      const dir = 'artifacts/mobile-pilot/run-002';
      const index = JSON.parse(fs.readFileSync(path.join(dir, 'capture-index.json')));
      for (const batch of index) {
        const body = fs.readFileSync(path.join(dir, batch.file)); assert.equal(crypto.createHash('sha256').update(body).digest('hex'), batch.sha256);
        assert.equal((await fetch(base + '/v1/traces', { method: 'POST', headers: { ...headers, 'content-type': batch.contentType }, body })).status, 200);
      }
      const original = JSON.parse(fs.readFileSync(path.join(dir, 'mobile-capture-tests.json')));
      for (const before of original.reports) {
        const r = await (await get('/api/investigations/' + before.traceId)).json();
        assert.equal(r.outcome.httpStatusCode, 200); assert.ok(r.timing.valueMs > 0);
        assert.ok(r.gaps.some(g => g.id === 'PEER')); assert.equal(r.outcome.businessResult, 'UNKNOWN');
      }
    });
  } finally { await new Promise(r => app.close(r)); await provider.shutdown(); await stopServer(); }
  fs.writeFileSync('artifacts/investigation/verification.json', JSON.stringify({ status: 'PASS', runAt: new Date().toISOString(), checks,
    liveNodeReports: reports, scope: 'Local test application with deliberate HTTP failure plus original FIN recording replay; not a production incident or repair.' }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
