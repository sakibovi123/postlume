#!/usr/bin/env bash
# Runs migrations, then the web server and the render worker in one container so they
# share the same /data volume (SQLite + rendered media). If either exits, the container
# exits and Railway restarts it.
set -euo pipefail

python manage.py migrate --noinput

BINDS=(--bind "[::]:8000")
if [ -n "${PORT:-}" ] && [ "${PORT}" != "8000" ]; then
  BINDS+=(--bind "[::]:${PORT}")
fi

python manage.py runworker &
WORKER_PID=$!

gunicorn config.wsgi:application "${BINDS[@]}" \
  --workers "${WEB_CONCURRENCY:-2}" --threads 4 --timeout 300 \
  --access-logfile - --error-logfile - &
WEB_PID=$!

trap 'kill -TERM "$WORKER_PID" "$WEB_PID" 2>/dev/null || true' TERM INT

set +e
wait -n "$WORKER_PID" "$WEB_PID"
STATUS=$?
kill -TERM "$WORKER_PID" "$WEB_PID" 2>/dev/null
wait
exit "$STATUS"
