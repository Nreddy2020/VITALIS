/**
 * VITALIS Request Truth Orchestrator End-to-End Integration Test
 */

const { RequestTruthOrchestrator } = require('../engine/request_truth_orchestrator');
const { EnterpriseEvidenceCorrelator } = require('../engine/adapters/enterprise_correlator');
const { EvidenceEnvelope } = require('../engine/evidence/evidence_envelope');

console.log("================================================================================");
console.log(" VITALIS: END-TO-END REQUEST TRUTH ORCHESTRATOR INTEGRATION SUITE");
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

// 1. Build a 10-hop enterprise telemetry stream
const correlator = new EnterpriseEvidenceCorrelator();
const traceId = "ORCH-TRUTH-TEST-1001";

const rawHops = [
  EvidenceEnvelope.create({
    traceId,
    component: { name: "Client-Browser", type: "CLIENT" },
    event: { type: "HTTP_DISPATCH", phase: "FORWARD", durationMs: 4, status: "SUCCESS" },
    measurements: { expectedDurationMs: 4, observedDurationMs: 4 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "CoreDNS-Internal", type: "DNS" },
    event: { type: "DNS_LOOKUP", phase: "FORWARD", durationMs: 2, status: "SUCCESS" },
    measurements: { expectedDurationMs: 2, observedDurationMs: 2 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "PaloAlto-FW-DMZ", type: "FIREWALL" },
    event: { type: "PACKET_INSPECTION", phase: "FORWARD", durationMs: 1, status: "SUCCESS" },
    measurements: { expectedDurationMs: 1, observedDurationMs: 1 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "F5-BIGIP-01", type: "LOAD_BALANCER" },
    event: { type: "SSL_TERMINATION", phase: "FORWARD", durationMs: 5, status: "SUCCESS" },
    measurements: { expectedDurationMs: 5, observedDurationMs: 5 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "IHS-HTTP-01", type: "WEB_SERVER" },
    event: { type: "REVERSE_PROXY", phase: "FORWARD", durationMs: 8, status: "SUCCESS" },
    measurements: { expectedDurationMs: 8, observedDurationMs: 8 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "WebSphere-Cell-01", type: "WEBSPHERE" },
    event: { type: "SERVLET_EXECUTION", phase: "FORWARD", durationMs: 3850, status: "FAILED" },
    measurements: { expectedDurationMs: 50, observedDurationMs: 3850, connectionPoolUtilization: 0.98, queueDepth: 120 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "IBM-MQ-QM01", type: "MESSAGE_BROKER" },
    event: { type: "MESSAGE_PUT", phase: "FORWARD", durationMs: 12, status: "SUCCESS" },
    measurements: { expectedDurationMs: 12, observedDurationMs: 12 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "DB2-LUW-CLUSTER", type: "DB2" },
    event: { type: "SQL_EXECUTION", phase: "FORWARD", durationMs: 3810, status: "FAILED" },
    measurements: { expectedDurationMs: 18, observedDurationMs: 3810, lockWaitMs: 3790, lockType: "EXCLUSIVE_ROW" },
    identity: { dbPid: 88712, blockingPid: 88712 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "Stripe-Payment-API", type: "EXTERNAL_GATEWAY" },
    event: { type: "HTTP_PAYMENT_CHARGE", phase: "FORWARD", durationMs: 42, status: "SUCCESS" },
    measurements: { expectedDurationMs: 42, observedDurationMs: 42 }
  }),
  EvidenceEnvelope.create({
    traceId,
    component: { name: "Client-Browser-Return", type: "CLIENT" },
    event: { type: "HTTP_RESPONSE_RECEIVE", phase: "RETURN", durationMs: 3, status: "FAILED" },
    measurements: { expectedDurationMs: 3, observedDurationMs: 3 }
  })
];

const orchestrator = new RequestTruthOrchestrator();

const result = orchestrator.processRequestJourney({
  traceId,
  rawHops,
  financialContext: {
    transactionType: "SETTLEMENT_PAYMENT",
    customerTier: "TIER_1_ENTERPRISE",
    nominalValueUsd: 500000
  }
});

assert(result.traceId === traceId, "Orchestrator processed matching Trace ID");
assert(result.causalAssessment.confidence >= 0.85, `Causal assessment produced high confidence diagnosis (${(result.causalAssessment.confidence * 100).toFixed(1)}%)`);
assert(result.qualityScore.evidenceCompleteness >= 0.8, `Evidence completeness is high (${(result.qualityScore.evidenceCompleteness * 100).toFixed(1)}%)`);
assert(result.qualityScore.overallTruthStatus === "VERIFIED" || result.qualityScore.overallTruthStatus === "STRONGLY_SUPPORTED", `Overall truth status is robust: ${result.qualityScore.overallTruthStatus}`);
assert(result.businessImpact.financialExposure.estimatedAtRisk > 0, `Business impact calculated accurately (${result.businessImpact.financialExposure.formattedExposure})`);
assert(result.ledgerBlock.hash && result.ledgerBlock.hash.length === 64, `Evidence cryptographically sealed into SHA-256 Ledger (Hash: ${result.ledgerBlock.hash.slice(0, 16)}...)`);

// Verify ledger integrity
const integrity = orchestrator.ledger.verifyLedgerIntegrity();
assert(integrity.isValid === true, "Ledger integrity mathematically verified across all blocks");

// Remediation verification
const recovery = orchestrator.verifyRemediation({
  traceId,
  preFixEnvelopes: rawHops,
  remediationAction: "KILL_LOCK_PID_88712",
  goldenBaseline: { expectedTotalMs: 147 }
});

assert(recovery.recoveryVerified === true, "Remediation verified: Nominal golden baseline restored");
assert(recovery.comparison.latencyReductionPct > 95, `Remediation achieved ${recovery.comparison.latencyReductionPct}% latency reduction`);

console.log("\n================================================================================");
console.log(` RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}
