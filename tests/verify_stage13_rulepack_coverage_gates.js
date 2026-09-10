/**
 * VITALIS STAGE 13 — Rule pack coverage: Python and Java
 *
 * Stage 11 made the drift engine technology-agnostic and proved a new rule pack
 * needs no code change. This stage exercises that claim for real: two packs for
 * ecosystems the engine was NOT built against, written entirely as data.
 *
 *   pip-core     — derived from PyPI `requires_dist`, the package's own
 *                  machine-readable declaration of what it needs
 *   spring-boot  — derived from the official Spring Boot system-requirements
 *                  pages; the case that matters for a Java middleware estate
 *
 * No engine file changed to add either. That is the property under test.
 *
 *  C1  A real Python incompatibility (motor 3.3 with pymongo 5.x) is caught.
 *  C2  A real, correct Python pairing is SATISFIED.
 *  C3  A real Java incompatibility (Spring Boot 3.4 with Spring Framework 6.1) is caught.
 *  C4  A correct Spring Boot pairing is SATISFIED.
 *  C5  A dependency that exists only transitively is UNKNOWN, never SATISFIED.
 *  C6  EVERY rule in EVERY shipped pack carries a resolvable source URL and date.
 *
 * Outputs: artifacts/stage13-rulepack-gate-report.json
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readRepo } = require('../engine/drift/manifest_reader');
const { checkDrift } = require('../engine/drift/drift_checker');
const { loadRulePacks } = require('../engine/drift/rulepack_loader');

const report = { suite: 'stage13-rulepacks', startedAt: new Date().toISOString(), gates: {}, evidence: {} };
let failures = 0;
function gate(key, label, passed, lines) {
  report.gates[key] = passed ? 'PASS' : 'FAIL';
  if (!passed) failures++;
  console.log(`\n--- ${label} ---`);
  for (const l of lines) console.log(`> ${l}`);
  console.log(`RESULT ${key}: [${report.gates[key]}]`);
}
function tmp(n) { return fs.mkdtempSync(path.join(os.tmpdir(), `vitalis-s13-${n}-`)); }
function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
const run = (dir) => { const r = readRepo(dir); return { reading: r, result: checkDrift(r) }; };
const find = (res, id) => res.findings.find(f => f.ruleId === id);

console.log('==================================================================');
console.log('VITALIS STAGE 13 — RULE PACK COVERAGE (Python, Java)');
console.log('==================================================================');

// ---------------------------------------------------------------- C1
{
  const dir = tmp('pybad');
  write(dir, 'requirements.txt', 'motor==3.3.2\npymongo==5.0.0\n');
  const { result } = run(dir);
  const f = find(result, 'motor-3.3-pymongo-max');
  const passed = !!f && f.status === 'VIOLATION' && f.provenance === 'OBSERVED';
  report.evidence.C1 = f;
  gate('C1_pythonIncompatibilityCaught', 'C1 motor 3.3 with pymongo 5.x', passed, [
    `status : ${f && f.status}`,
    `detail : ${f && f.detail}`,
    `source : ${f && f.source.url}`
  ]);
}

// ---------------------------------------------------------------- C2
{
  const dir = tmp('pygood');
  write(dir, 'requirements.txt', 'fastapi==0.104.1\nmotor==3.3.2\npymongo==4.6.1\npydantic==2.5.0\n');
  const { result } = run(dir);
  const min = find(result, 'motor-3.3-pymongo-min');
  const max = find(result, 'motor-3.3-pymongo-max');
  const pyd = find(result, 'fastapi-0.104-pydantic-min');
  const passed = min.status === 'SATISFIED' && max.status === 'SATISFIED' && pyd.status === 'SATISFIED'
    && result.coverage.violations === 0;
  report.evidence.C2 = { min, max, pyd, violations: result.coverage.violations };
  gate('C2_correctPythonPairingSatisfied', 'C2 A correct real-world Python pairing', passed, [
    `motor→pymongo >=4.5 : ${min.status}`,
    `motor→pymongo <5.0  : ${max.status}`,
    `fastapi→pydantic    : ${pyd.status}`,
    `violations          : ${result.coverage.violations}`
  ]);
}

// ---------------------------------------------------------------- C3
{
  const dir = tmp('javabad');
  write(dir, 'pom.xml', `<project><groupId>x</groupId><artifactId>y</artifactId><version>1.0.0</version>
   <dependencies>
     <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.4.2</version></dependency>
     <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>6.1.0</version></dependency>
   </dependencies></project>`);
  const { result } = run(dir);
  const f = find(result, 'springboot-3.4-spring-boot-starter-web-spring-core');
  const passed = !!f && f.status === 'VIOLATION';
  report.evidence.C3 = f;
  gate('C3_javaIncompatibilityCaught', 'C3 Spring Boot 3.4 pinned to Spring Framework 6.1', passed, [
    `status : ${f && f.status}`,
    `detail : ${f && f.detail}`,
    `source : ${f && f.source.url}`
  ]);
}

// ---------------------------------------------------------------- C4
{
  const dir = tmp('javagood');
  write(dir, 'pom.xml', `<project><groupId>x</groupId><artifactId>y</artifactId><version>1.0.0</version>
   <dependencies>
     <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>4.0.8</version></dependency>
     <dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId><version>7.0.9</version></dependency>
   </dependencies></project>`);
  const { result } = run(dir);
  const f = find(result, 'springboot-4.0-spring-boot-starter-web-spring-core');
  const passed = !!f && f.status === 'SATISFIED' && result.coverage.violations === 0;
  report.evidence.C4 = f;
  gate('C4_correctJavaPairingSatisfied', 'C4 Spring Boot 4.0 with Spring Framework 7.0.9', passed, [
    `status     : ${f && f.status}`,
    `detail     : ${f && f.detail}`,
    `violations : ${result.coverage.violations}`
  ]);
}

// ---------------------------------------------------------------- C5
{
  // starlette is a REAL requirement of fastapi, but arrives transitively — it is
  // not in requirements.txt. The rule must not quietly pass because it could not
  // find the package: "I could not check this" is not "this is fine".
  const dir = tmp('transitive');
  write(dir, 'requirements.txt', 'fastapi==0.104.1\n');
  const { result } = run(dir);
  const f = find(result, 'fastapi-0.104-starlette-min');
  const passed = !!f && f.status === 'UNKNOWN' && f.provenance === 'UNKNOWN'
    && /not present in the manifests/.test(f.detail);
  report.evidence.C5 = f;
  gate('C5_transitiveDependencyIsUnknown', 'C5 A transitive-only dependency is UNKNOWN, not SATISFIED', passed, [
    `status : ${f && f.status} (must be UNKNOWN — the reader does not resolve transitive trees)`,
    `detail : ${f && f.detail}`
  ]);
}

// ---------------------------------------------------------------- C6
{
  const { packs, rules } = loadRulePacks();
  const bad = rules.filter(r =>
    !r.source || typeof r.source.url !== 'string' || !/^https?:\/\//.test(r.source.url) || !r.source.recordedAt);
  const byPack = {};
  for (const r of rules) byPack[r.packId] = (byPack[r.packId] || 0) + 1;
  const passed = bad.length === 0 && packs.length >= 3 && rules.length >= 40;
  report.evidence.C6 = { packs: packs.map(p => ({ id: p.id, rules: p.rules.length, origin: p.origin })), unsourced: bad.length };
  gate('C6_everyShippedRuleIsSourced', 'C6 Every rule in every shipped pack is attributable', passed, [
    `packs installed : ${Object.entries(byPack).map(([k, v]) => `${k}(${v})`).join(', ')}`,
    `total rules     : ${rules.length}`,
    `unsourced rules : ${bad.length} (must be 0 — the loader refuses them, this audits what shipped)`
  ]);
}

report.finishedAt = new Date().toISOString();
const allPassed = failures === 0;
console.log('\n==================================================================');
console.log(`OVERALL: ${allPassed ? 'ALL STAGE 13 RULE PACK GATES PASSED' : `${failures} GATE(S) FAILED`}`);
console.log('==================================================================');
const dir = path.join(__dirname, '..', 'artifacts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'stage13-rulepack-gate-report.json'), JSON.stringify(report, null, 2));
process.exit(allPassed ? 0 : 1);
