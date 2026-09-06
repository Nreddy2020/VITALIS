/**
 * VITALIS Beta-3.0 Gate 3: Imperfect Telemetry & Adversarial Test
 * Validates system resilience against out-of-order events, clock skew,
 * duplicate spans, conflicting metrics, and partial traces.
 */

const { TemporalCorrelator } = require('../../engine/correlation/temporal_correlator');
const { ConflictResolver } = require('../../engine/correlation/conflict_resolver');
const { DuplicateDetector } = require('../../engine/correlation/duplicate_detector');
const { CorrelationQuality } = require('../../engine/correlation/correlation_quality');
const { EvidenceEnvelope } = require('../../engine/evidence/evidence_envelope');

console.log("================================================================================");
console.log(" VITALIS BETA-3.0 [GATE 3]: IMPERFECT & ADVERSARIAL TELEMETRY RESILIENCE");
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

// 1. Clock Skew & Temporal Normalization
const skewedEnvelopes = [
  EvidenceEnvelope.create({
    traceId: "ADVERSARIAL-01",
    component: { name: "DB2-SERVER", type: "DB2" },
    event: { type: "SQL_EXECUTION", timestamp: "2026-09-06T10:00:01.000Z", durationMs: 20 },
    measurements: { observedDurationMs: 20 }
  }),
  EvidenceEnvelope.create({
    traceId: "ADVERSARIAL-01",
    component: { name: "F5-BIGIP", type: "LOAD_BALANCER" },
    event: { type: "SSL_TERMINATION", timestamp: "2026-09-06T10:00:04.000Z", durationMs: 5 },
    measurements: { observedDurationMs: 5 }
  })
];

const normalized = TemporalCorrelator.normalizeTimestamps(skewedEnvelopes, { "DB2-SERVER": -3000 });
const ordered = TemporalCorrelator.orderCausalSequence(normalized);
assert(ordered[0].component.type === "LOAD_BALANCER", "Temporal Correlator restored physical pipeline precedence (F5 before DB2)");

// 2. Duplicate Detection
const duplicateList = [
  skewedEnvelopes[1],
  skewedEnvelopes[1] // Retransmitted duplicate
];
const dedup = DuplicateDetector.deduplicateEnvelopes(duplicateList);
assert(dedup.duplicateCount === 1, "Duplicate Detector intercepted retransmitted span");
assert(dedup.uniqueEnvelopes.length === 1, "Retained single canonical span");

// 3. Multi-Source Conflict Detection
const conflictingEnvelopes = [
  EvidenceEnvelope.create({
    traceId: "ADVERSARIAL-02",
    component: { name: "WAS_JDBC_METRIC", type: "DB2" },
    event: { type: "SQL_EXECUTION", durationMs: 3950 },
    measurements: { observedDurationMs: 3950 },
    provenance: { sourceSystem: "WAS_JDBC" }
  }),
  EvidenceEnvelope.create({
    traceId: "ADVERSARIAL-02",
    component: { name: "DB2_KERNEL_METRIC", type: "DB2" },
    event: { type: "SQL_EXECUTION", durationMs: 18 },
    measurements: { observedDurationMs: 18 },
    provenance: { sourceSystem: "DB2_KERNEL" }
  })
];

const conflicts = ConflictResolver.detectConflicts(conflictingEnvelopes);
assert(conflicts.hasConflicts === true, "Conflict Resolver flagged measurement divergence (3950ms vs 18ms)");
assert(conflicts.conflicts[0].resolutionStrategy === "PRESERVE_BOTH_SOURCES", "Preserved both factual reports rather than discarding evidence");

// 4. Partial Telemetry Truth Status
const quality = CorrelationQuality.evaluateTruthStatus({
  envelopes: [skewedEnvelopes[0]], // Only 1 hop out of 10
  expectedHopCount: 10,
  hasConflicts: false,
  isCausallyConsistent: true,
  identityMatchLevel: "LEVEL_1_EXACT",
  causalConfidence: 0.5
});

assert(quality.overallTruthStatus === "INSUFFICIENT_EVIDENCE", "Partial 1-hop telemetry correctly classified as [INSUFFICIENT_EVIDENCE]");

console.log("\n================================================================================");
console.log(` GATE 3 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) process.exit(0); else process.exit(1);
