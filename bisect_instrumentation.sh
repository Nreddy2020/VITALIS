#!/bin/bash
# =============================================================================
# VITALIS — find what collapses every request into one trace
#
#   wsl bash -lc "bash /mnt/e/VITALIS/bisect_instrumentation.sh"
#
# On the FinLife backend, 16 HTTP requests arrived under a single trace id:
# 60 spans, 18 request roots, all parented to one long-lived span that was
# never exported. Something holds an OpenTelemetry context open for the life of
# the process, so every request is adopted as its child.
#
# This runs the app repeatedly, disabling one instrumentation at a time, and
# reports which one (if any) restores one-trace-per-request. Fully automatic.
#
# It writes NOTHING to E:\fintech-mobile and installs nothing — it only sets
# environment variables for each run. Expect roughly 6-8 minutes.
# =============================================================================
set -u

VITALIS_DIR="${VITALIS_DIR:-/mnt/e/VITALIS}"
APP_DIR="${APP_DIR:-/mnt/e/fintech-mobile}"
BACKEND_DIR="$APP_DIR/backend"
VITALIS_PORT=4318
BACKEND_PORT=8000
REQUESTS=8
GOOD_THRESHOLD=5        # >= this many distinct traces from 8 requests = correct grouping
export VITALIS_API_KEY="${VITALIS_API_KEY:-finlife-onboarding-key}"

# Everything except fastapi, asgi and pymongo, which we need.
CANDIDATES="asyncio threading logging click urllib urllib3 requests httpx wsgi dbapi sqlite3 tortoiseorm exceptions starlette"

say()  { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "  \033[0;32m✔\033[0m $*"; }
warn() { echo -e "  \033[0;33m!\033[0m $*"; }
die()  { echo -e "  \033[0;31m✘ $*\033[0m"; exit 1; }

[ -f "$BACKEND_DIR/venv/bin/activate" ] || die "no virtualenv at $BACKEND_DIR/venv"
command -v node >/dev/null || die "node is not installed in WSL"
pgrep -x mongod >/dev/null || die "mongod is not running — start MongoDB first"

say "Clearing anything left running"
pkill -f 'opentelemetry-instrument' 2>/dev/null
pkill -f 'node server.js' 2>/dev/null
sleep 2
ok "clear"

# shellcheck disable=SC1091
source "$BACKEND_DIR/venv/bin/activate"

WORK=$(mktemp -d)
RESULTS="$WORK/results.txt"
: > "$RESULTS"

# Run the app once with a given disable-list; echo the number of distinct traces.
run_once() {
  local disabled="$1"
  local datadir="$WORK/data-$RANDOM"
  local label="${disabled:-<none>}"

  # NOTE: every progress line here goes to STDERR on purpose. This function's
  # STDOUT is captured by `$(run_once ...)`, so anything printed there would be
  # swallowed into the return value and never reach the terminal. The first
  # version printed nothing at all, which meant 20-40 seconds of total silence
  # per step and no way to tell a slow run from a hung one.
  printf '    [%s] starting VITALIS…' "$label" >&2
  ( cd "$VITALIS_DIR" && VITALIS_DATA_DIR="$datadir" nohup node server.js > "$WORK/vitalis.log" 2>&1 & )
  sleep 3
  if ! curl -sf "http://127.0.0.1:$VITALIS_PORT/health" >/dev/null; then
    printf ' FAILED\n' >&2
    echo "VITALIS_FAILED"; return
  fi
  printf ' up. starting backend (≈9s)…' >&2

  ( cd "$BACKEND_DIR" && \
    OTEL_SERVICE_NAME=finlife-api \
    OTEL_TRACES_EXPORTER=otlp \
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://127.0.0.1:$VITALIS_PORT/v1/traces" \
    OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-vitalis-api-key=$VITALIS_API_KEY" \
    OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none OTEL_BSP_SCHEDULE_DELAY=500 \
    OTEL_PYTHON_DISABLED_INSTRUMENTATIONS="$disabled" \
    nohup opentelemetry-instrument python3 -m uvicorn main:app \
      --host 127.0.0.1 --port $BACKEND_PORT > "$WORK/backend.log" 2>&1 & )
  sleep 9

  if ! curl -sf "http://127.0.0.1:$BACKEND_PORT/" >/dev/null; then
    printf ' BACKEND FAILED\n' >&2
    tail -3 "$WORK/backend.log" 2>/dev/null | sed 's/^/      /' >&2
    pkill -f 'opentelemetry-instrument' 2>/dev/null; pkill -f 'node server.js' 2>/dev/null; sleep 2
    echo "APP_FAILED"; return
  fi
  printf ' up. sending %s requests…' "$REQUESTS" >&2

  local i=0
  while [ $i -lt $REQUESTS ]; do curl -s "http://127.0.0.1:$BACKEND_PORT/" >/dev/null; i=$((i+1)); done
  sleep 4

  local count
  count=$(curl -s -H "x-vitalis-api-key: $VITALIS_API_KEY" \
    "http://127.0.0.1:$VITALIS_PORT/api/traces" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).traceCount)}catch(e){console.log("PARSE_FAILED")}})')

  printf ' %s traces.\n' "$count" >&2
  pkill -f 'opentelemetry-instrument' 2>/dev/null
  pkill -f 'node server.js' 2>/dev/null
  sleep 2
  echo "$count"
}

