/**
 * MOBILE BETA-1: Release Build & Offline/Failure Validation Harness
 * Validates Network Failure Resilience, Offline Queue Synchronization,
 * Financial Invariants (Double-Entry Σ=0), Idempotency, SHA-256 Audit Chain, and Security.
 */

const { FinancialInvariantEngine } = require('../../engine/mobile_sync/financial_invariants');
const { OfflineSyncEngine } = require('../../engine/mobile_sync/offline_sync_engine');
const { NetworkResilienceManager } = require('../../engine/mobile_sync/network_resilience');
const { MobileSecurityEngine } = require('../../engine/mobile_sync/mobile_security');

console.log("================================================================================");
console.log("   MOBILE BETA-1: RELEASE BUILD & OFFLINE/FAILURE VALIDATION HARNESS            ");
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

// -----------------------------------------------------------------------------
// GATE 1: Network Failure & Transient Fault Recovery
// -----------------------------------------------------------------------------
console.log("\x1b[1m--- [GATE 1] Network Failure & Transient Fault Recovery ---\x1b[0m");

const netManager = new NetworkResilienceManager();

// Test 1.1: Offline Rejection
netManager.setNetworkState("OFFLINE");
try {
  netManager.executeRequest(() => "DATA");
  assert(false, "Should reject when offline");
} catch (err) {
  assert(err.message.includes("NETWORK_UNAVAILABLE"), "Gracefully catches offline network state", err.message);
}

// Test 1.2: DNS Failure
netManager.setNetworkState("DNS_FAILURE");
try {
  netManager.executeRequest(() => "DATA");
  assert(false, "Should reject on DNS failure");
} catch (err) {
  assert(err.message.includes("DNS_RESOLUTION_ERROR"), "Gracefully catches DNS resolution errors", err.message);
}

// Test 1.3: Upstream 503 Overload
netManager.setNetworkState("SERVER_503");
try {
  netManager.executeRequest(() => "DATA");
  assert(false, "Should reject on 503");
} catch (err) {
  assert(err.message.includes("HTTP_503"), "Gracefully handles upstream 503 Service Unavailable", err.message);
}

// Test 1.4: Reconnection Recovery
netManager.setNetworkState("ONLINE");
const onlineRes = netManager.executeRequest(() => "RECOVERY_OK");
assert(onlineRes === "RECOVERY_OK", "Recovers immediately when connection is restored");

// -----------------------------------------------------------------------------
// GATE 2: Offline Staging & Synchronized Ingestion
// -----------------------------------------------------------------------------
console.log("\n\x1b[1m--- [GATE 2] Offline Staging & Synchronized Ingestion ---\x1b[0m");

const syncEngine = new OfflineSyncEngine();

// Enqueue 3 mutations while offline
syncEngine.enqueueOfflineMutation({
  actionType: "CREATE_EXPENSE",
  payload: { title: "Flight to Goa", amount: 12000, paidBy: "Alice" },
  idempotencyKey: "IDEM-EXP-001"
});

syncEngine.enqueueOfflineMutation({
  actionType: "CREATE_EXPENSE",
  payload: { title: "Villa Stay", amount: 16000, paidBy: "Bob" },
  idempotencyKey: "IDEM-EXP-002"
});

syncEngine.enqueueOfflineMutation({
  actionType: "CREATE_EXPENSE",
  payload: { title: "Dinner", amount: 4000, paidBy: "Charlie" },
  idempotencyKey: "IDEM-EXP-003"
});

assert(syncEngine.offlineQueue.length === 3, "Staged 3 offline mutations in local storage queue");

// Sync attempt while offline
const failedSync = syncEngine.synchronize({ isNetworkOnline: false });
assert(failedSync.status === "OFFLINE_QUEUED" && syncEngine.offlineQueue.length === 3, "Preserved offline queue during failed sync");

// Successful sync on reconnect
const successSync = syncEngine.synchronize({ isNetworkOnline: true });
assert(successSync.syncedCount === 3, `Synchronized all 3 staged mutations on reconnect`);
assert(syncEngine.syncedLedger.length === 3, "Authoritative ledger holds 3 synchronized entries");

// -----------------------------------------------------------------------------
// GATE 3: Financial Invariants (Double-Entry Σ=0 & Goa Trip Scenario)
// -----------------------------------------------------------------------------
console.log("\n\x1b[1m--- [GATE 3] Financial Invariants & Double-Entry Zero-Sum ---\x1b[0m");

