/**
 * VITALIS STAGE 9 — Compatibility drift
 *
 * The capability `03_Competitive_Reality.md` §4 identified as the strongest
 * wedge: nothing on the market asks whether the versions of the things a
 * request actually touches are mutually compatible.
 *
 * These gates are written to catch the two ways a drift checker fails, and the
 * second is the dangerous one:
 *
 *   1. It misses a real incompatibility.
 *   2. It reports "no problems" when it simply had no rule to apply — a green
 *      tick that means nothing, which is worse than no tool at all.
 *
 * So roughly half of these gates exist to prove the checker is honest about the
 * limits of its own knowledge.
 *
 *  D1  A real incompatibility (Expo SDK 57 with React Native 0.85) is caught.
 *  D2  A correct pairing (SDK 54 / RN 0.81 / React 19.1.0) is SATISFIED.
 *  D3  An SDK with no rule (51) produces NO findings — and the summary says so
 *      rather than reporting health.
 *  D4  Uncovered dependencies are counted as UNKNOWN, and the summary never
 *      claims the application is compatible.
 *  D5  A rule with no source URL is REFUSED at load time (fabrication guard).
 *  D6  With no lockfile, findings are INFERRED, never OBSERVED.
 *  D7  Expo SDK 55 with newArchEnabled:false is a VIOLATION.
 *  D8  An operator outside the closed vocabulary yields UNKNOWN, never SATISFIED.
 *  D9  A publisher-deprecated package (expo-random) is caught.
 *
 * Outputs: artifacts/stage9-drift-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readRepo } = require('../engine/drift/manifest_reader');
const { checkDrift, summarise } = require('../engine/drift/drift_checker');
const { loadRules, RULES } = require('../engine/drift/compatibility_rules');
const { evaluate } = require('../engine/drift/version_ops');

const report = { suite: 'stage9-drift', startedAt: new Date().toISOString(), gates: {}, evidence: {} };

/** Build a throwaway repository on disk. Real files, real reads — no mocks. */
function fixture(name, { deps = {}, lock = true, appJson = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vitalis-drift-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', dependencies: deps }, null, 2));
  if (lock) {
    const packages = { '': { name, version: '1.0.0' } };
    for (const [n, v] of Object.entries(deps)) {
      packages[`node_modules/${n}`] = { version: String(v).replace(/^[~^]/, '') };
    }
    fs.writeFileSync(path.join(dir, 'package-lock.json'),
      JSON.stringify({ name, lockfileVersion: 3, packages }, null, 2));
  }
  if (appJson) fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(appJson, null, 2));
  return dir;
}

const run = (dir) => checkDrift(readRepo(dir));
const find = (res, id) => res.findings.find(f => f.ruleId === id);
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}

console.log('==================================================================');
console.log('VITALIS STAGE 9 — COMPATIBILITY DRIFT GATES');
console.log('==================================================================');

// ---------------------------------------------------------------- D1
{
  const dir = fixture('bad', { deps: { expo: '57.0.0', 'react-native': '0.85.0', react: '19.2.3' } });
  const res = run(dir);
  const f = find(res, 'expo-sdk-57-react-native');
  const passed = !!f && f.status === 'VIOLATION' && f.provenance === 'OBSERVED';
  report.evidence.D1 = f;
  gate('D1_realIncompatibilityCaught', 'D1 Expo SDK 57 + React Native 0.85', passed, [
    `finding status : ${f && f.status}`,
    `detail         : ${f && f.detail}`,
    `source         : ${f && f.source.url}`
  ]);
}

// ---------------------------------------------------------------- D2
{
  const dir = fixture('good', {
    deps: { expo: '54.0.35', 'react-native': '0.81.5', react: '19.1.0', 'react-native-web': '0.21.0' }
  });
  const res = run(dir);
  const rn = find(res, 'expo-sdk-54-react-native');
  const rc = find(res, 'expo-sdk-54-react');
  const passed = !!rn && rn.status === 'SATISFIED' && !!rc && rc.status === 'SATISFIED'
    && res.coverage.violations === 0;
  report.evidence.D2 = { rn, rc, violations: res.coverage.violations };
  gate('D2_correctPairingSatisfied', 'D2 Expo SDK 54 + RN 0.81.5 + React 19.1.0', passed, [
    `react-native   : ${rn && rn.status} — ${rn && rn.detail}`,
    `react          : ${rc && rc.status}`,
    `violations     : ${res.coverage.violations}`
  ]);
}

// ---------------------------------------------------------------- D3
{
  const dir = fixture('nosdkrule', { deps: { expo: '51.0.0', 'react-native': '0.74.5' } });
  const res = run(dir);
  const anyExpoFinding = res.findings.some(f => f.ruleId.startsWith('expo-sdk-'));
  const summary = summarise(res);
  // The critical assertion: silence about SDK 51 must NOT read as approval.
  const passed = !anyExpoFinding
    && res.coverage.violations === 0
    && res.coverage.packagesUncovered > 0
    && /UNKNOWN, which is not the same as compatible/.test(summary);
  report.evidence.D3 = { findings: res.findings.length, summary, uncovered: res.coverage.uncovered };
  gate('D3_unknownSdkNotReportedHealthy', 'D3 Expo SDK 51 — no rule exists', passed, [
    `expo-sdk findings : ${res.findings.filter(f => f.ruleId.startsWith('expo-sdk-')).length} (must be 0)`,
    `uncovered deps    : ${res.coverage.packagesUncovered}`,
    `summary           : ${summary}`
  ]);
}

