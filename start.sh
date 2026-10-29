#!/bin/sh
# meta-styles Milestone 19g — one-shot local install+run for judges.
#
# NEW hackathon work (building period Oct 27 – Nov 4, 2026). Starts the
# three local processes the judged demo needs, together, from one command:
#   1. meta-api-proxy  (Meta Model API proxy, 127.0.0.1:8905)
#   2. mock-ig-bot     (synthetic offline DM bot, 127.0.0.1:8904)
#   3. static server   (serves app/, localhost:8000)
#
# Usage:
#   sh start.sh                 # key from MODEL_API_KEY env, else .env/secrets
#   MODEL_API_KEY=<key> sh start.sh
#
# The judge's ONLY requirement is their own Meta API key (env var above,
# or a `.env/secrets` line `meta-api-key=<key>` — never committed). With
# no key the proxy still starts (health shows keyPresent:false) and the app
# runs on its explicitly labelled stub/cached fallbacks. No other
# credential or account is needed: the mock bot's demo token
# (SYNTH_mock_token) is prefilled and non-secret.
#
# Stop: Ctrl-C (all three processes are cleaned up).
set -eu

cd "$(dirname "$0")"

MOCK_PORT="${MOCK_PORT:-8904}"
PROXY_PORT="${PROXY_PORT:-8905}"
STATIC_PORT="${STATIC_PORT:-8000}"

command -v node >/dev/null 2>&1 || { echo "start.sh: node is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "start.sh: python3 is required" >&2; exit 1; }
[ -f meta-api-proxy/server.js ] || { echo "start.sh: run from the repo root" >&2; exit 1; }

# Key resolution: explicit env wins; else parse .env/secrets (hyphenated
# names are not valid shell variables, so never `source` it); else empty
# (proxy runs keyless on labelled fallbacks). The value is passed via the
# process environment only — never printed, never written anywhere.
if [ -z "${MODEL_API_KEY:-}" ]; then
  if [ -f .env/secrets ]; then
    MODEL_API_KEY="$(python3 -c '
import sys
for line in open(".env/secrets"):
    line = line.rstrip("\n")
    if line.startswith("meta-api-key="):
        sys.stdout.write(line.split("=", 1)[1].strip()); break
' 2>/dev/null)" || MODEL_API_KEY=""
  fi
fi
export MODEL_API_KEY="${MODEL_API_KEY:-}"
if [ -z "$MODEL_API_KEY" ]; then
  echo "start.sh: no Meta API key found (MODEL_API_KEY or .env/secrets) —"
  echo "start.sh: proxy starts keyless; the demo runs on labelled stub/cached fallbacks."
fi

node meta-api-proxy/server.js --port "$PROXY_PORT" &
PROXY_PID=$!
node mock-ig-bot/server.js --port "$MOCK_PORT" &
MOCK_PID=$!
python3 -m http.server "$STATIC_PORT" --directory app >/dev/null 2>&1 &
STATIC_PID=$!

cleanup() {
  kill "$PROXY_PID" "$MOCK_PID" "$STATIC_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Wait for all three to answer before handing the judge a URL.
# Localhost must never go through an HTTP proxy (sandboxed runners and
# corporate networks both set http_proxy without a localhost exception).
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
ok=1
i=0
while [ "$i" -lt 50 ]; do
  if curl --noproxy '*' -fsS "http://127.0.0.1:$PROXY_PORT/health" >/dev/null 2>&1 \
    && curl --noproxy '*' -fsS -H "Authorization: Bearer SYNTH_mock_token" \
      "http://127.0.0.1:$MOCK_PORT/ig/shares?limit=1" >/dev/null 2>&1 \
    && curl --noproxy '*' -fsS "http://127.0.0.1:$STATIC_PORT/mock-dm.html" >/dev/null 2>&1; then
    ok=0
    break
  fi
  i=$((i + 1))
  sleep 0.2
done
if [ "$ok" -ne 0 ]; then
  echo "start.sh: a process failed to come up — check the output above" >&2
  exit 1
fi

echo "meta-styles demo is up:"
echo "  chat (judged surface): http://localhost:$STATIC_PORT/mock-dm.html"
echo "  proxy health:          http://127.0.0.1:$PROXY_PORT/health"
echo "Press Ctrl-C to stop all three."
wait
