'use strict';
// Controlled evidence, not an actual deployed database or incident.
function fixture(stack = 'python') {
  const java = stack === 'java';
  const artifact = n => 'sha256:' + n.repeat(64);
  const from = java ? 'java-api' : 'python-api', to = java ? 'postgres-db' : 'mongo-db';
  const source = java ? 'maven:org.postgresql:postgresql' : 'pip:pymongo';
  const target = java ? 'server:postgresql' : 'server:mongodb';
  const hops = [
    { spanId: '1111111111111111', service: from, kind: 2, serviceVersion: '1.0.0', artifactDigest: artifact('a'), attributes: [] },
    { spanId: '2222222222222222', parentSpanId: '1111111111111111', service: from, kind: 3, serviceVersion: '1.0.0', artifactDigest: artifact('a'), attributes: java ? [{ key: 'vitalis.connection.sslNegotiation', value: { stringValue: 'direct' } }] : [] },
    { spanId: '3333333333333333', parentSpanId: '2222222222222222', service: to, kind: 2, serviceVersion: '1.0.0', artifactDigest: artifact('b'), attributes: [] }
  ];
  const inventories = [
    { service: from, artifactDigest: artifact('a'), declaredVersion: '1.0.0', declaredBy: 'pilot fixture generator', evidence: 'tests/fixtures/relationship_pilot.js', fixture: true,
      packages: [{ name: source, declared: java ? '42.7.7' : '4.11.0', resolved: java ? '42.7.7' : '4.11.0' }] },
    { service: to, artifactDigest: artifact('b'), declaredVersion: '1.0.0', declaredBy: 'pilot fixture generator', evidence: 'tests/fixtures/relationship_pilot.js', fixture: true,
      packages: [{ name: target, declared: java ? '16.4' : '3.6.23', resolved: java ? '16.4' : '3.6.23' }] }
  ];
  hops[1].attributes.push({ key: 'vitalis.client.package', value: { stringValue: source } });
  hops.forEach(h => { h.timingValid = true; });
  return { trace: { traceId: java ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', fixture: true, hops }, inventories };
}
function otlp(f) {
  return { resourceSpans: f.trace.hops.map(h => ({ resource: { attributes: [
    { key: 'service.name', value: { stringValue: h.service } },
    { key: 'service.version', value: { stringValue: h.serviceVersion } },
    ...(h.artifactDigest ? [{ key: 'vitalis.artifact.digest', value: { stringValue: h.artifactDigest } }] : [])
  ] }, scopeSpans: [{ spans: [{ traceId: f.trace.traceId, spanId: h.spanId, parentSpanId: h.parentSpanId, kind: h.kind,
    name: 'CONTROLLED FIXTURE', startTimeUnixNano: '1789000000000000000', endTimeUnixNano: '1789000000010000000', attributes: h.attributes }] }] })) };
}
module.exports = { fixture, otlp };
