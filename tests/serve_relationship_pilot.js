'use strict';
const fs = require('fs');
const path = require('path');
const { fixture, otlp } = require('./fixtures/relationship_pilot');
async function startPilot(port = 4358, mode = 'fixtures') {
  const dir = path.resolve(__dirname, '../artifacts/pilot');
  fs.mkdirSync(dir, { recursive: true });
  const python = fixture(), java = fixture('java'), unknown = fixture();
  unknown.trace.traceId = 'cccccccccccccccccccccccccccccccc';
  unknown.trace.hops.forEach(h => delete h.artifactDigest);
  let config = { evidenceContext: 'CONTROLLED FIXTURES — no actual database incompatibility was executed', builds: [...python.inventories, ...java.inventories], expectedInteractions: [
    { from: 'mobile-client', to: 'gateway', declaredBy: 'controlled pilot', evidence: 'Example expectation only; not observed in these fixtures' }
  ] };
  let metadata;
  if (mode === 'fin') {
    metadata = JSON.parse(fs.readFileSync(path.join(dir, 'fin-capture-metadata.json')));
    config = JSON.parse(fs.readFileSync(path.join(dir, 'fin-expected-coverage.json')));
    config.evidenceContext = 'REPLAY OF REAL FIN HEALTH CAPTURE from ' + metadata.capturedAt + ' — backend health only, not mobile end-to-end capture';
  }
  const mobileDir = path.resolve(__dirname, '../artifacts/mobile-pilot/run-002');
  if (mode === 'mobile') {
    metadata = { captures: JSON.parse(fs.readFileSync(path.join(mobileDir, 'capture-index.json'))) };
    config = JSON.parse(fs.readFileSync(path.join(mobileDir, 'expected-coverage.json')));
    config.evidenceContext = 'REPLAY OF REAL ISOLATED FIN MOBILE CAPTURE — mobile to backend observed; Mongo CLIENT only; fallback inflation response; compatibility UNKNOWN';
  }
  const configFile = path.join(dir, 'demo-inventory.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  process.env.VITALIS_API_KEY = 'local-pilot-test';
  process.env.VITALIS_BUILD_INVENTORY = configFile;
  process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vitalis-demo-'));
  const { startServer, stopServer } = require('../server');
  await startServer(port, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'x-vitalis-api-key': process.env.VITALIS_API_KEY, 'content-type': 'application/json' };
  for (const f of mode === 'fixtures' ? [python, java, unknown] : []) {
    const response = await fetch(base + '/v1/traces', { method: 'POST', headers, body: JSON.stringify(otlp(f)) });
    if (!response.ok) throw Error('Fixture ingest failed: ' + response.status);
  }
  for (const capture of metadata?.captures || []) {
    const response = await fetch(base + '/v1/traces', { method: 'POST', headers: { ...headers, 'content-type': capture.contentType || 'application/x-protobuf' }, body: fs.readFileSync(path.join(mode === 'mobile' ? mobileDir : dir,capture.file)) });
    if (!response.ok) throw Error('Recorded FIN ingest failed: ' + response.status);
  }
  return { base, headers, configFile, stopServer };
}
if (require.main === module) startPilot(4358, process.argv.includes('--mobile') ? 'mobile' : process.argv.includes('--fin') ? 'fin' : 'fixtures').then(({ base }) => console.log(`LOCAL PILOT (recorded captures with --mobile/--fin, otherwise controlled fixtures): ${base} — API key local-pilot-test. Ctrl+C to stop.`)).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { startPilot };
