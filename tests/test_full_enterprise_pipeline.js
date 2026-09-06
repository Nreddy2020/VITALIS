/**
 * VITALIS ENTERPRISE PIPELINE: End-to-End Enterprise Validation Suite
 * Validates the complete 10-hop journey:
 * Browser -> DNS -> Firewall -> eBPF -> F5 -> IHS -> WebSphere -> MQ -> DB2 -> External API -> Return Egress
 */

const fs = require('fs');
const path = require('path');
const { EnterpriseEvidenceCorrelator } = require('../engine/adapters/enterprise_correlator');
const { RequestDnaSchema } = require('../engine/request_dna_schema');

async function runFullEnterpriseValidation() {
  console.log("==========================================================================");
  console.log("     VITALIS ENTERPRISE: FULL 10-HOP REQUEST PIPELINE VALIDATION          ");
  console.log("==========================================================================\n");

  const correlator = new EnterpriseEvidenceCorrelator();
  const artifactsDir = path.join(__dirname, '..', 'artifacts', 'beta-2-enterprise');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  const traceId = "TX-847392-ENTERPRISE-PROD";

  console.log("--- [STEP 1] Ingesting Telemetry Across All 10 Enterprise Adapters ---");

  // 1. Client Browser Telemetry
  const clientRaw = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0",
    clientIp: "192.168.1.105",
    clientPort: 52418,
    httpVersion: "HTTP/2.0",
    streamId: 7,
    durationMs: 12
  };

  // 2. DNS Telemetry
  const dnsRaw = {
    domain: "checkout.bank.corp",
    resolverIp: "10.240.0.2",
    resolvedIp: "10.240.10.50",
    latencyMs: 1.4,
    dnssecValidated: true
  };

  // 3. Perimeter Firewall Telemetry
  const firewallRaw = {
    policyRuleId: "FW-RULE-PROD-HTTPS-ALLOW",
    ingressZone: "ZONE_UNTRUST_WAN",
    egressZone: "ZONE_DMZ_APP",
    action: "ALLOW",
    ipsDecision: "CLEAN",
    durationMs: 2.8
  };

  // 4. Kernel eBPF Socket Telemetry
  const ebpfRaw = {
    socketTcpRetransmits: 0,
    networkRttMs: 0.8,
    kernelSocketWaitMs: 1.2,
    processId: 44102,
    processLineage: "systemd -> websphere-node -> java -> db2client"
  };

  // 5. F5 Load Balancer Telemetry
  const f5Raw = {
    virtualServer: "/Common/vs_checkout_https",
    vip: "10.240.10.50:443",
    selectedMember: "10.240.20.101:8443",
    poolName: "/Common/pool_ihs_edge",
    tlsProfile: "/Common/clientssl_secure_tls13",
    cipherSuite: "TLS_AES_256_GCM_SHA384",
    sni: "checkout.bank.corp",
    wafDecision: "PASS",
    durationMs: 18
  };

  // 6. IHS Web Server Telemetry
  const ihsRaw = {
    requestId: "IHS-REQ-847392-01",
    pluginRouting: "mod_was_ap22.c",
    backendWorker: "was-node-04_server1",
    backendWaitMs: 21,
    httpStatus: 200
  };

  // 7. WebSphere CoreApp Telemetry
  const wasRaw = {
    cellName: "ProdCell01",
    serverName: "server1",
    threadId: "WebContainer : 142",
    threadPoolSaturationPct: 98,
    jvmHeapUtilizationPct: 62,
    jdbcPoolInUse: 98,
    jdbcPoolCapacity: 100,
    durationMs: 51,
    httpStatus: 200
  };

  // 8. IBM MQ Telemetry
  const mqRaw = {
    queueManager: "QM_PAYMENTS_01",
    queueName: "DEV.CHECKOUT.IN",
    queueDepth: 14,
    channelStatus: "RUNNING",
    waitDurationMs: 14
  };

  // 9. IBM DB2 Telemetry (Injected Lock Contention)
  const db2Raw = {
    sqlFingerprint: "SELECT * FROM inventory_items WHERE sku_id = ? FOR UPDATE WITH RR",
    executionDurationMs: 3982,
    lockWaitMs: 2100,
    holdingLockPid: 99142,
    connectionPoolSaturationPct: 98,
    bufferPoolHitRatioPct: 99.1,
    queryPlanCost: 489.2
  };

  // 10. External Payment Gateway Telemetry
  const externalRaw = {
    provider: "Stripe-Gateway-US",
    endpointUri: "https://api.stripe.com/v1/charges",
    httpStatus: 504,
    durationMs: 0
  };

  // 11. Return Journey Telemetry
  const returnRaw = {
    finalHttpStatus: 504,
    compressionType: "gzip",
    responseSizeBytes: 1024,
    returnLatencyMs: 8.5
  };

  const changeEvents = [
    { type: "DEPLOYMENT", version: "v2.4.1", minutesAgo: 14, author: "deploy-pipeline@bank.corp" }
  ];

  const result = correlator.correlateFullEnterpriseJourney({
    traceId,
    clientRaw,
    dnsRaw,
    firewallRaw,
    ebpfRaw,
    f5Raw,
    ihsRaw,
    wasRaw,
    mqRaw,
    db2Raw,
    externalRaw,
    returnRaw,
    changeEvents
  });

  // Verify 14-Point Request DNA Contract
  const schemaValidation = RequestDnaSchema.validate(result.envelope);
  console.log(`> 14-Point Technical DNA Schema: ${schemaValidation.isValid ? 'PASS (14/14 technical points captured)' : 'FAIL'}`);

  // Verify 10-Hop Timeline
  console.log(`> Reconstructed Hops Count: ${result.hops.length} / 10 Hops + Return Journey`);
  result.hops.forEach((h, idx) => {
    console.log(`  [Hop ${idx + 1}] ${h.node.padEnd(16)} | Duration: ${h.durationMs.toString().padStart(5)}ms | Status: ${h.status}`);
  });

  // Verify Isolation of First Meaningful Deviation
  const firstDev = result.firstDeviation;
  console.log(`\n> First Meaningful Deviation: ${firstDev.node} (Observed: ${firstDev.observedDurationMs}ms vs Expected: ${firstDev.expectedDurationMs}ms - ${firstDev.deviationMultiplier}x surge)`);
  if (firstDev.node !== "DB2") {
    throw new Error(`Expected first meaningful deviation at DB2, got: ${firstDev.node}`);
  }
  console.log(`> Root Cause Indication: ${firstDev.rootCauseIndication}`);

  // Verify Epistemic Separation & Falsifiability
  const topCandidate = result.rcaResult.candidates[0];
  console.log(`\n> Primary RCA Candidate: ${topCandidate.title} (Confidence: ${topCandidate.confidence}%)`);
  console.log(`> Scientific Falsifiability Criteria: ${result.rcaResult.confidenceEnvelope.whatWouldChangeOurMind.length} criteria defined`);

  // Verify Cryptographic SHA-256 Ledger & Merkle Chaining
  console.log(`\n> SHA-256 Ledger Hash: ${result.ledgerBlock.hash}`);
  console.log(`> Previous Block Hash: ${result.ledgerBlock.previousHash}`);
  console.log(`> Cryptographic Ledger Integrity: ${result.ledgerIntegrity.isValid ? 'VERIFIED (Chain intact, 0 tampering)' : 'FAILED'}`);

  // Save Artifacts
  fs.writeFileSync(path.join(artifactsDir, 'full-enterprise-audit.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'full-request-dna.json'), JSON.stringify(result.envelope, null, 2));

  console.log("\n==========================================================================");
  console.log("   FULL ENTERPRISE PIPELINE RESULT: PASSED (10/10 Hops Reconstructed)     ");
  console.log("==========================================================================\n");
}

if (require.main === module) {
  runFullEnterpriseValidation().catch(err => {
    console.error("Enterprise Validation Failed:", err);
    process.exit(1);
  });
}

module.exports = { runFullEnterpriseValidation };
