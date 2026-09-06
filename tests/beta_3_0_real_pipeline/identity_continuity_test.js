/**
 * VITALIS Beta-3.0 Gate 2: End-to-End Identity Continuity & Explainability Test
 * Validates request reconstruction across F5 -> IHS -> WebSphere -> DB2 vertical slice,
 * protocol identity recovery, candidate rejection logging, and explainability claims.
 */

const { IdentityResolver } = require('../../engine/correlation/identity_resolver');
const { CorrelationExplanationEngine } = require('../../engine/correlation/correlation_explanation');
const { CandidateRejectionTracker } = require('../../engine/correlation/candidate_rejection');
const { EvidenceEnvelope } = require('../../engine/evidence/evidence_envelope');

console.log("================================================================================");
console.log(" VITALIS BETA-3.0 [GATE 2]: END-TO-END IDENTITY CONTINUITY & EXPLAINABILITY");
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

const traceId = "TX-ENTERPRISE-847392";

// 1. Telemetry with missing Trace ID at DB2 boundary
const envF5 = EvidenceEnvelope.create({
  traceId,
  component: { name: "F5-BIGIP-01", type: "LOAD_BALANCER" },
  event: { type: "SSL_TERMINATION", phase: "FORWARD", durationMs: 5, status: "SUCCESS" },
  measurements: { expectedDurationMs: 5, observedDurationMs: 5 }
});

const envIhs = EvidenceEnvelope.create({
  traceId,
  component: { name: "IHS-HTTP-01", type: "WEB_SERVER" },
  event: { type: "REVERSE_PROXY", phase: "FORWARD", durationMs: 7, status: "SUCCESS" },
  measurements: { expectedDurationMs: 7, observedDurationMs: 7 }
});

const envWas = EvidenceEnvelope.create({
  traceId,
  component: { name: "WebSphere-Cell-01", type: "WEBSPHERE" },
  event: { type: "SERVLET_EXECUTION", phase: "FORWARD", durationMs: 45, status: "SUCCESS" },
  measurements: { expectedDurationMs: 45, observedDurationMs: 45 },
  identity: { sqlFingerprint: "SELECT BAL FROM ACCOUNTS WHERE ID = ?", connectionId: "DB2-CONN-4421" }
});

const envDb2MissingTraceId = EvidenceEnvelope.create({
  traceId: null, // Trace ID stripped by legacy driver
  component: { name: "DB2-LUW-PRIMARY", type: "DB2" },
  event: { type: "SQL_EXECUTION", phase: "FORWARD", durationMs: 16, status: "SUCCESS" },
  measurements: { expectedDurationMs: 18, observedDurationMs: 16 },
  identity: { sqlFingerprint: "SELECT BAL FROM ACCOUNTS WHERE ID = ?", connectionId: "DB2-CONN-4421", dbPid: 77142 }
});

// 2. Perform Multi-Level Identity Resolution
const matchF5toIHS = IdentityResolver.matchIdentity(envF5, envIhs);
const matchIHStoWAS = IdentityResolver.matchIdentity(envIhs, envWas);
const matchWAStoDB2 = IdentityResolver.matchIdentity(envWas, envDb2MissingTraceId);

assert(matchF5toIHS.level === "LEVEL_1_EXACT", "F5 to IHS matched via LEVEL_1_EXACT (Trace ID)");
assert(matchIHStoWAS.level === "LEVEL_1_EXACT", "IHS to WAS matched via LEVEL_1_EXACT (Trace ID)");
assert(matchWAStoDB2.level === "LEVEL_2_PROTOCOL", "WAS to DB2 matched via LEVEL_2_PROTOCOL (SQL Fingerprint & Connection)");
assert(matchWAStoDB2.confidence >= 0.90, `Protocol Match Confidence is high (${matchWAStoDB2.confidence * 100}%)`);

// 3. Candidate Rejection Tracking
const rejectionTracker = new CandidateRejectionTracker();
rejectionTracker.recordRejection({
  targetTraceId: traceId,
  candidateTraceId: "TX-ENTERPRISE-847391",
  reason: "TEMPORAL_WINDOW_EXCEEDED",
  divergentFactor: "Timestamp delta > 5000ms"
});

const rejections = rejectionTracker.getRejectionsForTrace(traceId);
assert(rejections.length === 1, "Candidate rejection recorded in audit trail");

// 4. Generate Machine-Readable Correlation Explanation
const explanation = CorrelationExplanationEngine.explain({
  traceId,
  matchedBy: ["sqlFingerprint", "temporalWindow", "dbConnectionIdentity"],
  missingEvidence: ["db2_trace_id", "parent_span_id"],
  rejectedCandidates: rejections,
  method: "LEVEL_2_PROTOCOL",
  confidence: 0.92
});

assert(explanation.method === "LEVEL_2_PROTOCOL", "Explanation specifies LEVEL_2_PROTOCOL");
assert(explanation.missing.includes("db2_trace_id"), "Explanation explicitly declares missing trace ID");
assert(explanation.explanationStatement.includes("direct trace ID was unavailable"), "Generated clear, honest human-readable statement");

console.log("\n================================================================================");
console.log(` GATE 2 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) process.exit(0); else process.exit(1);
