#!/bin/sh
# Start the Milestone 14 Meta Model API proxy with the key from .env/secrets.
# The key is parsed into the proxy process env only — never printed.
set -eu
cd "$(dirname "$0")/.."
export MODEL_API_KEY="$(python3 -c '
import sys
for line in open(".env/secrets"):
    line = line.rstrip("\n")
    if line.startswith("meta-api-key="):
        sys.stdout.write(line.split("=", 1)[1].strip()); break
')"
if [ -z "$MODEL_API_KEY" ]; then echo "meta-api-key not found in .env/secrets" >&2; exit 1; fi
exec node meta-api-proxy/server.js "$@"
