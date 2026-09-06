/**
 * VITALIS Beta-3.0 Master Enterprise Validation Runner
 * Executes all 5 Acceptance Gates for Production Sensory Mesh & Verification.
 */

const { execSync } = require('child_process');
const path = require('path');

console.log("================================================================================");
console.log("   VITALIS BETA-3.0: PRODUCTION SENSORY MESH & ENTERPRISE VALIDATION HARNESS    ");
console.log("================================================================================\n");

const tests = [
  { name: "Gate 1: Real Ingestion & Adapter Health", script: "real_ingestion_test.js" },
  { name: "Gate 2: End-to-End Identity Continuity", script: "identity_continuity_test.js" },
  { name: "Gate 3: Imperfect & Adversarial Telemetry", script: "partial_telemetry_test.js" },
  { name: "Gate 4: Causal Counterfactual Validation", script: "causal_counterfactual_test.js" },
  { name: "Gate 5: Recovery State Machine & Proof", script: "recovery_state_machine_test.js" }
];

let allPassed = true;

for (const t of tests) {
  const scriptPath = path.join(__dirname, t.script);
  console.log(`\x1b[1m>>> RUNNING ${t.name}...\x1b[0m`);
  try {
    const output = execSync(`node "${scriptPath}"`, { stdio: 'pipe' }).toString();
    console.log(output);
    console.log(`\x1b[32m✔ ${t.name} COMPLETED SUCCESSFULLY\x1b[0m\n`);
  } catch (err) {
    console.error(`\x1b[31m✖ ${t.name} FAILED:\x1b[0m`);
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    allPassed = false;
    break;
  }
}

console.log("================================================================================");
if (allPassed) {
  console.log(" \x1b[32m✔ ALL 5 BETA-3.0 ENTERPRISE ACCEPTANCE GATES MATHEMATICALLY VERIFIED\x1b[0m");
} else {
  console.log(" \x1b[31m✖ BETA-3.0 VERIFICATION FAILED\x1b[0m");
}
console.log("================================================================================\n");

if (!allPassed) process.exit(1);
