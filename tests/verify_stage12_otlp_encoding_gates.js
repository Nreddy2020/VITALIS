/**
 * VITALIS STAGE 12 — OTLP encoding: protobuf ingestion
 *
 * The project's central architectural claim is that VITALIS ingests standard
 * OTLP and therefore needs no agent — Tier A, zero adapter (`02`), and the
 * "additive layer, never a replacement" positioning that the whole commercial
 * and internal story rests on (`03` §5, `09`).
 *
 * That claim had a JavaScript-shaped hole in it.
 *
 * `server.js` accumulated the POST body as a STRING and `JSON.parse`d it. The
 * OpenTelemetry SDKs for Python, Java, Go and .NET, and the OpenTelemetry
 * Collector itself, all default to `http/protobuf`. Every one of them received
 * HTTP 400 and silently dropped its spans. Discovered by running a real FastAPI
 * app under `opentelemetry-instrument`, which reported:
 *
 *     Failed to export span batch code: 400, reason: Bad Request
 *
 * Same root cause as `19`: everything had been proven with JavaScript senders,
 * so the engine was shaped by them without anyone deciding it should be.
 *
 *  E1  Real Python-SDK protobuf decodes — resource identity intact.
 *  E2  Spans decode correctly: hex ids, timestamps, typed attributes.
 *  E3  **LIVE**: those real bytes POSTed over HTTP are accepted and assembled
 *       into a request, with service.version surviving into the hop.
 *  E4  A protobuf body mislabelled as JSON fails with a DIAGNOSABLE error that
 *       names the encoding — not a bare "Bad Request".
 *  E5  Corrupt protobuf fails closed: 400, and nothing partial is ingested.
 *  E6  The OTLP/JSON path still works identically — no regression.
 *  E7  Protobuf to a signal that has no protobuf schema is refused explicitly
 *       (415), never silently accepted and dropped.
 *
 * Outputs: artifacts/stage12-otlp-encoding-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TEST_API_KEY = 'stage12-encoding-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage12-'));

const { decodeExportTraceServiceRequest, isProtobufContentType } = require('../engine/ingestion/otlp_protobuf');
const { startServer, stopServer } = require('../server');

const TEST_PORT = 4341;
const FIXTURE = path.join(__dirname, 'fixtures', 'otlp_python_real.bin');
const REAL = fs.readFileSync(FIXTURE);

const report = { suite: 'stage12-otlp-encoding', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}

function request(pathname, body, contentType) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-vitalis-api-key': TEST_API_KEY, 'Content-Length': Buffer.byteLength(body) };
    if (contentType) headers['Content-Type'] = contentType;
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path: pathname, method: 'POST', agent: false, headers },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.write(body); req.end();
  });
}
function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: TEST_PORT, path: pathname, method: 'GET', agent: false,
      headers: { 'x-vitalis-api-key': TEST_API_KEY } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject); req.end();
  });
}

console.log('==================================================================');
console.log('VITALIS STAGE 12 — OTLP ENCODING GATES');
console.log(`fixture: real Python OpenTelemetry SDK bytes, ${REAL.length} bytes`);
console.log('==================================================================');

const decoded = decodeExportTraceServiceRequest(REAL);

// ---------------------------------------------------------------- E1
{
  const rs = decoded.resourceSpans[0];
  const attr = k => {
    const a = rs.resource.attributes.find(x => x.key === k);
    return a && a.value.stringValue;
  };
  const passed = decoded.resourceSpans.length === 1
    && attr('service.name') === 'finlife-api'
    && attr('service.version') === '1.0.1'
    && attr('deployment.environment') === 'local'
    && attr('telemetry.sdk.language') === 'python';
  report.evidence.E1 = { attributes: rs.resource.attributes.map(a => `${a.key}=${Object.values(a.value)[0]}`) };
  gate('E1_realPythonProtobufDecodes', 'E1 Real Python-SDK protobuf decodes', passed, [
    `service.name           : ${attr('service.name')}`,
    `service.version        : ${attr('service.version')}`,
    `deployment.environment : ${attr('deployment.environment')}`,
    `telemetry.sdk.language : ${attr('telemetry.sdk.language')} (these bytes came from a real Python app)`
  ]);
}

// ---------------------------------------------------------------- E2
{
  const spans = decoded.resourceSpans[0].scopeSpans.flatMap(s => s.spans);
  const root = spans.find(s => s.attributes.some(a => a.key === 'http.route'));
  const status = root.attributes.find(a => a.key === 'http.status_code');
  const durMs = Math.round((root.endTimeUnixNano - root.startTimeUnixNano) / 1e6);
  const allHex = spans.every(s => /^[0-9a-f]{32}$/.test(s.traceId) && /^[0-9a-f]{16}$/.test(s.spanId));
  const oneTrace = new Set(spans.map(s => s.traceId)).size === 1;
  const passed = spans.length >= 3 && allHex && oneTrace
    && durMs > 0 && durMs < 5000
    && status.value.intValue === '200';   // OTLP/JSON encodes int64 as string
  report.evidence.E2 = { spanCount: spans.length, rootName: root.name, durMs, statusAttr: status };
  gate('E2_spansDecodeCorrectly', 'E2 Spans decode: hex ids, timestamps, typed attributes', passed, [
    `spans                : ${spans.length}, all sharing one trace id: ${oneTrace}`,
    `ids well-formed      : ${allHex}`,
    `root span            : ${root.name} — ${durMs}ms`,
    `http.status_code     : ${JSON.stringify(status.value)} (int64 as string, matching OTLP/JSON)`
  ]);
}

async function live() {
  await startServer(TEST_PORT);

  // ---------------------------------------------------------------- E3
  {
    const res = await request('/v1/traces', REAL, 'application/x-protobuf');
    const traceId = decoded.resourceSpans[0].scopeSpans.flatMap(s => s.spans)[0].traceId;
    const fetched = JSON.parse((await get(`/api/traces/${traceId}`)).body);
    const hops = fetched.hops || (fetched.dna && fetched.dna.hops) || [];
    const withVersion = hops.find(h => h.serviceVersion);
    const passed = res.status === 200
      && hops.length >= 3
      && hops.every(h => h.service === 'finlife-api')
      && !!withVersion && withVersion.serviceVersion === '1.0.1'
      && withVersion.deploymentEnvironment === 'local';
    report.evidence.E3 = { status: res.status, body: res.body, hopCount: hops.length };
    gate('E3_liveProtobufIngest', 'E3 LIVE: real protobuf POSTed over HTTP is ingested', passed, [
      `POST /v1/traces      : HTTP ${res.status} — ${res.body}`,
      `hops assembled       : ${hops.length}`,
      `service.version kept : ${withVersion && withVersion.serviceVersion}`,
      `environment kept     : ${withVersion && withVersion.deploymentEnvironment}`
    ]);
  }

  // ---------------------------------------------------------------- E4
  {
    const res = await request('/v1/traces', REAL, 'application/json');
    let parsed = {}; try { parsed = JSON.parse(res.body); } catch (e) {}
    const passed = res.status === 400
      && parsed.encoding === 'json'
      && typeof parsed.hint === 'string' && /protobuf/i.test(parsed.hint)
      && parsed.contentType === 'application/json'
      && parsed.bytes === REAL.length;
    report.evidence.E4 = parsed;
    gate('E4_mislabelledEncodingIsDiagnosable', 'E4 Protobuf mislabelled as JSON gives a diagnosable error', passed, [
      `status    : ${res.status}`,
      `encoding  : ${parsed.encoding}`,
      `bytes     : ${parsed.bytes}`,
      `hint      : ${parsed.hint}`
    ]);
  }

  // ---------------------------------------------------------------- E5
  {
    const before = JSON.parse((await get('/api/traces')).body).traceCount;
    const corrupt = Buffer.concat([REAL.subarray(0, 600)]);           // truncated mid-message
    const res = await request('/v1/traces', corrupt, 'application/x-protobuf');
    const garbage = await request('/v1/traces', Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]), 'application/x-protobuf');
    const after = JSON.parse((await get('/api/traces')).body).traceCount;
    let parsed = {}; try { parsed = JSON.parse(res.body); } catch (e) {}
    const passed = res.status === 400 && garbage.status === 400
      && parsed.encoding === 'protobuf'
      && after === before;   // nothing partial was ingested
    report.evidence.E5 = { truncated: parsed, garbageStatus: garbage.status, tracesBefore: before, tracesAfter: after };
    gate('E5_corruptProtobufFailsClosed', 'E5 Corrupt protobuf fails closed, ingests nothing', passed, [
      `truncated body   : HTTP ${res.status} (${parsed.error})`,
      `garbage bytes    : HTTP ${garbage.status}`,
      `traces before/after: ${before}/${after} — no partial ingest`
    ]);
  }

  // ---------------------------------------------------------------- E6
  {
    const traceId = 'bb'.repeat(16);
    const now = Date.now() * 1e6;
    const json = JSON.stringify({ resourceSpans: [{
      resource: { attributes: [
        { key: 'service.name', value: { stringValue: 'json-sender' } },
        { key: 'service.version', value: { stringValue: '9.9.9' } }
      ]},
      scopeSpans: [{ spans: [{ traceId, spanId: '0f'.repeat(8), name: 'GET /json', startTimeUnixNano: now, endTimeUnixNano: now + 25e6 }] }]
    }]});
    const res = await request('/v1/traces', json, 'application/json');
    const fetched = JSON.parse((await get(`/api/traces/${traceId}`)).body);
    const hops = fetched.hops || (fetched.dna && fetched.dna.hops) || [];
    const passed = res.status === 200 && hops.length === 1
      && hops[0].service === 'json-sender' && hops[0].serviceVersion === '9.9.9';
    report.evidence.E6 = { status: res.status, hop: hops[0] };
    gate('E6_jsonPathUnchanged', 'E6 OTLP/JSON path still works identically', passed, [
      `POST (json)      : HTTP ${res.status}`,
      `hop service      : ${hops[0] && hops[0].service} @ ${hops[0] && hops[0].serviceVersion}`
    ]);
  }

  // ---------------------------------------------------------------- E7
  {
    const res = await request('/v1/metrics', REAL, 'application/x-protobuf');
    let parsed = {}; try { parsed = JSON.parse(res.body); } catch (e) {}
    const passed = res.status === 415 && /protobuf/i.test(parsed.error || '');
    report.evidence.E7 = parsed;
    gate('E7_unsupportedSignalRefusedExplicitly', 'E7 Protobuf on a signal with no schema is refused explicitly', passed, [
      `POST /v1/metrics : HTTP ${res.status} (415, not a silent 200)`,
      `error            : ${parsed.error}`
    ]);
  }

  await stopServer();
}

live().catch(err => { console.error('[FATAL]', err); failures++; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    report.fixtureBytes = REAL.length;
    const allPassed = failures === 0;
    console.log('\n==================================================================');
    console.log(`OVERALL: ${allPassed ? 'ALL STAGE 12 OTLP ENCODING GATES PASSED' : `${failures} GATE(S) FAILED`}`);
    console.log('==================================================================');
    const dir = path.join(__dirname, '..', 'artifacts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stage12-otlp-encoding-gate-report.json'), JSON.stringify(report, null, 2));
    process.exit(allPassed ? 0 : 1);
  });
