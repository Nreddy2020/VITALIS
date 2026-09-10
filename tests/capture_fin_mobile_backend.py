"""Existing FIN backend + OTel, isolated loopback runtime for mobile reads only.
Arguments backend source directory, fresh output directory. Stop with control file.
"""
import sys
sys.dont_write_bytecode=True
import hashlib, importlib.metadata, json, os, threading, time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
backend, output=map(Path,sys.argv[1:3]);output.mkdir(parents=True,exist_ok=True)
from dotenv import load_dotenv
raw=(backend/'.env').read_bytes();load_dotenv(backend/'.env',encoding='utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
if urlparse(os.environ.get('MONGO_URL','')).hostname not in ('localhost','127.0.0.1','::1'):raise SystemExit('Local database required')
captures=[]
class Receiver(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        length=int(self.headers.get('content-length','0'))
        if length>2*1024*1024:self.send_error(413);return
        body=self.rfile.read(length);typ=self.headers.get('content-type','')
        name=f'capture-{len(captures):03d}.'+('json' if 'json' in typ else 'bin')
        (output/name).write_bytes(body);captures.append({'file':name,'contentType':typ,'sha256':hashlib.sha256(body).hexdigest(),'receivedAt':time.time()})
        self.send_response(200);self.send_header('Content-Type','application/x-protobuf');self.end_headers()
receiver=HTTPServer(('127.0.0.1',8370),Receiver);threading.Thread(target=receiver.serve_forever,daemon=True).start()
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
provider=TracerProvider(resource=Resource.create({'service.name':'fin-backend-isolated'}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint='http://127.0.0.1:8370/v1/traces'),schedule_delay_millis=500))
trace.set_tracer_provider(provider);PymongoInstrumentor().instrument()
sys.path.insert(0,str(backend))
from main import app
FastAPIInstrumentor.instrument_app(app)
# Enforce read-only pilot scope independently of frontend behavior.
@app.middleware('http')
async def read_only_scope(request,call_next):
    if request.method!='GET' or not (request.url.path.startswith('/api/inflation/') or request.url.path=='/health'):
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail':'Isolated pilot accepts inflation reads only'},status_code=403)
    return await call_next(request)
from pymongo import MongoClient
client=MongoClient(os.environ['MONGO_URL'],serverSelectionTimeoutMS=3000)
info=client.admin.command('buildInfo')
runtime={'recordedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'provenance':'OBSERVED runtime metadata; not artifact attestation',
 'backendSourceMainSha256':hashlib.sha256((backend/'main.py').read_bytes()).hexdigest(),
 'packages':{p:importlib.metadata.version(p) for p in ['fastapi','pymongo','motor','opentelemetry-sdk']},
 'databaseServer':{'version':info.get('version'),'gitVersion':info.get('gitVersion'),'provenance':'OBSERVED server buildInfo response on local endpoint; not request-linked server span'}}
(output/'runtime-evidence.json').write_text(json.dumps(runtime,indent=2));client.close()
import uvicorn
server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8362,log_level='error',access_log=False))
t=threading.Thread(target=server.run,daemon=True);t.start()
try:
    deadline=time.time()+900
    while t.is_alive() and time.time()<deadline and not (output/'stop').exists():
        provider.force_flush()
        (output/'capture-index.json').write_text(json.dumps(captures,indent=2))
        time.sleep(.5)
finally:
    server.should_exit=True;t.join(timeout=10);provider.shutdown();receiver.shutdown()
    (output/'capture-index.json').write_text(json.dumps(captures,indent=2))
print('Isolated backend stopped; capture batches:',len(captures))
