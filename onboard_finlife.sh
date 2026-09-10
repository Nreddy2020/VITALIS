#!/bin/bash
# =============================================================================
# VITALIS — one-command onboarding for the FinLife backend
#
# Run this in WSL:      bash /mnt/e/VITALIS/onboard_finlife.sh
#
# WHAT IT DOES NOT DO:
#   - It does NOT modify any file in E:\fintech-mobile. Not one line.
#   - It does NOT start MongoDB or your frontend. Use your own
#     scripts/start_all.sh for those, or start mongod yourself.
#
# WHAT IT DOES CHANGE:
#   - It installs OpenTelemetry packages INTO your backend virtualenv
#     (backend/venv). That is an environment change, not a code change, and it
#     is the only way auto-instrumentation can see your app's libraries.
#     To undo:  source backend/venv/bin/activate && pip uninstall -y \
#                 opentelemetry-distro opentelemetry-exporter-otlp-proto-http
#
# Stop everything afterwards with:
#   pkill -f 'opentelemetry-instrument' ; pkill -f 'node server.js'
# =============================================================================
set -u

VITALIS_DIR="${VITALIS_DIR:-/mnt/e/VITALIS}"
APP_DIR="${APP_DIR:-/mnt/e/fintech-mobile}"
BACKEND_DIR="$APP_DIR/backend"
VITALIS_PORT=4318
BACKEND_PORT=8000
export VITALIS_API_KEY="${VITALIS_API_KEY:-finlife-onboarding-key}"

say()  { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "  \033[0;32m✔\033[0m $*"; }
warn() { echo -e "  \033[0;33m!\033[0m $*"; }
die()  { echo -e "  \033[0;31m✘ $*\033[0m"; exit 1; }

# ----------------------------------------------------------------- 0. checks
say "Checking prerequisites"

[ -d "$VITALIS_DIR" ] || die "VITALIS not found at $VITALIS_DIR (set VITALIS_DIR=... to override)"
[ -d "$BACKEND_DIR" ] || die "backend not found at $BACKEND_DIR (set APP_DIR=... to override)"
ok "found VITALIS at $VITALIS_DIR"
ok "found backend at $BACKEND_DIR"

command -v node >/dev/null || die "node is not installed IN WSL.
     VITALIS must run in the same place as this script so they share localhost.
     Install Node inside WSL, or run VITALIS on Windows and set
     OTEL_EXPORTER_OTLP_TRACES_ENDPOINT to the Windows host IP instead."
ok "node $(node -v)"

[ -f "$BACKEND_DIR/venv/bin/activate" ] || die "no virtualenv at $BACKEND_DIR/venv"
ok "backend virtualenv present"

if pgrep -x mongod >/dev/null; then
  ok "MongoDB is running"
else
  warn "mongod is NOT running. The backend's startup() calls MongoDB.connect() and"
  warn "raises if it fails, so it will not start. Start Mongo first, e.g.:"
  warn "   mkdir -p \$HOME/data/db && nohup mongod --dbpath \$HOME/data/db --bind_ip 127.0.0.1 &"
  die  "aborting before changing anything"
fi

if ss -ltn 2>/dev/null | grep -q ":$BACKEND_PORT "; then
  die "port $BACKEND_PORT is already in use — stop your running backend first (pkill -f uvicorn)"
fi
ok "port $BACKEND_PORT is free"

# Truncate stale logs. A previous run's failure sitting in finlife-backend.log
# was mistaken for the current run's — old evidence read as current evidence,
# which is the same class of mistake this whole project is about.
: > "$VITALIS_DIR/finlife-backend.log" 2>/dev/null || true

# ----------------------------------------------------------- 1. start VITALIS
say "Starting VITALIS on port $VITALIS_PORT"
if ss -ltn 2>/dev/null | grep -q ":$VITALIS_PORT "; then
  ok "something is already listening on $VITALIS_PORT — reusing it"
else
  ( cd "$VITALIS_DIR" && nohup node server.js > "$VITALIS_DIR/vitalis.log" 2>&1 & )
  sleep 3
  curl -sf "http://127.0.0.1:$VITALIS_PORT/health" >/dev/null \
    && ok "VITALIS up (log: $VITALIS_DIR/vitalis.log)" \
    || die "VITALIS did not start — see $VITALIS_DIR/vitalis.log"
fi

# Verify the API KEY, not just the port.
#
# Found by testing this script: with a key mismatch the exporter gets HTTP 401,
# the message appears only in the APPLICATION's log, and VITALIS stays silent
# and empty. It looks exactly like "instrumentation didn't work". If VITALIS was
# already running — started by hand without VITALIS_API_KEY set, so it generated
# a random key at boot — that is precisely what happens.
AUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "x-vitalis-api-key: $VITALIS_API_KEY" "http://127.0.0.1:$VITALIS_PORT/api/traces")
if [ "$AUTH_CODE" != "200" ]; then
  die "VITALIS is listening on $VITALIS_PORT but rejected our API key (HTTP $AUTH_CODE).
     The running instance was started with a different VITALIS_API_KEY.
     Either stop it (pkill -f 'node server.js') and re-run this script, or
     re-run with the key it is using:  VITALIS_API_KEY=<thatkey> bash $0
     A mismatch fails SILENTLY at the VITALIS end — the 401 only shows up in
     the application log."
