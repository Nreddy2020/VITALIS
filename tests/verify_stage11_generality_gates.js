/**
 * VITALIS STAGE 11 — Technology generality of the drift engine
 *
 * These gates exist because the owner caught a real drift, for the second time
 * in this project's history.
 *
 * The first drift was DB2/MQ: the engine narrowed toward IBM middleware because
 * that was the example in front of it (`docs/01` §9). The second was this one —
 * the drift checker was built while looking at one Expo/React Native + Python
 * application, and it absorbed that application's shape: `manifest_reader.js`
 * hardcoded `package.json`, `app.json`, `eas.json` and, most damningly,
 * `backend/requirements.txt` — one specific repository's folder layout, written
 * into the engine. It analysed that application perfectly and would have found
 * nothing anywhere else.
 *
 * A charter is not what prevents this. Executable gates are. Each one below
 * fails if the engine ever learns what kind of application it is looking at.
 *
 *  G1  A Java/Maven repository with ZERO JavaScript is read correctly.
 *  G2  A Python service at an ARBITRARY path is found — no assumed layout.
 *  G3  A brand-new rule pack for an unrelated technology works with NO code
 *      change, and catches a real violation.
 *  G4  Expo is just one pack: with the rule packs removed, the engine still
 *      reads every ecosystem and reports honest UNKNOWN coverage.
 *  G5  No application-, framework- or folder-specific string is hardcoded in
 *      the engine core. Enforced by reading the source.
 *  G6  Maven fails CLOSED on ${property} versions rather than guessing.
 *  G7  A polyglot repository is read as one component across all ecosystems.
 *
 * Outputs: artifacts/stage11-generality-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readRepo } = require('../engine/drift/manifest_reader');
const { checkDrift } = require('../engine/drift/drift_checker');
const { loadRulePacks } = require('../engine/drift/rulepack_loader');
const { loadedPacks } = require('../engine/drift/compatibility_rules');
const { ECOSYSTEMS, discover } = require('../engine/drift/ecosystems');
const maven = require('../engine/drift/ecosystems/maven');

const report = { suite: 'stage11-generality', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}
function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `vitalis-s11-${name}-`)); }
function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

console.log('==================================================================');
console.log('VITALIS STAGE 11 — TECHNOLOGY GENERALITY GATES');
console.log('==================================================================');

// ---------------------------------------------------------------- G1
{
  const dir = tmp('java');
  write(dir, 'pom.xml', `<?xml version="1.0"?>
<project>
  <groupId>com.example</groupId><artifactId>ledger</artifactId><version>2.4.1</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.2.0</version></dependency>
    <dependency><groupId>com.ibm.db2</groupId><artifactId>jcc</artifactId><version>11.5.9.0</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.1</version><scope>test</scope></dependency>
  </dependencies>
</project>`);
  const r = readRepo(dir);
  const names = r.packages.map(p => p.name);
  const spring = r.packages.find(p => p.name === 'org.springframework.boot:spring-boot-starter-web');
  const passed = r.ecosystemsFound.includes('maven')
    && !r.ecosystemsFound.includes('npm')
    && r.packages.length === 3
    && spring.version === '3.2.0' && spring.provenance === 'OBSERVED'
    && r.selfVersion.value === '2.4.1';
  report.evidence.G1 = { ecosystemsFound: r.ecosystemsFound, packages: r.packages, selfVersion: r.selfVersion };
  gate('G1_javaRepoReadWithNoJavaScript', 'G1 A Java/Maven repo with zero JavaScript', passed, [
    `ecosystems found : ${r.ecosystemsFound.join(', ')}`,
    `dependencies     : ${names.join(', ')}`,
    `spring-boot      : ${spring.version} (${spring.provenance})`,
    `component version: ${r.selfVersion.value} from ${r.selfVersion.source}`
  ]);
}

// ---------------------------------------------------------------- G2
{
  // Deliberately NOT 'backend/' — the path the engine used to assume.
  const dir = tmp('pypath');
  write(dir, 'services/ledger/api/requirements.txt', 'fastapi==0.104.1\nmotor==3.3.2\npymongo>=4.6\n');
  const r = readRepo(dir);
  const fastapi = r.packages.find(p => p.name === 'fastapi');
  const pymongo = r.packages.find(p => p.name === 'pymongo');
  const passed = r.ecosystemsFound.includes('pip')
    && r.packages.length === 3
    && fastapi.provenance === 'OBSERVED'
    && pymongo.provenance === 'INFERRED';   // '>=' is a bound, not an installed version
  report.evidence.G2 = { ecosystemsFound: r.ecosystemsFound, packages: r.packages };
  gate('G2_pythonFoundAtArbitraryPath', 'G2 Python found at services/ledger/api/, not an assumed layout', passed, [
    `discovered at : services/ledger/api/requirements.txt`,
    `fastapi==     : ${fastapi.version} (${fastapi.provenance})`,
    `pymongo>=     : ${pymongo.version} (${pymongo.provenance} — a bound is not an installed version)`
  ]);
}

// ---------------------------------------------------------------- G3
{
  // A rule pack for a technology the engine has never heard of, added as DATA.
  const packDir = tmp('pack');
  fs.writeFileSync(path.join(packDir, 'springboot.json'), JSON.stringify({
    id: 'springboot',
    displayName: 'Spring Boot (test pack)',
    sources: {
      springDocs: { url: 'https://example.org/spring-compatibility', title: 'Test source', recordedAt: '2026-09-09' }
    },
    rules: [{
      id: 'springboot-3-requires-jakarta-db2-driver',
      description: 'Spring Boot 3.x requires the DB2 JCC driver 11.5.8 or later',
      when: { package: 'org.springframework.boot:spring-boot-starter-web', constraint: { op: 'majorEquals', value: 3 } },
      require: { package: 'com.ibm.db2:jcc', constraint: { op: 'gte', value: '11.5.8.0' } },
      severity: 'HIGH',
      source: 'springDocs'
    }]
  }, null, 2));

  const dir = tmp('javabad');
  write(dir, 'pom.xml', `<project><groupId>com.example</groupId><artifactId>x</artifactId><version>1.0.0</version>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.2.0</version></dependency>
    <dependency><groupId>com.ibm.db2</groupId><artifactId>jcc</artifactId><version>11.5.4.0</version></dependency>
  </dependencies></project>`);

  const opts = { dir: packDir };
  const reading = readRepo(dir, { rulePackOptions: opts });
  const res = checkDrift(reading, loadRulePacks(opts).rules);
  const f = res.findings.find(x => x.ruleId === 'springboot-3-requires-jakarta-db2-driver');
  const passed = !!f && f.status === 'VIOLATION' && f.provenance === 'OBSERVED';
  report.evidence.G3 = { finding: f };
  gate('G3_newRulePackNoCodeChange', 'G3 A new rule pack for an unrelated stack — no code change', passed, [
    `pack added as   : ${path.join(packDir, 'springboot.json')} (JSON only)`,
    `finding         : ${f && f.status} — ${f && f.detail}`,
    `engine changes  : none`
  ]);
}

// ---------------------------------------------------------------- G4
{
  const dir = tmp('nopacks');
  write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { expo: '54.0.35', 'react-native': '0.81.5' } }));
  write(dir, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'x' }, 'node_modules/expo': { version: '54.0.35' }, 'node_modules/react-native': { version: '0.81.5' } } }));
  const opts = { dir: null };  // no packs at all
  const reading = readRepo(dir, { rulePackOptions: opts });
  const res = checkDrift(reading, loadRulePacks(opts).rules);
  const passed = reading.packages.length === 2
    && res.coverage.rulesLoaded === 0
    && res.coverage.violations === 0
    && res.coverage.packagesUncovered === 2;
  report.evidence.G4 = { coverage: res.coverage, packsInstalled: loadedPacks() };
  gate('G4_expoIsJustOnePack', 'G4 With no rule packs, the engine still reads everything', passed, [
    `packages read    : ${reading.packages.length}`,
    `rules loaded     : ${res.coverage.rulesLoaded} (packs removed)`,
    `uncovered        : ${res.coverage.packagesUncovered} → honest UNKNOWN, not a pass`,
    `packs normally installed: ${loadedPacks().map(p => `${p.id}(${p.ruleCount})`).join(', ')}`
  ]);
}

// ---------------------------------------------------------------- G5
{
  // The engine core must contain no application-, framework- or layout-specific
  // strings. Ecosystems may name their own manifest files; rule packs are data.
  const core = ['manifest_reader.js', 'drift_checker.js', 'version_ops.js', 'request_drift.js', 'component_bindings.js', 'rulepack_loader.js'];
  const banned = [/backend\//, /\beas\.json\b/, /['"]app\.json['"]/, /\bexpo-random\b/, /\bnewArchEnabled\b/, /['"]react-native['"]/];
  const offences = [];
  for (const file of core) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'drift', file), 'utf8');
    // Strip block comments: the prohibition is on behaviour, and the comments
    // deliberately cite the old hardcoded names as the cautionary example.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const re of banned) if (re.test(code)) offences.push(`${file} contains ${re}`);
  }
  const passed = offences.length === 0;
  report.evidence.G5 = { filesChecked: core, offences };
  gate('G5_noApplicationSpecificStringsInCore', 'G5 Engine core carries no application-specific strings', passed, [
    `files checked : ${core.join(', ')}`,
    `patterns      : backend/, eas.json, app.json, expo-random, newArchEnabled, react-native`,
    `offences      : ${offences.length === 0 ? 'none' : offences.join(' | ')}`
  ]);
}

// ---------------------------------------------------------------- G6
{
  const { packages } = maven.parsePom(`<project><version>1.0.0</version><dependencies>
    <dependency><groupId>a</groupId><artifactId>b</artifactId><version>\${spring.version}</version></dependency>
    <dependency><groupId>c</groupId><artifactId>d</artifactId><version>[1.0,2.0)</version></dependency>
    <dependency><groupId>e</groupId><artifactId>f</artifactId></dependency>
    <dependency><groupId>g</groupId><artifactId>h</artifactId><version>9.9.9</version></dependency>
  </dependencies></project>`, 'pom.xml');
  const prop = packages.find(p => p.name === 'a:b');
  const range = packages.find(p => p.name === 'c:d');
  const managed = packages.find(p => p.name === 'e:f');
  const literal = packages.find(p => p.name === 'g:h');
  const passed = prop.provenance === 'UNKNOWN' && prop.version === null
    && range.provenance === 'UNKNOWN'
    && managed.provenance === 'UNKNOWN'
    && literal.provenance === 'OBSERVED' && literal.version === '9.9.9';
  report.evidence.G6 = { prop, range, managed, literal };
  gate('G6_mavenFailsClosed', 'G6 Maven fails closed on properties, ranges and managed versions', passed, [
    `\${property}          : ${prop.provenance} (version ${prop.version}) — not guessed`,
    `range [1.0,2.0)      : ${range.provenance}`,
    `no <version>         : ${managed.provenance}`,
    `literal 9.9.9        : ${literal.provenance}`
  ]);
}

// ---------------------------------------------------------------- G7
{
  const dir = tmp('polyglot');
  write(dir, 'package.json', JSON.stringify({ name: 'web', version: '1.0.0', dependencies: { expo: '54.0.35' } }));
  write(dir, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/expo': { version: '54.0.35' } } }));
  write(dir, 'api/requirements.txt', 'fastapi==0.104.1\n');
  write(dir, 'batch/pom.xml', '<project><version>1.0.0</version><dependencies><dependency><groupId>com.ibm.mq</groupId><artifactId>com.ibm.mq.allclient</artifactId><version>9.3.4.0</version></dependency></dependencies></project>');
  // Must be ignored entirely:
  write(dir, 'node_modules/left-pad/package.json', JSON.stringify({ name: 'left-pad', version: '1.3.0', dependencies: { evil: '1.0.0' } }));
  write(dir, '.venv/lib/requirements.txt', 'should-not-appear==1.0.0\n');

  const r = readRepo(dir);
  const names = r.packages.map(p => p.name);
  const passed = r.ecosystemsFound.length === 3
    && names.includes('expo') && names.includes('fastapi') && names.includes('com.ibm.mq:com.ibm.mq.allclient')
    && !names.includes('evil') && !names.includes('should-not-appear');
  report.evidence.G7 = { ecosystemsFound: r.ecosystemsFound, names };
  gate('G7_polyglotRepoReadAsOne', 'G7 A polyglot repo is read across all ecosystems', passed, [
    `ecosystems : ${r.ecosystemsFound.join(', ')}`,
    `packages   : ${names.join(', ')}`,
    `node_modules / .venv excluded: ${!names.includes('evil') && !names.includes('should-not-appear')}`
  ]);
}

// ------------------------------------------------------------------ done
report.finishedAt = new Date().toISOString();
report.registeredEcosystems = ECOSYSTEMS.map(e => ({ id: e.id, displayName: e.displayName, manifestFiles: e.manifestFiles }));
report.installedRulePacks = loadedPacks();
const allPassed = failures === 0;
console.log('\n==================================================================');
console.log(`OVERALL: ${allPassed ? 'ALL STAGE 11 GENERALITY GATES PASSED' : `${failures} GATE(S) FAILED`}`);
console.log('==================================================================');
const dir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'stage11-generality-gate-report.json'), JSON.stringify(report, null, 2));
process.exit(allPassed ? 0 : 1);
