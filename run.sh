#!/usr/bin/env bash
# Blackout Arena launcher (macOS / Linux)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v python3 >/dev/null 2>&1; then exec python3 "$DIR/serve.py" "$@"
elif command -v python  >/dev/null 2>&1; then exec python  "$DIR/serve.py" "$@"
elif command -v npx     >/dev/null 2>&1; then exec npx --yes serve "$DIR"
else echo "Install Python 3 or Node, then re-run."; exit 1; fi