fi
ok "API key accepted by VITALIS"

# ------------------------------------------- 1b. secrets the APP itself needs
# Checked BEFORE anything is installed, so a setup gap costs nothing.
#
# backend/infra/secrets.py calls load_dotenv() then requires JWT_SECRET,
# FERNET_KEY and MONGO_URL in the environment. If any is absent the app's own
# startup() raises and uvicorn exits — nothing to do with instrumentation.
# This is a real failure mode: on the first real run of this script, .env had
# MONGO_URL but not the other two, so the backend could not start at all.
# Only NAMES are printed; no secret value is ever read or echoed.
say "Checking the secrets your backend requires"
# shellcheck disable=SC1091
source "$BACKEND_DIR/venv/bin/activate"
# NOTE: this used to swallow load_dotenv() errors with `except Exception: pass`,
# so a .env that could not be PARSED reported as "all three secrets missing" —
# a misleading message that sent you looking for the wrong problem. It happened
# for real: appending to .env from PowerShell changed its encoding, dotenv threw
# a decode error, and the check blamed missing keys. Parse failures are now
# reported as parse failures.
REPORT=$(cd "$BACKEND_DIR" && python3 - <<'PY'
import os
err = ""
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=".env")
except Exception as e:
    err = f"{type(e).__name__}: {e}"

enc = ""
try:
    raw = open(".env", "rb").read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        enc = "the file is UTF-16 (BOM found). python-dotenv reads UTF-8."
    elif raw[:3] == b"\xef\xbb\xbf":
        enc = "the file starts with a UTF-8 BOM, which can hide the first key."
    elif b"\x00" in raw:
        enc = "the file contains NUL bytes — it is not plain UTF-8 text."
except FileNotFoundError:
    enc = "no .env file found in this directory."
except Exception as e:
    enc = f"could not read .env: {type(e).__name__}"

print("ERR=" + err)
print("ENC=" + enc)
print("MISSING=" + ",".join(n for n in ("JWT_SECRET", "FERNET_KEY", "MONGO_URL") if not os.getenv(n)))
PY
)
DOTENV_ERR=$(echo "$REPORT" | sed -n 's/^ERR=//p')
DOTENV_ENC=$(echo "$REPORT" | sed -n 's/^ENC=//p')
MISSING=$(echo "$REPORT" | sed -n 's/^MISSING=//p')

if [ -n "$DOTENV_ERR" ] || [ -n "$DOTENV_ENC" ]; then
  echo ""
  [ -n "$DOTENV_ERR" ] && warn "python-dotenv could not read .env : $DOTENV_ERR"
  [ -n "$DOTENV_ENC" ] && warn "$DOTENV_ENC"
  echo ""
  echo "  This is a FILE problem, not a missing-secret problem — the keys may well"
  echo "  be in there. Rewrite it as UTF-8 without displaying its contents:"
  echo ""
  echo "    # in PowerShell"
  echo "    \$p='E:\\fintech-mobile\\backend\\.env'"
  echo "    \$t=Get-Content \$p"
  echo "    [IO.File]::WriteAllLines(\$p, \$t, (New-Object Text.UTF8Encoding \$false))"
  echo ""
  die "aborting before installing anything"
fi

if [ -n "$MISSING" ]; then
  echo ""
  warn "Missing from $BACKEND_DIR/.env : $MISSING"
  echo ""
  echo "  Your backend cannot start without these, with or without VITALIS."
  echo "  Add them to $BACKEND_DIR/.env. Generate real values with:"
  echo ""
  echo "    python3 -c \"import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(48))\""
  echo "    python3 -c \"from cryptography.fernet import Fernet; print('FERNET_KEY=' + Fernet.generate_key().decode())\""
  echo ""
  echo "  Run those inside the backend venv so cryptography is importable."
  echo "  FERNET_KEY must be a real Fernet key (32 url-safe base64 bytes), not a random string."
  die "aborting before installing anything"
fi
ok "JWT_SECRET, FERNET_KEY and MONGO_URL are all present"

# ------------------------------------------------- 2. install instrumentation
say "Installing OpenTelemetry into the backend virtualenv"
warn "this adds packages to $BACKEND_DIR/venv — no source file is touched"
pip install -q --upgrade opentelemetry-distro opentelemetry-exporter-otlp-proto-http \
  || die "pip install failed"
ok "distro + OTLP HTTP exporter installed"
opentelemetry-bootstrap -a install >/dev/null 2>&1 \
  || warn "opentelemetry-bootstrap reported a problem — continuing"
echo "  detected instrumentation:"
opentelemetry-bootstrap 2>/dev/null | sed 's/^/    /'

