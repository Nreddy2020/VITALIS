"""Local FIN proving harness. No application edits, no emulator access, health/ping only.
Run with FIN's existing venv; arguments: backend directory, artifact directory.
"""
import sys
sys.dont_write_bytecode = True
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
from urllib.request import urlopen

backend, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
from dotenv import load_dotenv
raw = (backend / '.env').read_bytes()
encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
load_dotenv(backend / '.env', encoding=encoding)
if urlparse(os.environ.get('MONGO_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Refusing non-local database for the local health pilot')

captures = []
class Receiver(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers['content-length']))
        filename = f'fin-health-otlp-{len(captures)}.bin'
        (output / filename).write_bytes(body)
        captures.append({'file': filename, 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)})
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-protobuf')
        self.end_headers()

collector = HTTPServer(('127.0.0.1', 0), Receiver)
threading.Thread(target=collector.serve_forever, daemon=True).start()
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

provider = TracerProvider(resource=Resource.create({'service.name': 'fin-health-pilot', 'deployment.environment': 'local-pilot'}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f'http://127.0.0.1:{collector.server_port}/v1/traces')))
trace.set_tracer_provider(provider)
PymongoInstrumentor().instrument()
sys.path.insert(0, str(backend))
from main import app
FastAPIInstrumentor.instrument_app(app)
import uvicorn
server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8361, log_level='error', access_log=False))
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
results = []
try:
    for _ in range(100):
        if server.started: break
        if not thread.is_alive(): raise RuntimeError('FIN isolated backend exited before ready')
        time.sleep(.1)
    if not server.started: raise RuntimeError('FIN isolated backend did not become ready')
    for _ in range(2):
        with urlopen('http://127.0.0.1:8361/health', timeout=10) as response:
            results.append({'httpStatus': response.status, 'body': json.loads(response.read())})
    provider.force_flush()
finally:
    server.should_exit = True
    thread.join(timeout=10)
    provider.shutdown()
    collector.shutdown()

metadata = {'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'application': str(backend), 'sourceMainSha256': hashlib.sha256((backend / 'main.py').read_bytes()).hexdigest(),
    'kind': 'REAL_FIN_HEALTH_CAPTURE', 'requests': results, 'captures': captures,
    'instrumentation': 'Explicit FastAPI and PyMongo instrumentation in isolated harness; no FIN source edits',
    'versions': {p: importlib.metadata.version(p) for p in ['fastapi', 'pymongo', 'motor', 'opentelemetry-sdk', 'opentelemetry-instrumentation-fastapi', 'opentelemetry-instrumentation-pymongo']},
    'unknowns': ['Mobile UI and network edge not captured', 'No deployed artifact digest or build attestation', 'No database SERVER span or immutable database build identity', 'Not a real incident or end-to-end mobile transaction']}
(output / 'fin-capture-metadata.json').write_text(json.dumps(metadata, indent=2))
print(json.dumps(metadata, indent=2))
