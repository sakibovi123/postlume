#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"
[ -d .venv ] || uv venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
[ -f .env ] || cp .env.example .env
.venv/bin/python manage.py migrate
cd "$ROOT/frontend"
pnpm install
echo "Done. Start everything with ./dev.sh and open http://localhost:3000"
