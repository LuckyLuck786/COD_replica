#!/usr/bin/env bash
cd "$(dirname "$0")"
if command -v python3 &>/dev/null; then exec python3 serve.py "$@"
elif command -v python &>/dev/null; then exec python serve.py "$@"
elif command -v py &>/dev/null; then exec py serve.py "$@"
else exec npx serve -l 8080 .
fi