report() { printf "  %-46s %s\n" "$1" "$2"; }

# ------------------------------------------------------------ 1. control
say "Control run — nothing disabled ($REQUESTS requests)"
CONTROL=$(run_once "")
report "nothing disabled" "$CONTROL traces"
case "$CONTROL" in
  VITALIS_FAILED) die "VITALIS would not start — see $WORK/vitalis.log" ;;
  APP_FAILED)     die "the backend would not start — see $WORK/backend.log" ;;
esac
if [ "$CONTROL" -ge "$GOOD_THRESHOLD" ] 2>/dev/null; then
  ok "$CONTROL traces from $REQUESTS requests — grouping is already CORRECT."
  warn "The problem did not reproduce this run. It may depend on request timing or"
  warn "on which endpoints are hit. Nothing further to bisect."
  exit 0
fi
warn "reproduced: $REQUESTS requests collapsed into $CONTROL trace(s)"

# ---------------------------------------------------- 2. screen: all off
say "Screening — every non-essential instrumentation disabled"
ALL=$(echo "$CANDIDATES" | tr ' ' ',')
SCREEN=$(run_once "$ALL")
report "all 14 disabled" "$SCREEN traces"
if ! [ "$SCREEN" -ge "$GOOD_THRESHOLD" ] 2>/dev/null; then
  echo ""
  echo "=================================================================="
  echo "CONCLUSION: NOT caused by any optional instrumentation."
  echo "=================================================================="
  echo "  With all 14 disabled, $REQUESTS requests still produced $SCREEN trace(s)."
  echo "  Only fastapi, asgi and pymongo remained, so the cause is one of those"
  echo "  or something in the application itself holding a context open."
  echo ""
  echo "  Most likely candidate: the async startup hook. main.py runs"
  echo "  MongoDB.connect() inside @app.on_event(\"startup\"), which executes in"
  echo "  the ASGI lifespan. A span or context entered there and never exited"
  echo "  stays current for the whole event loop, and every later request"
  echo "  inherits it as parent — exactly the shape observed."
  echo ""
  echo "  That is a finding about the application, worth knowing regardless of"
  echo "  VITALIS: it means your traces are unusable in ANY tracing backend."
  exit 0
fi
ok "with all 14 disabled: $SCREEN traces — correct. The culprit is among them."

# ------------------------------------------------- 3. sweep one at a time
say "Sweeping each instrumentation individually"
echo "  (a run that returns to $GOOD_THRESHOLD+ traces means THAT one was responsible)"
echo ""
CULPRITS=""
STEP=0
TOTAL=$(echo $CANDIDATES | wc -w)
for c in $CANDIDATES; do
  STEP=$((STEP+1))
  echo "  --- $STEP of $TOTAL ---" >&2
  n=$(run_once "$c")
  if [ "$n" -ge "$GOOD_THRESHOLD" ] 2>/dev/null; then
    report "disabled: $c" "$n traces   <-- FIXES IT"
    CULPRITS="$CULPRITS $c"
  else
    report "disabled: $c" "$n traces"
  fi
  echo "$c=$n" >> "$RESULTS"
done

echo ""
echo "=================================================================="
if [ -n "$CULPRITS" ]; then
  echo "CULPRIT:$CULPRITS"
  echo "=================================================================="
  echo "  Disabling that alone restores one trace per request."
  echo ""
  echo "  Make it permanent by exporting this wherever you start the backend:"
  echo "    OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=$(echo $CULPRITS | tr ' ' ',')"
  echo ""
  echo "  Then re-run:  bash $VITALIS_DIR/onboard_finlife.sh"
else
  echo "CONCLUSION: no single instrumentation is responsible."
  echo "=================================================================="
  echo "  Disabling all 14 together fixed it, but no one of them does alone,"
  echo "  so two or more interact. Bisect by halves from the full list:"
  echo "    $CANDIDATES"
fi
echo ""
echo "  Raw counts: $RESULTS"
