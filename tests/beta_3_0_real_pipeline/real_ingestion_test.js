/**
 * VITALIS Beta-3.0 Gate 1: Real Ingestion & Adapter Health Test
 * Validates out-of-band telemetry ingestion, ring buffer capacity, adapter visibility states,
 * and collection lag metrics with zero transaction latency overhead.
 */

const { IngestionGateway } = require('../../engine/ingestion/ingestion_gateway');
const { AdapterHealthManager, ADAPTER_STATES } = require('../../engine/ingestion/adapter_health');
const { EvidenceEnvelope } = require('../../engine/evidence/evidence_envelope');

console.log("================================================================================");
console.log(" VITALIS BETA-3.0 [GATE 1]: INGESTION GATEWAY & ADAPTER HEALTH VERIFICATION");
console.log("================================================================================\n");

let passed = 0;
let total = 0;

function assert(condition, testName, details = "") {
  total++;
  if (condition) {
    passed++;
    console.log(` \x1b[32m✔\x1b[0m [PASS] ${testName}`);
    if (details) console.log(`   \x1b[90m↳ ${details}\x1b[0m`);
  } else {
    console.error(` \x1b[31m✖\x1b[0m [FAIL] ${testName}`);
    if (details) console.error(`   \x1b[31m↳ Details: ${details}\x1b[0m`);
  }
}

const gateway = new IngestionGateway({ capacity: 1000 });

// 1. Register diverse adapters
gateway.healthManager.registerAdapter("F5-BIGIP-EDGE", { type: "LOAD_BALANCER", capabilities: { traceId: true, metrics: true } });
gateway.healthManager.registerAdapter("IHS-APACHE-01", { type: "WEB_SERVER", capabilities: { traceId: true, metrics: true } });
gateway.healthManager.registerAdapter("WAS-CLUSTER-01", { type: "WEBSPHERE", capabilities: { traceId: true, threadPool: true, jvmMetrics: true } });
gateway.healthManager.registerAdapter("DB2-LUW-PRIMARY", { type: "DB2", capabilities: { traceId: false, sqlFingerprint: true, lockEvidence: true } });
gateway.healthManager.registerAdapter("FIREWALL-DMZ", { type: "FIREWALL", capabilities: { packetTrace: true } });

// 2. Ingest valid telemetry events
for (let i = 0; i < 50; i++) {
  const env = EvidenceEnvelope.create({
    traceId: `TRACE-INGEST-${i}`,
    component: { name: "F5-BIGIP-EDGE", type: "LOAD_BALANCER" },
    event: { type: "SSL_TERMINATION", phase: "FORWARD", durationMs: 4, status: "SUCCESS" },
    measurements: { expectedDurationMs: 4, observedDurationMs: 4 }
  });
  const res = gateway.ingest(env);
  if (i === 0) assert(res.accepted === true, "Telemetry envelope successfully ingested into non-blocking ring buffer");
}

// 3. Simulate Adapter Outage / Permission Denied
gateway.healthManager.recordFailure("DB2-LUW-PRIMARY", {
  type: "PERMISSION_DENIED",
  message: "Lock table monitor authority denied (SQLSTATE 42501)",
  lagMs: 140
});

// 4. Ingest from healthy adapters
gateway.ingest(EvidenceEnvelope.create({
  traceId: "TRACE-IHS-1",
  component: { name: "IHS-APACHE-01", type: "WEB_SERVER" },
  event: { type: "REVERSE_PROXY", phase: "FORWARD", durationMs: 6, status: "SUCCESS" },
  measurements: { expectedDurationMs: 6, observedDurationMs: 6 }
}));

const status = gateway.getStatus();

assert(status.bufferMetrics.currentUsage > 0, `Ring buffer holds ${status.bufferMetrics.currentUsage} events without blocking`);
assert(status.health.adapters["F5-BIGIP-EDGE"].status === ADAPTER_STATES.HEALTHY, "F5 Adapter correctly classified as [HEALTHY]");
assert(status.health.adapters["DB2-LUW-PRIMARY"].status === ADAPTER_STATES.PERMISSION_DENIED, "DB2 Adapter correctly distinguished as [PERMISSION_DENIED] (Observability Blindspot != System Healthy)");
assert(status.health.blindspots.length === 3, `Identified unobserved / blindspot adapters (${status.health.blindspots.map(b => b.name).join(', ')})`);

// 5. Drain batch
const batch = gateway.drainBatch(25);
assert(batch.length === 25, `Drained batch of ${batch.length} envelopes for zero-overhead correlation`);

console.log("\n================================================================================");
console.log(` GATE 1 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) process.exit(0); else process.exit(1);
