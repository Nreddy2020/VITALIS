'use strict';
// A second live runtime: two actual Node HTTP services, explicit OTel SDK spans.
// A test application, not a production incident or automatic-instrumentation claim.
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { NodeTracerProvider, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { trace, ROOT_CONTEXT, SpanKind, defaultTextMapGetter, defaultTextMapSetter } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close = server => new Promise(resolve=>server.close(resolve));
async function main() {
  process.env.VITALIS_API_KEY='local-node-pilot-test';
  process.env.VITALIS_DATA_DIR=fs.mkdtempSync(path.join(require('os').tmpdir(),'node-pilot-'));
  delete process.env.VITALIS_BUILD_INVENTORY;
  const {startServer,stopServer}=require('../server');
  await startServer(4356,'127.0.0.1');
  const providers=['node-http-api','node-http-catalog'].map(service=>new NodeTracerProvider({resource:resourceFromAttributes({'service.name':service}),
    spanProcessors:[new SimpleSpanProcessor(new OTLPTraceExporter({url:'http://127.0.0.1:4356/v1/traces',headers:{'x-vitalis-api-key':process.env.VITALIS_API_KEY}}))]}));
  const [apiTracer,catalogTracer]=providers.map(p=>p.getTracer('vitalis-local-test'));
  const propagator=new W3CTraceContextPropagator();
  const catalog=http.createServer((req,res)=>{
    const parent=propagator.extract(ROOT_CONTEXT,req.headers,defaultTextMapGetter);
    const span=catalogTracer.startSpan('GET /catalog',{kind:SpanKind.SERVER},parent);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({items:[]}));span.end();
  });
  let api, traceId;
  try {
    const catalogPort=await listen(catalog);
    api=http.createServer(async(req,res)=>{
      const root=apiTracer.startSpan('GET /browse',{kind:SpanKind.SERVER},ROOT_CONTEXT);traceId=root.spanContext().traceId;
      const call=apiTracer.startSpan('GET catalog',{kind:SpanKind.CLIENT},trace.setSpan(ROOT_CONTEXT,root));
      try {
        const headers={};propagator.inject(trace.setSpan(ROOT_CONTEXT,call),headers,defaultTextMapSetter);
        const response=await fetch('http://127.0.0.1:'+catalogPort+'/catalog',{headers});
        res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
      } catch(e) {res.writeHead(500);res.end();} finally {call.end();root.end();}
    });
    const apiPort=await listen(api);
    const response=await fetch('http://127.0.0.1:'+apiPort+'/browse');assert.equal(response.status,200);assert.deepEqual(await response.json(),{items:[]});
    await Promise.all(providers.map(p=>p.forceFlush()));
    const result=await (await fetch('http://127.0.0.1:4356/api/traces/'+traceId,{headers:{'x-vitalis-api-key':process.env.VITALIS_API_KEY}})).json();
    assert.equal(result.hops.length,3);assert.equal(result.compatibility.traceShape.state,'OBSERVED_TREE');
    assert.equal(result.compatibility.relationships.length,1);assert.equal(result.compatibility.status,'UNKNOWN');
    assert.equal(result.compatibility.relationships[0].from,'node-http-api');assert.equal(result.compatibility.relationships[0].to,'node-http-catalog');
    assert.ok(result.compatibility.deployments.every(d=>d.state==='UNKNOWN'));
    fs.writeFileSync(path.resolve('artifacts/pilot/node-live-capture-tests.json'),JSON.stringify({runAt:new Date().toISOString(),status:'PASS',nodeVersion:process.version,
      kind:'LIVE_TEST_APPLICATION',checks:['Real HTTP request crossed two Node HTTP services in one process','W3C parent context joined an actual CLIENT -> SERVER pair','Three actual SDK spans ingested','Missing inventory and rules remain UNKNOWN'],report:result.compatibility},null,2));
    console.log('PASS: Node SDK live HTTP boundary captured; unsupported compatibility UNKNOWN');
  } finally {if(api) await close(api);await close(catalog);await Promise.all(providers.map(p=>p.shutdown()));await stopServer();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
