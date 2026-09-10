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

`opentelemetry-bootstrap` detects installed libraries and installs matching instrumentation.
Verified: on an environment with FastAPI and pymongo installed it selected
`opentelemetry-instrumentation-fastapi`, `-asgi`, `-sqlite3` and `-pymongo`.

### ⚠ Auto-instrumentation is not all-or-nothing — verify your DB hops

**Installing the instrumentation does not guarantee your database calls are traced.** This was
tested, and the result is not obvious:

| Application code | Result |
|---|---|
| `conn.execute("SELECT ...")` | **No span at all.** |
| `cur = conn.cursor()` then `cur.execute("SELECT ...")` | Span with `db.system` and `db.statement` |

DB-API instrumentation (sqlite3, psycopg2, mysql) wraps the **cursor**. The `Connection.execute`
convenience shortcut creates its own cursor internally and bypasses the wrapper entirely.

**The failure is silent.** You get a trace that looks complete — HTTP spans, correct duration,
green — with the database hop simply missing. Nothing errors. That is precisely the "renders green
while missing something" failure this project exists to prevent, arriving through the front door.

So after onboarding any service, **check that the hops you expect are actually there** before
trusting anything the request journey tells you. A request whose DB call is invisible is not a
healthy request; it is an unobserved one.

`db.statement` is captured with parameter placeholders (`SELECT balance FROM accounts WHERE id = ?`)
and not the bound values, so query parameters do not leak into telemetry.

**pymongo and motor are likely better off, but this is UNVERIFIED.** pymongo's instrumentation
hooks the driver's `CommandListener` at the wire-protocol level rather than wrapping a cursor, so
it should capture every command regardless of which API the application uses — and motor delegates
to pymongo. That reasoning was not testable here: MongoDB could not be installed in this
environment. **Treat Mongo hop coverage as unconfirmed until you have seen a Mongo hop on a real
trace.**

**This exact path was run end to end** against a real FastAPI app — twice. A plain HTTP handler
produced three spans per request; adding a database call through a cursor produced four, the extra
hop carrying `db.system=sqlite` and `db.statement`. Both runs: one assembled journey,
`service.version` and `deployment.environment` preserved into the hop, zero export errors, and no
application code involved. The captured bytes are committed as
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
| **HTTP hops appear but database hops do not** | Almost certainly the cursor issue in §3, not a VITALIS problem. Check whether the code calls `connection.execute` instead of `cursor.execute`. Nothing errors when this happens. |

---

## 7. Worked example: the FinLife stack

### The one-command path

`E:\VITALIS\onboard_finlife.sh` does everything in §2–§5 for this specific stack. Run it **in
WSL**, since that is where the backend virtualenv lives:

```bash
bash /mnt/e/VITALIS/onboard_finlife.sh
```

It checks prerequisites, starts VITALIS, installs the instrumentation, launches the backend under
it, sends traffic, and then reports what actually arrived — including whether a `db.system` hop
appeared, which is the open question in §3.

**It never writes to `E:\fintech-mobile`.** It does install OpenTelemetry packages into
`backend/venv` — an environment change, not a code change — and prints the one-line undo.

Start MongoDB first (the backend's `startup()` raises without it); the script refuses to touch
anything if `mongod` is not running.

Three things the script encodes that are easy to get wrong, two of them found by testing it:

- **`--reload` is off.** Uvicorn's reloader runs the app in a child process the agent does not
  wrap, so with `--reload` you get a running app and **no traces, and no error explaining why**.
- **The API key is verified, not assumed.** On a key mismatch the exporter gets HTTP 401, the
  message appears only in the *application's* log, and VITALIS sits there empty — indistinguishable
  from "instrumentation didn't work". The script fails loudly instead.
- **Database hops are detected by the `db.system` attribute, not by service name.** In a
  single-process app every span carries the same `service.name`, so looking for a service called
  "mongo" reports NO even when the hop is right there. That false negative was in the first version
  of the script and is exactly the failure this project exists to avoid.

### Doing it by hand



Commands only; **nothing in that repository is modified.**

The backend is FastAPI with MongoDB (`motor`/`pymongo`). `opentelemetry-bootstrap` selects
FastAPI **and** pymongo instrumentation — verified on an environment with those packages installed.
Whether the Mongo calls then appear as hops is **not verified** (MongoDB could not be installed
here); see the warning in §3 and check your first trace for a `db.system=mongodb` hop before
assuming the database leg is covered.

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
