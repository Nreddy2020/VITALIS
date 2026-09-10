'use strict';
const assert=require('node:assert/strict');
const crypto=require('crypto');
const fs=require('fs');
const http=require('http');
const {createFetchObserver}=require('../engine/ingestion/fetch_observer');
async function main(){
  const results=[]; const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name);};
  let sent=[], calls=[];
  const response={status:200};
  const setup=(extra={})=>createFetchObserver({fetch:async(...args)=>{calls.push(args);return response;},randomBytes:crypto.randomBytes,select:()=>({spanName:'GET /items/{id}'}),emit:p=>sent.push(p),serviceName:'test-client',...extra});
  await test('Injects valid W3C identity and exports only configured route and observed status',async()=>{
    const f=setup();const r=await f('https://example.invalid/items/private?token=secret',{headers:{Authorization:'Bearer secret'},body:'private body'});
    assert.equal(r,response);assert.match(calls[0][1].headers.get('traceparent'),/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    assert.equal(calls[0][1].headers.get('Authorization'),'Bearer secret');assert.ok(!JSON.stringify(sent).includes('secret'));assert.ok(!JSON.stringify(sent).includes('private'));
  });
  await test('Existing trace context remains untouched, no fabricated span',async()=>{sent=[];const opts={headers:{traceparent:'00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'}};await setup()('https://example.invalid',opts);assert.equal(sent.length,0);assert.equal(calls.at(-1)[1],opts);});
  await test('Non-allowlisted requests and exporter recursion are not traced',async()=>{sent=[];await setup({select:()=>null})('https://telemetry.invalid');assert.equal(sent.length,0);});
  await test('Exporter failure never fails the app request and reports a gap',async()=>{const gaps=[];const r=await setup({emit:()=>{throw Error('offline');},onGap:g=>gaps.push(g)})('https://example.invalid');assert.equal(r,response);assert.deepEqual(gaps,['EXPORT_FAILED']);});
  await test('Original network error preserved and reported without sensitive error text',async()=>{sent=[];const err=Error('secret');await assert.rejects(setup({fetch:async()=>{throw err;}})('https://example.invalid'),e=>e===err);assert.equal(sent[0].resourceSpans[0].scopeSpans[0].spans[0].status.code,2);assert.ok(!JSON.stringify(sent).includes('secret'));});
  await test('Invalid RNG fails open for app, closed for invented trace evidence',async()=>{sent=[];await setup({randomBytes:n=>new Uint8Array(n)})('https://example.invalid');assert.equal(sent.length,0);});
  await test('Request objects are not consumed or rewritten',async()=>{sent=[];const req={};await setup()(req);assert.equal(calls.at(-1)[0],req);assert.equal(sent.length,0);});
  await test('Real Node HTTP request carries the same identity exported by the mobile-capable observer',async()=>{
    let observed;const server=http.createServer((req,res)=>{observed=req.headers.traceparent;res.writeHead(204);res.end();});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));sent=[];
    try {const r=await setup({fetch:global.fetch})('http://127.0.0.1:'+server.address().port+'/items/1');assert.equal(r.status,204);const s=sent[0].resourceSpans[0].scopeSpans[0].spans[0];assert.equal(observed,`00-${s.traceId}-${s.spanId}-01`);}finally{await new Promise(r=>server.close(r));}
  });
  fs.mkdirSync('artifacts/mobile-pilot',{recursive:true});fs.writeFileSync('artifacts/mobile-pilot/fetch-observer-tests.json',JSON.stringify({runAt:new Date().toISOString(),status:'PASS',checks:results},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