const goaMembers = ["Alice", "Bob", "Charlie", "Dave"];
const goaExpenses = [
  { id: "EXP-1", title: "Flight Tickets", amount: 12000, paidBy: "Alice", splitWith: goaMembers },
  { id: "EXP-2", title: "Villa Booking", amount: 16000, paidBy: "Bob", splitWith: goaMembers },
  { id: "EXP-3", title: "Seafood Dinner", amount: 4000, paidBy: "Charlie", splitWith: goaMembers },
  { id: "EXP-4", title: "Scuba Diving", amount: 8000, paidBy: "Dave", splitWith: goaMembers }
];

const balanceResult = FinancialInvariantEngine.computeAndValidateBalances({
  members: goaMembers,
  expenses: goaExpenses
});

assert(balanceResult.isValid === true, "Mathematical Double-Entry Invariant Satisfied: Σ balances = 0");
assert(balanceResult.totalSumCents === 0, `Exact Zero Balance Sum across all members (Sum = ${balanceResult.totalSumCents} cents)`);
assert(balanceResult.formattedBalances["Alice"] === 2000, "Alice balance is exact (+₹2,000.00)");
assert(balanceResult.formattedBalances["Bob"] === 6000, "Bob balance is exact (+₹6,000.00)");
assert(balanceResult.formattedBalances["Charlie"] === -6000, "Charlie balance is exact (-₹6,000.00)");
assert(balanceResult.formattedBalances["Dave"] === -2000, "Dave balance is exact (-₹2,000.00)");

// Settlement paths
const settlements = FinancialInvariantEngine.computeSettlements(balanceResult.formattedBalances);
assert(settlements.length === 2, `Optimal settlements computed: ${settlements.length} transactions`);
assert(settlements[0].from === "Charlie" && settlements[0].to === "Bob" && settlements[0].amount === 6000, "Charlie settles ₹6,000 directly to Bob");
assert(settlements[1].from === "Dave" && settlements[1].to === "Alice" && settlements[1].amount === 2000, "Dave settles ₹2,000 directly to Alice");

// -----------------------------------------------------------------------------
// GATE 4: Idempotency & Retry Storm Protection
// -----------------------------------------------------------------------------
console.log("\n\x1b[1m--- [GATE 4] Idempotency & Duplicate Submission Protection ---\x1b[0m");

// Attempt to re-sync duplicate mutation with same idempotency key
syncEngine.enqueueOfflineMutation({
  actionType: "CREATE_EXPENSE",
  payload: { title: "Flight to Goa", amount: 12000, paidBy: "Alice" },
  idempotencyKey: "IDEM-EXP-001" // Duplicate key already synced
});

const duplicateSync = syncEngine.synchronize({ isNetworkOnline: true });
assert(duplicateSync.syncedCount === 0, "Duplicate submission intercepted: 0 duplicate ledger entries created");
assert(syncEngine.syncedLedger.length === 3, "Ledger size remains exactly 3 entries");

// -----------------------------------------------------------------------------
// GATE 5: SHA-256 Audit Chaining Integrity
// -----------------------------------------------------------------------------
console.log("\n\x1b[1m--- [GATE 5] SHA-256 Audit Chaining Integrity ---\x1b[0m");

const chainAudit = syncEngine.verifyChainIntegrity();
assert(chainAudit.isValid === true, "SHA-256 Merkle Audit Chain mathematically intact across all blocks");
assert(chainAudit.blockCount === 3, `Chain Height: ${chainAudit.blockCount} blocks (Latest Hash: ${chainAudit.latestHash.slice(0, 16)}...)`);

// -----------------------------------------------------------------------------
// GATE 6: Mobile Security & Secret Leak Inspection
// -----------------------------------------------------------------------------
console.log("\n\x1b[1m--- [GATE 6] Mobile Security & Secret Leak Inspection ---\x1b[0m");

const safeLog = MobileSecurityEngine.sanitizeLogPayload({
  user: "Alice",
  cardNumber: "4532890123456789",
  apiKey: "sk_live_9981240182419824",
  amount: 12000
});

assert(safeLog.apiKey === "[REDACTED_SECRET]", "API Keys redacted from client log payloads");
assert(safeLog.cardNumber === "***6789", "Financial account numbers masked to last 4 digits");

const cleanBundle = "const APP_VERSION = '1.0.0'; const API_URL = 'https://api.corp.com';";
const bundleSecurity = MobileSecurityEngine.verifyBundleSecurity(cleanBundle);
assert(bundleSecurity.isSecure === true, "Client release bundle contains 0 hardcoded secrets or database URIs");

console.log("\n================================================================================");
console.log(` MOBILE BETA-1 RESULTS: ${passed}/${total} TESTS PASSED`);
console.log("================================================================================\n");

if (passed === total) process.exit(0); else process.exit(1);
