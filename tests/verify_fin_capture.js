'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = path.resolve(__dirname, '../artifacts/pilot');
async function main() {
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'fin-capture-metadata.json')));
  process.env.VITALIS_API_KEY = 'local-fin-capture-test';
  process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fin-capture-replay-'));
  const expected = [
    { from: 'mobile-client', to: 'fin-health-pilot', declaredBy: 'pilot operator', evidence: 'FIN app architecture; mobile path not exercised by this harness' },
    { from: 'fin-health-pilot', to: 'mongodb', declaredBy: 'pilot operator', evidence: 'FIN backend/main.py health -> MongoDB.client.admin.command(ping)' }
  ];
  const configFile = path.join(dir,'fin-expected-coverage.json');
  fs.writeFileSync(configFile, JSON.stringify({ builds: [], expectedInteractions: expected },null,2));
  process.env.VITALIS_BUILD_INVENTORY = configFile;
  const { startServer, stopServer } = require('../server');
  await startServer(4359, '127.0.0.1');
  const headers = { 'x-vitalis-api-key': process.env.VITALIS_API_KEY };
  try {
    for (const capture of metadata.captures) {
      const bytes = fs.readFileSync(path.join(dir, capture.file));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.sha256);
      const r = await fetch('http://127.0.0.1:4359/v1/traces',{method:'POST',headers:{...headers,'content-type':'application/x-protobuf'},body:bytes});
      assert.equal(r.status,200);
    }
    const list = await (await fetch('http://127.0.0.1:4359/api/traces',{headers})).json();
    const details=[];
    for (const t of list.traces) details.push(await (await fetch('http://127.0.0.1:4359/api/traces/'+t.traceId,{headers})).json());
    const health=details.filter(d=>d.hops.some(h=>h.name==='GET /health' && h.kind===2));
    assert.equal(health.length,2,'Two real health requests must have distinct trace IDs');
    for(const d of health) {
      assert.equal(d.compatibility.traceShape.state,'OBSERVED_TREE');
      assert.ok(d.hops.some(h=>h.kind===3 && h.attributes.some(a=>a.key==='db.system' && a.value.stringValue==='mongodb')),'Expected a real Mongo client span');
      assert.equal(d.compatibility.status,'UNKNOWN');
      assert.equal(d.compatibility.relationships.length,0);
      assert.ok(d.compatibility.coverage.uncheckedInteractions>0);
      assert.ok(d.compatibility.expectedCoverage.every(e=>e.state==='UNKNOWN'));
      assert.equal(d.candidates.length,0,'Missing compatibility evidence cannot create causal candidates');
    }
    const report={runAt:new Date().toISOString(),status:'PASS',metadata,healthRequests:health.length,
      checks:['Two actual FIN health HTTP 200 responses','Two independent request traces with MongoDB client spans','No artifact identity or server spans means UNKNOWN','Expected mobile/database boundaries remain unchecked','No causal candidates from missing evidence'],
      reports:health.map(d=>({traceId:d.traceId, observedHops:d.hops.map(h=>({spanId:h.spanId,parentSpanId:h.parentSpanId,name:h.name,kind:h.kind,service:h.service})),compatibility:d.compatibility}))};
    fs.writeFileSync(path.join(dir,'fin-capture-tests.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:'PASS',healthRequests:health.length,hops:health.map(d=>d.hops.length),unchecked:health.map(d=>d.compatibility.coverage.uncheckedInteractions)},null,2));
  } finally { await stopServer(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
