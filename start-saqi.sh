#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Saqi (Salt-Smart Desert Irrigation) Launcher ==="
if command -v node >/dev/null 2>&1; then
  node --test tests/engine.test.js
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -m unittest discover -s tests
  echo "Starting Saqi server at http://localhost:8765 ..."
  exec python3 server.py
elif command -v npx >/dev/null 2>&1; then
  echo "Python3 not found; starting static server at http://localhost:8765 ..."
  exec npx --yes serve -l 8765 .
else
  echo "Install Python 3.10+ or Node.js to run Saqi locally." >&2
  exit 1
fi
