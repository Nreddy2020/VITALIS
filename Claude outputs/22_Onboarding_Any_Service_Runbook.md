# 22 — Onboarding Any Service to VITALIS (Tier A, zero code changes)

**Date:** 2026-09-09
**Verified:** the Python path below was executed end to end against a real FastAPI application.
**Applies to:** any service whose language has an OpenTelemetry SDK.

The whole point of Tier A is that **you do not modify the application.** No VITALIS import, no
VITALIS SDK, no vendor agent. Instrumentation is applied at launch, and if VITALIS disappears the
application is unaffected — which is the architectural invariant this project will not break:
*VITALIS observes production; production never depends on VITALIS.*

If onboarding a service requires editing its source, something has gone wrong. Come back here.

---

## 1. What VITALIS needs

Exactly one thing: **OTLP spans over HTTP**, at `/v1/traces`.

| | Supported |
|---|---|
| Encoding | `application/x-protobuf` **and** `application/json` (`21`) |
| Signals | Traces. Metrics and logs accept JSON only; protobuf on those returns 415, explicitly. |
| Auth | `x-vitalis-api-key` header, required |

Protobuf is the default for the Python, Java, Go and .NET SDKs and for the OpenTelemetry Collector,
so most services need no special configuration. **Until Stage 12 only JSON worked** and every one
of those senders was silently rejected — if you are reading an older note that says JSON-only, it
is out of date.

---

## 2. The five environment variables

This is the entire integration for most services.

```bash
OTEL_SERVICE_NAME=<the name you want on screen>
OTEL_RESOURCE_ATTRIBUTES="service.version=<version>,deployment.environment=<env>"
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://<vitalis-host>:4318/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-vitalis-api-key=<your key>"
OTEL_TRACES_EXPORTER=otlp
```

**`service.version` is worth setting properly.** It is what lets VITALIS tell you that the build
serving a request is not the build in source control (`18` §1). Without it, every compatibility
finding carries an unstated assumption about which build it describes.

**`OTEL_SERVICE_NAME` must match the `service` field in your drift bindings** (`19`,
`engine/drift/bindings.example.json`) or the component reports UNKNOWN on every request.

Set `OTEL_METRICS_EXPORTER=none` and `OTEL_LOGS_EXPORTER=none` unless you want those signals; they
are not the point of VITALIS and add noise.

---

## 3. Python — verified working

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http
opentelemetry-bootstrap -a install     # pulls instrumentation for your installed libraries
```

Then launch through the agent instead of directly:

```bash
opentelemetry-instrument uvicorn main:app --port 8000
```

That is the change: `uvicorn ...` becomes `opentelemetry-instrument uvicorn ...`. **No source file
is touched.**

`opentelemetry-bootstrap` detects installed libraries and installs matching instrumentation —
FastAPI, requests, pymongo, psycopg2 and others — so database and outbound HTTP calls become hops
automatically.

**This exact path was run end to end** against a real FastAPI app: three spans per request
assembled into one journey, `service.version` and `deployment.environment` preserved into the hop,
zero export errors, and no application code involved. The captured bytes are committed as
`tests/fixtures/otlp_python_real.bin` and are what Stage 12's gates run against.

---

## 4. Other languages

| Language | Zero-code approach |
|---|---|
| **Java** | `java -javaagent:opentelemetry-javaagent.jar -jar app.jar` — the agent instruments servlets, JDBC, JMS and more. Most relevant for a WebSphere/JBoss estate. |
| **Node.js** | `node --require @opentelemetry/auto-instrumentations-node/register app.js` |
| **.NET** | The OpenTelemetry .NET automatic instrumentation package |
| **Go** | No true zero-code option — Go needs source changes, so it is Tier B in this project's model (`02`) |

All use the same five variables from §2.

**Via an OpenTelemetry Collector** (recommended once more than a couple of services are sending):
point services at the Collector as normal and add a VITALIS exporter:

```yaml
exporters:
  otlphttp/vitalis:
    endpoint: http://<vitalis-host>:4318
    headers:
      x-vitalis-api-key: <your key>
```

This is the shape that matters for adoption in an organisation that already has an observability
stack (`09` §3.3): VITALIS becomes an **additional exporter** on a pipeline that already exists.
Nothing is displaced, no second agent is deployed, and no existing tool loses data.

---

## 5. Verify it worked

```bash
# 1. Is VITALIS up?
curl http://<vitalis-host>:4318/health

# 2. Exercise your application, then list what arrived
curl -H "x-vitalis-api-key: <key>" http://<vitalis-host>:4318/api/traces

# 3. Inspect one request
curl -H "x-vitalis-api-key: <key>" http://<vitalis-host>:4318/api/traces/<traceId>
```

Then join it to compatibility drift (`18`):

```bash
npm run drift:request -- --trace <saved-trace.json> --bindings bindings.json
```

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| `Failed to export span batch code: 400` | The response body now names the encoding, the Content-Type received and the byte count. Read it — it says which decoder failed and why. |
| `401 UNAUTHORIZED` | `x-vitalis-api-key` missing or wrong. Check the header syntax in `OTEL_EXPORTER_OTLP_TRACES_HEADERS`. |
| `415 UNSUPPORTED_ENCODING` | Protobuf sent to `/v1/metrics` or `/v1/logs`. Only traces have a protobuf decoder. |
| Nothing arrives, no errors | The exporter is batching. Set `OTEL_BSP_SCHEDULE_DELAY=500` while testing. |
| Service shows as `UnknownService` | `OTEL_SERVICE_NAME` is not set. |
| Component is UNKNOWN in drift reports | No binding declares it. That is deliberate (`18` §3) — add it to `bindings.json`. |

---

## 7. Worked example: the FinLife stack

Commands only; **nothing in that repository is modified.**

The backend is FastAPI with MongoDB (`motor`/`pymongo`), so `opentelemetry-bootstrap` will pick up
FastAPI *and* pymongo instrumentation, making the database calls hops in their own right.

```bash
# once, in the backend's virtualenv
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http
opentelemetry-bootstrap -a install

# every launch
export OTEL_SERVICE_NAME=finlife-api
export OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.1,deployment.environment=dev"
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-vitalis-api-key=$VITALIS_API_KEY"
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=none
export OTEL_LOGS_EXPORTER=none

opentelemetry-instrument uvicorn main:app --port 8000
```

Matching binding, so drift findings attach to the right component:

```json
{ "bindings": [
  { "service": "finlife-api", "manifestPath": "E:\\fintech-mobile\\backend",
    "declaredBy": "nagarjuna", "note": "FastAPI + MongoDB" }
]}
```

**Not verified, and you should expect friction:**

- These commands were **not run against that application** — it needs MongoDB and configuration
  that were not available here. The *mechanism* is verified against an equivalent FastAPI app; this
  particular deployment is not.
- The mobile client is a separate problem. React Native OpenTelemetry support is immature, and a
  phone adds offline buffering, backgrounding and clock skew. Expect the client leg to be UNKNOWN
  for a while — which VITALIS will say plainly rather than render green.
- `service.version=1.0.1` is copied from that repository's `package.json`. If the backend versions
  independently, use its real version or the deployed-vs-source check (`18` §1) will report a
  mismatch that is an artefact of this runbook rather than a real one.

---

## 8. When you have this running

You will have crossed the line the project has not crossed yet: **a real application feeding
VITALIS continuously**, rather than a test harness. That unlocks the question everything else rests
on, and which no amount of further building can answer —

> Does an operator under real pressure find `UNKNOWN` **trustworthy**, or **annoying**?

`09` §9 records that as the falsification condition for the whole product thesis. Answer it early.