# --------------------------------------------------- 3. launch instrumented
say "Starting the backend under instrumentation"
export OTEL_SERVICE_NAME=finlife-api
export OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.0,deployment.environment=dev"
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://127.0.0.1:$VITALIS_PORT/v1/traces"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-vitalis-api-key=$VITALIS_API_KEY"
export OTEL_METRICS_EXPORTER=none
export OTEL_LOGS_EXPORTER=none
export OTEL_BSP_SCHEDULE_DELAY=500

cd "$BACKEND_DIR" || die "cannot cd to $BACKEND_DIR"
# NOTE: --reload is deliberately OFF. Uvicorn's reloader runs the app in a child
# process that the instrumentation agent does not wrap, so with --reload you get
# a running app and NO traces, with no error to tell you why.
nohup opentelemetry-instrument python3 -m uvicorn main:app \
  --host 127.0.0.1 --port $BACKEND_PORT > "$VITALIS_DIR/finlife-backend.log" 2>&1 &
sleep 8

curl -sf "http://127.0.0.1:$BACKEND_PORT/" >/dev/null \
  && ok "backend responding on $BACKEND_PORT" \
  || die "backend did not start — see $VITALIS_DIR/finlife-backend.log"

# ------------------------------------------------------- 4. generate traffic
say "Generating traffic"
for i in 1 2 3 4 5 6 7 8; do
  curl -s "http://127.0.0.1:$BACKEND_PORT/" >/dev/null
  curl -s "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null
done
ok "16 requests sent"
sleep 4

# ------------------------------------------------------------- 5. verify
say "What VITALIS actually received"
# The DB hop is identified by the OTel `db.system` ATTRIBUTE, not by service
# name. In a single-process app every span carries the same service.name
# (finlife-api), so checking the service list for "mongo" reports NO even when
# a Mongo hop is right there — a false negative, found by testing this script.
# So fetch one trace and look at the hop attributes, which is what VITALIS's own
# DB-hop detection does.
curl -s -H "x-vitalis-api-key: $VITALIS_API_KEY" "http://127.0.0.1:$VITALIS_PORT/api/traces" \
  > "$VITALIS_DIR/.onboard-traces.json"

VITALIS_PORT=$VITALIS_PORT VITALIS_API_KEY=$VITALIS_API_KEY \
node -e '
const http=require("http"), fs=require("fs");
const port=process.env.VITALIS_PORT, key=process.env.VITALIS_API_KEY;
let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
catch(e){ console.log("  could not read trace list:", e.message); process.exit(0); }
console.log("  traces ingested :", j.traceCount);
if(!j.traceCount){
  console.log("");
  console.log("  Nothing arrived. Check finlife-backend.log for \"Failed to export\".");
  console.log("  A 401 there means the API key does not match.");
  process.exit(0);
}
const t=j.traces[0];
console.log("  example trace   :", t.traceId, "|", t.hopCount, "hop(s) |", t.totalDurationMs+"ms");
console.log("  services        :", (t.services||[]).join(", "));
// Inspect real hops for db.system across a few traces.
const ids=j.traces.slice(0,5).map(x=>x.traceId);
let pending=ids.length; const dbHops=new Set(); const names=new Set();
for(const id of ids){
  http.get({host:"127.0.0.1",port,path:"/api/traces/"+id,headers:{"x-vitalis-api-key":key}},r=>{
    let b=""; r.on("data",d=>b+=d); r.on("end",()=>{
      try{ const d=JSON.parse(b);
        for(const h of (d.hops||[])){
          names.add((h.name||"").slice(0,40));
          const a=(h.attributes||[]).find(x=>x.key==="db.system");
          if(a) dbHops.add(Object.values(a.value)[0]);
        }
      }catch(e){}
      if(--pending===0) report();
    });
  }).on("error",()=>{ if(--pending===0) report(); });
}
function report(){
  console.log("  span names      :", [...names].join(" | "));
  console.log("");
  const found=[...dbHops];
  console.log("  DATABASE HOPS (db.system):", found.length? found.join(", ") : "NONE FOUND");
  if(found.some(s=>/mongo/i.test(s))){
    console.log("  => Mongo IS instrumented and traced. docs/22 section 3 open question: ANSWERED, yes.");
  } else if(found.length){
    console.log("  => a database hop exists but it is not Mongo.");
  } else {
    console.log("  => No db.system hop on these requests. NOT proof Mongo is uninstrumented:");
    console.log("     / and /health may not issue a real query. Exercise a data endpoint");
    console.log("     (e.g. /api/inflation/current) and re-run the verify step.");
  }
}
' "$VITALIS_DIR/.onboard-traces.json"

say "Done"
echo "  Console : http://127.0.0.1:$VITALIS_PORT/   (API key: $VITALIS_API_KEY)"
echo "  Logs    : $VITALIS_DIR/vitalis.log , $VITALIS_DIR/finlife-backend.log"
echo ""
echo "  Expect most requests to read UNKNOWN at first — a baseline needs 5 healthy"
echo "  observations of the same route before VITALIS will judge anything. That is"
echo "  deliberate (docs/24)."
echo ""
echo "  Stop: pkill -f opentelemetry-instrument ; pkill -f 'node server.js'"
