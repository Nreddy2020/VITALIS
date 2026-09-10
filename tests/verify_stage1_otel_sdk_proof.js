/**
 * VITALIS STAGE 1 — Tier A Proof: real OpenTelemetry SDK, zero adapter code
 *
 * ADAPTER_CONTRACT.md claims that anything instrumented with real OpenTelemetry
 * can POST straight to VITALIS's OTLP endpoint with no adapter at all — "Tier A".
 * This test proves that claim against the ACTUAL @opentelemetry/sdk-trace-node
 * package (the same library real Node.js applications use), not a hand-shaped
 * JSON fixture pretending to look like OTel wire data.
 *
 * It builds a real NodeTracerProvider, generates real spans representing a
 * multi-hop request (Client -> Gateway -> App -> DB), exports them with the
 * real @opentelemetry/exporter-trace-otlp-http exporter pointed at a live
 * VITALIS server's /v1/traces endpoint, and then confirms via VITALIS's own
 * GET /api/traces/:id that the spans were understood — all without a single
 * line of VITALIS-specific adapter code translating the wire format.
 *
 * Outputs: artifacts/stage1-otel-sdk-proof-report.json
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { NodeTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { trace, context } = require('@opentelemetry/api');

const TEST_API_KEY = 'stage1-otel-sdk-test-key';
process.env.VITALIS_API_KEY = TEST_API_KEY;
process.env.VITALIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalis-stage1-otel-test-'));

const { startServer, stopServer } = require('../server');
const TEST_PORT = 4325;

function makeRequest(options) {
  options = { agent: false, ...options, headers: { 'x-vitalis-api-key': TEST_API_KEY, ...(options.headers || {}) } };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log("==================================================================");
  console.log("   VITALIS STAGE 1 — TIER A PROOF: REAL OTEL SDK, ZERO ADAPTER     ");
  console.log("==================================================================\n");
  const report = { version: "1.0", testRun: `VITALIS-STAGE1-OTEL-${Date.now()}`, timestamp: new Date().toISOString(), gates: {} };

  await startServer(TEST_PORT);

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'checkout-app' }),
    spanProcessors: [
      new SimpleSpanProcessor(new OTLPTraceExporter({
        url: `http://localhost:${TEST_PORT}/v1/traces`,
        headers: { 'x-vitalis-api-key': TEST_API_KEY }
      }))
    ]
  });
  provider.register();
  const tracer = trace.getTracer('vitalis-stage1-proof-app', '1.0.0');

  try {
    console.log("--- [GATE T1] Real OTel SDK spans export successfully to VITALIS's OTLP endpoint ---");
    const traceIdHolder = {};
    await context.with(context.active(), async () => {
      const rootSpan = tracer.startSpan('checkout-request');
      const rootCtx = trace.setSpan(context.active(), rootSpan);
      traceIdHolder.traceId = rootSpan.spanContext().traceId;

      await context.with(rootCtx, async () => {
        const dbSpan = tracer.startSpan('inventory-db-query');
        dbSpan.setAttribute('db.system', 'postgresql');
        dbSpan.setAttribute('db.lock_wait_ms', 2400);
        dbSpan.setAttribute('db.connection_pool.saturation_pct', 91);
        dbSpan.setAttribute('db.query.fingerprint', 'SELECT * FROM inventory WHERE sku = ? FOR UPDATE');
        // evaluateTrace() only raises a DB-contention candidate above a 1000ms
        // threshold (see server.js) — this must genuinely take >1s wall-clock
        // so the span's real recorded duration crosses that threshold, exactly
        // as a genuinely slow query would.
        await new Promise(r => setTimeout(r, 1200));
        dbSpan.end();
      });

      rootSpan.end();
    });

    // Force the real SDK to actually flush spans over the network before we check VITALIS.
    await provider.forceFlush();
    await new Promise(r => setTimeout(r, 500)); // let the HTTP export settle

    const traceId = traceIdHolder.traceId;
    console.log(`> Real OTel SDK generated traceId: ${traceId}`);

    const traceResp = await makeRequest({ hostname: 'localhost', port: TEST_PORT, path: `/api/traces/${traceId}`, method: 'GET' });
    const wasIngested = traceResp.status === 200 && Array.isArray(traceResp.data.hops) && traceResp.data.hops.length > 0;
    report.gates.realOtelSpansIngestedWithZeroAdapterCode = wasIngested ? "PASS" : "FAIL";
    console.log(`> GET /api/traces/${traceId} status: ${traceResp.status}`);
    console.log(`> Hops VITALIS recognized: ${wasIngested ? traceResp.data.hops.map(h => h.service + ':' + h.name).join(', ') : 'NONE'}`);
    console.log(`RESULT GATE [realOtelSpansIngestedWithZeroAdapterCode]: [${report.gates.realOtelSpansIngestedWithZeroAdapterCode}]\n`);

    console.log("--- [GATE T2] Real OTel span attributes (db.lock_wait_ms etc.) survive into VITALIS's RCA evidence ---");
    const candidate = wasIngested && traceResp.data.candidates && traceResp.data.candidates[0];
    const candidateText = JSON.stringify(candidate || {});
    const citesRealAttrs = candidateText.includes('2400') || candidateText.includes('2,400');
    report.gates.realOtelAttributesReachRcaEngine = citesRealAttrs ? "PASS" : "FAIL";
    console.log(`> RCA candidate: ${candidateText}`);
    console.log(`> Cites the real db.lock_wait_ms=2400 value sent via the actual OTel SDK: ${citesRealAttrs}`);
    console.log(`RESULT GATE [realOtelAttributesReachRcaEngine]: [${report.gates.realOtelAttributesReachRcaEngine}]\n`);

  } finally {
    await provider.shutdown();
    await stopServer();
    console.log("[CLEANUP] OTel SDK provider shut down, test server stopped.\n");
  }

  const allPassed = Object.values(report.gates).every(v => v === 'PASS');
  console.log("==================================================================");
  console.log(`OVERALL: ${allPassed ? 'ALL STAGE 1 OTEL SDK PROOF GATES PASSED' : 'ONE OR MORE GATES FAILED'}`);
  console.log("==================================================================");

  const artifactsDir = path.join(__dirname, '..', 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'stage1-otel-sdk-proof-report.json'), JSON.stringify(report, null, 2));
  process.exit(allPassed ? 0 : 1);
}

run().catch(err => { console.error('[FATAL]', err); process.exit(1); });
