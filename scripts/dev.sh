#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
	python3 -m venv .venv
	.venv/bin/pip install -q -r api/requirements.txt
fi

if [[ ! -f data/harness.db ]]; then
	python3 seed/seed.py --reset
	python3 seed/pilot_data.py
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '<this-host-ip>')"
echo "API:    http://${LAN_IP}:8000"
echo "Web UI: http://${LAN_IP}:5173  (proxies /api → :8000)"

trap 'kill 0' EXIT
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload &
(cd web && npm run dev) &
wait
