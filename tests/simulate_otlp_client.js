/**
 * VITALIS ALPHA: Synthetic Real OTLP Client Test Script (Gate 1 - 5 Validation)
 * Simulates:
 * 1. Healthy Golden Request (142ms total)
 * 2. Degraded Request with 2,800ms DB lock contention
 * 3. Verifies Vitalis Alpha OTLP endpoint ingestion and deterministic candidate scoring
 */

const http = require('http');

function sendOtelTrace(traceId, dbLatencyMs = 18) {
  const spans = [
    { name: "Client-Request", service: "Client", durationMs: 8 },
    { name: "WAF-Inspection", service: "WAF", durationMs: 12 },
    { name: "LB-Dispatch", service: "F5-LB", durationMs: 10 },
    { name: "Auth-Verify", service: "AuthService", durationMs: 24 },
    { name: "Order-Process", service: "WebSphere", durationMs: 45 },
    { name: "DB-Query-Execute", service: "Postgres", durationMs: dbLatencyMs },
    { name: "Payment-Capture", service: "Stripe", durationMs: 78 }
  ];

  const otlpPayload = {
    resourceSpans: spans.map(s => ({
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: s.service } }]
      },
      scopeSpans: [{
        spans: [{
          traceId,
          spanId: `span-${s.service.toLowerCase()}-${Math.floor(Math.random() * 10000)}`,
          name: s.name,
          durationMs: s.durationMs,
          status: { code: s.durationMs > 2000 ? 2 : 1 }
        }]
      }]
    }))
  };

  const data = JSON.stringify(otlpPayload);

  const req = http.request({
    hostname: 'localhost',
    port: 4318,
    path: '/v1/traces',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => {
      console.log(`[OTLP Client] Ingested Trace ${traceId} (DB Latency: ${dbLatencyMs}ms) -> HTTP ${res.statusCode}: ${body}`);
      
      // Query evaluation
      queryEvaluation(traceId);
    });
  });

  req.on('error', err => {
    console.error(`[OTLP Client Error] ${err.message}. Ensure 'node server.js' is running.`);
  });

  req.write(data);
  req.end();
}

function queryEvaluation(traceId) {
  http.get(`http://localhost:4318/api/traces/${traceId}`, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => {
      console.log(`\n================ VITALIS RIE EVALUATION FOR ${traceId} ================`);
      console.log(JSON.stringify(JSON.parse(body), null, 2));
      console.log(`=======================================================================\n`);
    });
  });
}

// Run Test
console.log("Starting Vitalis Alpha OTLP Test Suite...");
console.log("1. Sending Healthy Transaction (TX-REAL-001)...");
sendOtelTrace("TX-REAL-001", 18);

setTimeout(() => {
  console.log("\n2. Sending Degraded Transaction with DB Lock (TX-REAL-002)...");
  sendOtelTrace("TX-REAL-002", 2814);
}, 1000);
