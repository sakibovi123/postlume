#!/usr/bin/env bash
# Runs Django (8000), the render worker and Next.js (8020) together. Ctrl+C stops all three.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8020}"

if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "Run ./setup.sh first."; exit 1
fi

trap 'kill 0' EXIT INT TERM
(cd "$ROOT/backend" && .venv/bin/python manage.py runserver 127.0.0.1:8000) &
(cd "$ROOT/backend" && .venv/bin/python manage.py runworker) &
(cd "$ROOT/frontend" && pnpm dev --port "$PORT") &
wait
