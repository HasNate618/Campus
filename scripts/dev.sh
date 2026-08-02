#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r api/requirements.txt
fi

if [[ ! -f data/harness.db ]]; then
  python3 seed/seed.py --reset
  python3 seed/pilot_data.py
fi

trap 'kill 0' EXIT
.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload &
(cd web && npm run dev) &
wait
