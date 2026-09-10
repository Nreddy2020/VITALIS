'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const dir = path.resolve(process.argv[2] || 'artifacts/mobile-pilot/run-002');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'capture-index.json')));
  const expectedInteractions = [
    { from: 'fin-mobile-isolated', to: 'fin-backend-isolated', declaredBy: 'isolated FIN pilot operator', evidence: 'Copied InflationService -> actual FastAPI GET /api/inflation routes' },
    { from: 'fin-backend-isolated', to: 'mongodb', declaredBy: 'isolated FIN pilot operator', evidence: 'Actual backend inflation service queries Mongo; database SERVER instrumentation unavailable' }
  ];
  const config = { builds: [], expectedInteractions, evidenceContext: 'REPLAY OF REAL ISOLATED FIN MOBILE CAPTURE; no verified artifact identities or database SERVER spans' };
  const configPath = path.join(dir, 'expected-coverage.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  process.env.VITALIS_BUILD_INVENTORY = configPath;
  process.env.VITALIS_API_KEY = 'local-mobile-capture-test';
  process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vitalis-mobile-'));
  const { startServer, stopServer } = require('../server');
  await startServer(4360, '127.0.0.1');
  const base = 'http://127.0.0.1:4360';
  const headers = { 'x-vitalis-api-key': process.env.VITALIS_API_KEY };
  try {
    for (const capture of index) {
      const body = fs.readFileSync(path.join(dir, capture.file));
      assert.equal(crypto.createHash('sha256').update(body).digest('hex'), capture.sha256, 'Raw capture hash');
      const response = await fetch(base + '/v1/traces', { method: 'POST', headers: { ...headers, 'content-type': capture.contentType }, body });
      assert.equal(response.status, 200, 'Original OTLP encoding must ingest');
    }
    const list = await (await fetch(base + '/api/traces', { headers })).json();
    const details = await Promise.all(list.traces.map(t => fetch(base + '/api/traces/' + t.traceId, { headers }).then(r => r.json())));
    const mobile = details.filter(d => d.hops.some(h => h.service === 'fin-mobile-isolated'));
    assert.ok(mobile.length > 0, 'A real mobile-exported trace is required');
    for (const d of mobile) {
      const client = d.hops.find(h => h.service === 'fin-mobile-isolated' && h.kind === 3);
      const server = d.hops.find(h => h.service === 'fin-backend-isolated' && h.kind === 2 && h.parentSpanId === client?.spanId);
      assert.ok(client && server, 'Backend SERVER must directly parent-link to the mobile CLIENT in the same trace');
      for (const span of [client, server]) {
        const status = span.attributes.find(a => ['http.status_code', 'http.response.status_code'].includes(a.key));
        assert.equal(Number(status?.value.intValue), 200, 'Actual mobile/backend HTTP status');
      }
      assert.ok(d.hops.some(h => h.kind === 3 && h.service === 'fin-backend-isolated' && h.attributes.some(a => a.key === 'db.system' && a.value.stringValue === 'mongodb')), 'Request-linked real Mongo CLIENT span required');
      assert.equal(d.compatibility.traceShape.state, 'OBSERVED_TREE');
      assert.equal(d.compatibility.expectedCoverage[0].state, 'OBSERVED_BOUNDARY');
      assert.equal(d.compatibility.expectedCoverage[1].state, 'UNKNOWN');
      assert.equal(d.compatibility.status, 'UNKNOWN');
      assert.equal(d.compatibility.coverage.checkedBoundaries, 0);
      assert.ok(d.compatibility.coverage.uncheckedInteractions > 0);
      assert.equal(d.candidates.length, 0, 'Missing evidence must not invent causal candidates');
    }
    const report = { status: 'PASS', runAt: new Date().toISOString(), mobileRequests: mobile.length,
      checks: ['Raw OTLP hashes verified', 'Mobile CLIENT -> backend SERVER exact parent link', 'Mongo CLIENT in each request tree', 'Expected mobile boundary observed; database SERVER boundary unknown', 'Compatibility unknown; zero fabricated causal candidates'],
      limitations: ['Isolated local runtime, not production', 'No artifact attestation', 'No database SERVER span', 'Read response may use backend fallback; no claim of current market data', 'No incompatibility incident or repair executed'],
      reports: mobile.map(d => ({ traceId: d.traceId, hops: d.hops, compatibility: d.compatibility })) };
    fs.writeFileSync(path.join(dir, 'mobile-capture-tests.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, mobileRequests: mobile.length, hops: mobile.map(d => d.hops.length) }, null, 2));
  } finally { await stopServer(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