// ---------------------------------------------------------------- D4
{
  const dir = fixture('coverage', {
    deps: { expo: '54.0.35', 'react-native': '0.81.5', axios: '1.18.1', 'date-fns': '4.1.0', clsx: '2.1.1' }
  });
  const res = run(dir);
  const summary = summarise(res);
  const uncoveredNames = res.coverage.uncovered.map(u => u.name);
  const passed = uncoveredNames.includes('axios')
    && uncoveredNames.includes('date-fns')
    && res.coverage.packagesUncovered >= 3
    && !/\bis compatible\b/i.test(summary)
    && !/^no issues/i.test(summary);
  report.evidence.D4 = { coverage: res.coverage, summary };
  gate('D4_uncoveredCountedUnknown', 'D4 Uncovered dependencies are UNKNOWN, not compatible', passed, [
    `deps read      : ${res.coverage.packagesRead}`,
    `covered        : ${res.coverage.packagesCovered}`,
    `uncovered      : ${res.coverage.packagesUncovered} → ${uncoveredNames.join(', ')}`,
    `summary claims no compatibility: ${!/\bis compatible\b/i.test(summary)}`
  ]);
}

// ---------------------------------------------------------------- D5
{
  let threw = null;
  try {
    loadRules([{
      id: 'unsourced-claim',
      description: 'Something I believe but cannot attribute',
      when: { package: 'expo', constraint: { op: 'majorEquals', value: 54 } },
      require: { package: 'react-native', constraint: { op: 'minorMatch', value: '0.81' } },
      severity: 'HIGH'
      // no source
    }]);
  } catch (err) { threw = err.message; }
  const realRulesLoad = (() => { try { return loadRules(RULES).length; } catch (e) { return -1; } })();
  const passed = threw !== null && /source\.url/.test(threw) && realRulesLoad > 0;
  report.evidence.D5 = { rejection: threw, shippedRulesLoaded: realRulesLoad };
  gate('D5_unsourcedRuleRefused', 'D5 A rule with no source URL is refused', passed, [
    `rejection       : ${threw}`,
    `shipped rules   : ${realRulesLoad} loaded (all carry a source URL)`
  ]);
}

// ---------------------------------------------------------------- D6
{
  const dir = fixture('nolock', { deps: { expo: '~54.0.35', 'react-native': '0.81.5' }, lock: false });
  const res = run(dir);
  const f = find(res, 'expo-sdk-54-react-native');
  // Case-insensitive: the warning is raised by the npm ecosystem module, which
  // prefixes it with the directory. What is asserted is that the missing
  // lockfile is reported at all, not its exact wording.
  const warned = res.warnings.some(w => /no package-lock\.json/i.test(w) && /INFERRED/.test(w));
  const passed = !!f && f.provenance === 'INFERRED' && warned;
  report.evidence.D6 = { finding: f, warnings: res.warnings };
  gate('D6_noLockfileIsInferred', 'D6 Without a lockfile, evidence is INFERRED not OBSERVED', passed, [
    `provenance : ${f && f.provenance} (must be INFERRED)`,
    `warning    : ${res.warnings[0]}`
  ]);
}

// ---------------------------------------------------------------- D7
{
  const dir = fixture('newarch', {
    deps: { expo: '55.0.0', 'react-native': '0.83.0', react: '19.2.0' },
    appJson: { expo: { name: 'x', slug: 'x', newArchEnabled: false } }
  });
  const res = run(dir);
  const f = find(res, 'expo-sdk-55-plus-new-architecture-mandatory');
  const passed = !!f && f.status === 'VIOLATION';
  report.evidence.D7 = f;
  gate('D7_newArchMandatoryEnforced', 'D7 SDK 55 with newArchEnabled:false', passed, [
    `status : ${f && f.status}`,
    `detail : ${f && f.detail}`,
    `source : ${f && f.source.url}`
  ]);
}

// ---------------------------------------------------------------- D8
{
  const bogus = evaluate({ op: 'approximatelyCompatibleWith', value: '0.81' }, '0.85.0');
  const missing = evaluate({ op: 'minorMatch', value: '0.81' }, '^0.81.0');
  const passed = bogus.result === 'UNKNOWN' && /unsupported operator/.test(bogus.reason)
    && missing.result === 'UNKNOWN';
  report.evidence.D8 = { bogus, rangeAsVersion: missing };
  gate('D8_unknownOperatorFailsClosed', 'D8 Unknown operator and range-as-version fail closed', passed, [
    `unknown operator  : ${bogus.result} — ${bogus.reason}`,
    `range as version  : ${missing.result} — ${missing.reason}`
  ]);
}

// ---------------------------------------------------------------- D9
{
  const dir = fixture('deprecated', {
    deps: { expo: '54.0.35', 'react-native': '0.81.5', 'expo-random': '14.0.1', 'expo-crypto': '15.0.9' }
  });
  const res = run(dir);
  const f = find(res, 'deprecated-expo-random');
  const passed = !!f && f.status === 'VIOLATION';
  report.evidence.D9 = f;
  gate('D9_deprecatedPackageCaught', 'D9 Publisher-deprecated package is caught', passed, [
    `status : ${f && f.status}`,
    `detail : ${f && f.detail}`,
    `source : ${f && f.source.url}`
  ]);
}

// ------------------------------------------------------------------ done
report.finishedAt = new Date().toISOString();
const allPassed = failures === 0;
console.log('\n==================================================================');
console.log(`OVERALL: ${allPassed ? 'ALL STAGE 9 DRIFT GATES PASSED' : `${failures} GATE(S) FAILED`}`);
console.log('==================================================================');

const artifactsDir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(path.join(artifactsDir, 'stage9-drift-gate-report.json'), JSON.stringify(report, null, 2));
process.exit(allPassed ? 0 : 1);
