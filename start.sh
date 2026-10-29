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
#   LIVE_IG=1 sh start.sh       # live Instagram bot on 127.0.0.1:8903 (see README)
#
# The judge's ONLY requirement is their own Meta API key (env var above,
# or a `.env/secrets` line `meta-api-key=<key>` — never committed). With
# no key the proxy still starts (health shows keyPresent:false) and the app
# runs on its explicitly labelled stub/cached fallbacks. No other
# credential or account is needed: the mock bot's demo token
# (SYNTH_mock_token) is prefilled and non-secret.
#
# Live mode (LIVE_IG=1):
#   Uses the real local Instagram bot at 127.0.0.1:8903 instead of the mock
#   8904. The browser runtime config (app/ig-runtime-config.js) is generated
#   from local secrets and removed on exit. Requires the real bot already
#   running on 127.0.0.1:8903 (local-only, no nginx/public route).
#
# Stop: Ctrl-C (all processes are cleaned up).
set -eu

cd "$(dirname "$0")"

MOCK_PORT="${MOCK_PORT:-8904}"
PROXY_PORT="${PROXY_PORT:-8905}"
STATIC_PORT="${STATIC_PORT:-8000}"
LIVE_IG="${LIVE_IG:-}"
LIVE_BOT_BASE="${LIVE_BOT_BASE:-http://127.0.0.1:8903}"
RUNTIME_CONFIG="app/ig-runtime-config.js"

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

# Live-mode runtime config generation (LIVE_IG=1):
# Generates app/ig-runtime-config.js from local secrets so the static
# browser can discover live endpoints + tokens without hardcoding them.
# Tokens are never echoed; generation uses python3 stdin to avoid
# shell exposure.
RUNTIME_GENERATED=0
RUNTIME_PREEXISTED=0
if [ -n "$LIVE_IG" ]; then
  if [ -f "$RUNTIME_CONFIG" ]; then
    RUNTIME_PREEXISTED=1
    echo "start.sh: $RUNTIME_CONFIG already exists — leaving user-authored file untouched" >&2
  else
    echo "start.sh: live mode — generating $RUNTIME_CONFIG from local secrets (local-only, gitignored)"
    # Resolve live tokens: prefer meta-styles .env/secrets, fall back to
    # the bot's own secrets.env (which always has all three tokens).
    # Accepted key names (all map to the same purpose):
    #   read:    ig-bot-token / ig_api_token / IG_API_TOKEN
    #   storage: ig-storage-token / ig_catalog_token / IG_API_STORAGE_TOKEN
    #   send:    ig-send-token / IG_API_SEND_TOKEN
    # Never print credential values.
    if ! python3 << 'PYEOF' 2>/dev/null; then
import os, json, pathlib

def parse_secrets(path):
    d = {}
    try:
        for line in open(path):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return d

# Collect from both files; meta-styles/.env/secrets takes priority.
sources = []
for p in [".env/secrets", os.path.expanduser("~/secure-webserver/igwebhook/secrets.env")]:
    sources.append(parse_secrets(p))

# Merge: later files are fallback, earlier files win.
merged = {}
for d in reversed(sources):
    merged.update(d)

def pick(*keys):
    for k in keys:
        if k in merged and merged[k]:
            return merged[k]
    return ""

read_tok = pick("ig-bot-token", "ig_api_token", "IG_API_TOKEN")
storage_tok = pick("ig-storage-token", "ig_storage_token", "ig-store-token",
                   "IG_API_STORAGE_TOKEN", "ig_catalog_token")
send_tok = pick("ig-send-token", "ig_send_token", "IG_API_SEND_TOKEN")

live_base = os.environ.get("LIVE_BOT_BASE", "http://127.0.0.1:8903")
out_path = "app/ig-runtime-config.js"
# Validate we have at least the read token; storage/send may be absent
# (catalog/send will 401 gracefully if unset on the bot side).
if not read_tok:
    import sys
    print("start.sh: live mode needs ig-bot-token in .env/secrets or IG_API_TOKEN in the bot secrets.env", file=sys.stderr)
    sys.exit(1)

cfg = {
    "mode": "live",
    "botBase": live_base,
    "catalogBase": live_base,
    "sendBase": live_base,
    "readToken": read_tok,
    "catalogToken": storage_tok,
    "sendToken": send_tok,
}

# Emit as a JS file that sets window.__IG_RUNTIME__
js = "// generated by start.sh LIVE_IG=1 — local-only, gitignored, do not commit\n"
js += "(function(g){g.__IG_RUNTIME__=" + json.dumps(cfg) + ";})(typeof globalThis!==\"undefined\"?globalThis:this);\n"
pathlib.Path(out_path).write_text(js)
PYEOF
      echo "start.sh: failed to generate $RUNTIME_CONFIG" >&2
      exit 1
    fi
    RUNTIME_GENERATED=1
  fi
fi

node meta-api-proxy/server.js --port "$PROXY_PORT" &
PROXY_PID=$!
if [ -z "$LIVE_IG" ]; then
  node mock-ig-bot/server.js --port "$MOCK_PORT" &
  MOCK_PID=$!
else
  MOCK_PID=""
fi
python3 -m http.server "$STATIC_PORT" --directory app >/dev/null 2>&1 &
STATIC_PID=$!

cleanup() {
  # Remove generated runtime config on exit (never touch user-authored file)
  if [ "${RUNTIME_GENERATED:-0}" = "1" ] && [ "${RUNTIME_PREEXISTED:-0}" = "0" ]; then
    rm -f "$RUNTIME_CONFIG" 2>/dev/null || true
  fi
  # Kill child processes if they exist
  if [ -n "${PROXY_PID:-}" ]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  if [ -n "${MOCK_PID:-}" ]; then kill "$MOCK_PID" 2>/dev/null || true; fi
  if [ -n "${STATIC_PID:-}" ]; then kill "$STATIC_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Wait for all to answer before handing the judge a URL.
# Localhost must never go through an HTTP proxy (sandboxed runners and
# corporate networks both set http_proxy without a localhost exception).
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}"
export no_proxy="$NO_PROXY"
ok=1
i=0
if [ -n "$LIVE_IG" ]; then
  # Live mode: proxy + static + live bot healthz (no mock bot)
  while [ "$i" -lt 50 ]; do
    if curl --noproxy '*' -fsS "http://127.0.0.1:$PROXY_PORT/health" >/dev/null 2>&1 \
      && curl --noproxy '*' -fsS "http://127.0.0.1:$STATIC_PORT/mock-dm.html" >/dev/null 2>&1 \
      && curl --noproxy '*' -fsS "http://127.0.0.1:8903/healthz" >/dev/null 2>&1; then
      ok=0
      break
    fi
    i=$((i + 1))
    sleep 0.2
  done
  if [ "$ok" -ne 0 ]; then
    echo "start.sh: live bot not ready — is it running on 127.0.0.1:8903?" >&2
    echo "start.sh: start the real bot first (~/secure-webserver/igwebhook), then LIVE_IG=1 sh start.sh" >&2
    exit 1
  fi
  echo "meta-styles demo is up (LIVE Instagram bot mode):"
  echo "  chat (live surface):     http://localhost:$STATIC_PORT/mock-dm.html"
  echo "  proxy health:            http://127.0.0.1:$PROXY_PORT/health"
  echo "  live bot health:         http://127.0.0.1:8903/healthz (local-only)"
  echo "  runtime config:          $RUNTIME_CONFIG (generated, removed on exit)"
  echo "Press Ctrl-C to stop proxy + static (live bot keeps running separately)."
else
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
fi
wait
