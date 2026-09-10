'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyseRelationships, validateRules } = require('../engine/drift/relationships');
const rules = require('../engine/drift/relationship_rules.json');
const { fixture, otlp } = require('./fixtures/relationship_pilot');
const now = new Date('2026-09-10T12:00:00Z');
const report = { suite: 'relationship-pilot', runAt: new Date().toISOString(), gates: [] };
function run(name, fn) { fn(); report.gates.push({ name, status: 'PASS' }); console.log('PASS', name); }
const check = (f, r = rules, date = now, expected = []) => analyseRelationships(f.trace, f.inventories, r, date, expected);
const finding = r => r.relationships[0].findings[0];
async function main() {
  run('Python / MongoDB source-backed incompatibility, no causal claim', () => {
    const r = check(fixture()); assert.equal(r.status, 'VIOLATED'); assert.equal(finding(r).provenance, 'INFERRED');
    assert.match(r.relationships[0].causalClaim, /^NONE/); assert.equal(r.coverage.observedBoundaries, 1);
    report.python = r;
  });
  run('Java / PostgreSQL feature prerequisite without engine changes', () => {
    const r = check(fixture('java')); assert.equal(r.status, 'VIOLATED'); assert.match(finding(r).source.url, /postgresql/); report.java = r;
  });
  run('Satisfied minimum is not whole-request compatibility', () => {
    const f = fixture(); f.inventories[1].packages[0].resolved = '4.0.28';
    const r = check(f); assert.equal(finding(r).status, 'SATISFIED'); assert.equal(r.status, 'UNKNOWN');
  });
  for (const [name, mutate] of [
    ['missing artifact identity despite version equality', f => delete f.trace.hops[1].artifactDigest],
    ['wrong deployed artifact', f => f.trace.hops[1].artifactDigest = 'sha256:' + 'c'.repeat(64)],
    ['source versus deployment mismatch', f => f.inventories[0].declaredVersion = '2.0.0'],
    ['missing resolved package version', f => delete f.inventories[0].packages[0].resolved],
    ['range is not resolved evidence', f => f.inventories[0].packages[0].resolved = '^4.11.0'],
    ['prerelease fails closed', f => f.inventories[0].packages[0].resolved = '4.11.0-rc1'],
    ['ambiguous build inventory', f => f.inventories.push(structuredClone(f.inventories[0]))],
    ['unattributed inventory', f => delete f.inventories[0].declaredBy],
    ['duplicate package evidence', f => f.inventories[0].packages.push(structuredClone(f.inventories[0].packages[0]))],
    ['missing peer inventory', f => f.inventories.pop()],
    ['missing source inventory', f => f.inventories.shift()]
  ]) run(name, () => { const f = fixture(); mutate(f); assert.equal(check(f).relationships[0].status, 'UNKNOWN'); });
  run('Unrelated off-path incompatibilities do not contaminate verdict', () => {
    const f = fixture(); f.inventories[1].packages[0].resolved = '4.0'; const before = check(f);
    f.inventories.push(...fixture('java').inventories); assert.deepEqual(check(f).relationships, before.relationships);
  });
  run('Co-presence and internal parentage do not infer network edges', () => {
    const f = fixture(); f.trace.hops[1].kind = 1; const r = check(f);
    assert.equal(r.relationships.length, 0); assert.equal(r.unchecked.length, 1);
  });
  for (const [name, mutate] of [
    ['missing parent', f => f.trace.hops[0].parentSpanId = 'absent'],
    ['multiple roots', f => f.trace.hops.push({spanId:'four',service:'other',kind:2})],
    ['duplicate span', f => f.trace.hops.push(structuredClone(f.trace.hops[0]))],
    ['cycle', f => f.trace.hops[0].parentSpanId = f.trace.hops[2].spanId]
  ]) run(name + ' cannot establish request truth', () => { const f=fixture(); mutate(f); const r=check(f); assert.equal(r.status,'UNKNOWN'); assert.equal(r.traceShape.state,'UNKNOWN'); assert.ok(r.relationships.every(e=>e.status==='UNKNOWN')); });
  run('Invalid timestamps cannot establish request truth', () => {const f=fixture();delete f.trace.hops[0].timingValid;assert.equal(check(f).status,'UNKNOWN');});
  run('Invalid trace ID cannot establish request truth', () => {const f=fixture();f.trace.traceId='bad';assert.equal(check(f).status,'UNKNOWN');});
  run('Unobserved peer is unchecked', () => {const f=fixture();f.trace.hops.pop();assert.equal(check(f).coverage.uncheckedInteractions,1);});
  run('Empty or absent trace is unknown', () => {assert.equal(analyseRelationships(null).status,'UNKNOWN');assert.equal(analyseRelationships({hops:[]}).traceShape.state,'UNKNOWN');});
  run('Missing connection setting cannot assert feature incompatibility', () => {const f=fixture('java');f.trace.hops[1].attributes=[];assert.equal(finding(check(f)).status,'UNKNOWN');});
  run('Installed driver is not proof it made this call', () => { const f=fixture(); f.trace.hops[1].attributes=[]; assert.equal(finding(check(f)).status,'UNKNOWN'); });
  run('Different connection setting is outside rule scope', () => {const f=fixture('java');f.trace.hops[1].attributes[0].value.stringValue='postgres';assert.equal(check(f).relationships[0].status,'UNKNOWN');});
  run('Future and stale rules cannot pass or violate', () => {
    assert.equal(finding(check(fixture(),rules,new Date('2027-01-01'))).status,'UNKNOWN');
    assert.equal(finding(check(fixture(),rules,new Date('2026-01-01'))).status,'UNKNOWN');
  });
  run('Uncovered source versions do not inherit rules', () => {const f=fixture();f.inventories[0].packages[0].resolved='4.14';assert.equal(check(f).relationships[0].findings.length,0);});
  run('Unsourced or unsupported rules rejected', () => {
    const r=structuredClone(rules);delete r[0].source;assert.throws(()=>validateRules(r));
    const s=structuredClone(rules);s[0].constraint.op='guess';assert.throws(()=>validateRules(s));
  });
  run('Expected but unobserved boundary is explicit UNKNOWN, never creates edge', () => {
    const r=check(fixture(),rules,now,[{from:'mobile',to:'api',declaredBy:'tester',evidence:'expected path inventory'}]);
    assert.equal(r.expectedCoverage[0].state,'UNKNOWN');assert.equal(r.relationships.length,1);
  });
  run('Reproducible hashes and findings',()=>{assert.deepEqual(check(fixture()),check(fixture()));});
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vitalis-relationships-'));
  process.env.VITALIS_API_KEY='local-pilot-test'; process.env.VITALIS_DATA_DIR=temp;
  const f=fixture(); const config=path.join(temp,'inventory.json'); fs.writeFileSync(config,JSON.stringify(f.inventories)); process.env.VITALIS_BUILD_INVENTORY=config;
  const {startServer,stopServer}=require('../server'); const server = await startServer(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const headers={'x-vitalis-api-key':process.env.VITALIS_API_KEY,'content-type':'application/json'};
    const sent=await fetch(base+'/v1/traces',{method:'POST',headers,body:JSON.stringify(otlp(f))}); assert.equal(sent.status,200);
    const got=await fetch(base+'/api/traces/'+f.trace.traceId,{headers}); const d=await got.json();
    run('Live HTTP OTLP ingestion retains kinds/digests and API boundary evidence',()=>{assert.equal(d.hops[1].kind,3);assert.equal(d.hops[1].artifactDigest,f.trace.hops[1].artifactDigest);assert.equal(d.compatibility.status,'VIOLATED');assert.equal(d.compatibility.fixture,true);});
    report.http=d.compatibility;
    fs.writeFileSync(config,'invalid json'); const bad=await (await fetch(base+'/api/traces/'+f.trace.traceId,{headers})).json();
    run('Malformed inventory fails closed in API',()=>assert.equal(bad.compatibility.status,'UNKNOWN'));
  } finally { await stopServer(); }
  fs.mkdirSync(path.join(__dirname,'../artifacts/pilot'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../artifacts/pilot/relationship-tests.json'),JSON.stringify(report,null,2));
  console.log(report.gates.length+' gates passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
