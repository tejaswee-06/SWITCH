#!/usr/bin/env bash
# SWITCH — start the backend (FastAPI, SIMULATED DEMO) and the frontend (Vite) on macOS / Linux.
# Requires Python 3.11+ (3.13 recommended for the pinned ML artifacts) and Node.js 20+.
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
echo "============================================"
echo " SWITCH - SIMULATED DEMO (no real devices, no Amazon / Alexa connection)"
echo "============================================"
if [ ! -x switch_backend/.venv/bin/python ]; then
  echo "Creating backend virtual environment..."; "$PY" -m venv switch_backend/.venv
fi
switch_backend/.venv/bin/python -m pip install -q -r switch_backend/requirements.txt
if [ ! -f node_modules/vite/bin/vite.js ]; then echo "Installing frontend dependencies..."; npm ci; fi
mkdir -p switch_backend/data
( cd switch_backend && SWITCH_ENV=demo SWITCH_DEMO_PROFILE=journey SWITCH_DB=data/switch.db .venv/bin/python -m app ) &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null || true' EXIT INT TERM
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8000/health && break; sleep 0.5; done
echo "Backend:  http://127.0.0.1:8000   (API docs: /docs)"
echo "Frontend: http://127.0.0.1:5173    (Ctrl+C stops both)"
npm run dev -- --host 127.0.0.1 --port 5173
