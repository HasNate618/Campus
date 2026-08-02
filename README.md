# HippoCampus / School Harness

Personal AI study/org system for Western SE. Brightspace sync, structured
memory, calendar, files, and chat — see **`docs/DESIGN.md`**.

## Layout

```
api/                FastAPI backend (Phase 3)
web/                React/TS PWA frontend
schema.sql          SQLite schema (SoT for structured data)
seed/               registrar + SE 2250B pilot seed
docs/               architecture and handoff
data/               SQLite DB (gitignored)
school/             synced content (gitignored)
```

## Quick start (dev)

```bash
# Seed DB (first time)
python3 seed/seed.py --reset
python3 seed/pilot_data.py

# API (port 8000)
python3 -m venv .venv && .venv/bin/pip install -r api/requirements.txt
.venv/bin/uvicorn api.main:app --reload --port 8000

# Frontend (port 5173, proxies /api → 8000)
cd web && npm install && npm run dev

# Or both (binds 0.0.0.0 for LAN access):
./scripts/dev.sh
```

Open http://localhost:5173 — dashboard at `/today`.

## LAN access (phone / other devices)

Dev servers bind **`0.0.0.0`** so other machines on your LAN (or Tailscale) can reach them.

```bash
./scripts/dev.sh
# prints your LAN IP, e.g. http://10.0.0.45:5173
```

| Service | Port | URL |
|---------|------|-----|
| **Web UI** (use this) | 5173 | `http://<host-ip>:5173` |
| API direct | 8000 | `http://<host-ip>:8000` |

Use the **Vite URL (:5173)** on phones — it proxies `/api` to the backend. If you open `:8000` directly you get API/JSON only (unless `web/dist` is built).

**On `home`:** Caddy `school.home.lab` → `127.0.0.1:8087` (production). For dev, hit the host's LAN IP or Tailscale IP.

**Firewall:** allow TCP 5173 (and 8000 if needed) on the host.

## Production

```bash
cd web && npm run build
uvicorn api.main:app --host 0.0.0.0 --port 8000
# Serves API + static frontend from web/dist
```

Docker: `docker build -t hippocampus .` — binds `:8000`, publish `127.0.0.1:8087` via Caddy.

## API endpoints

- `GET /api/courses`, `/api/courses/{id}/hub`, content-tree, assignments
- `GET /api/announcements`, `/api/events`, `/api/digest/latest`
- `GET /api/sync/runs`, `POST /api/sync/trigger`
- `POST /api/chat` — SSE streaming (mock until agent wired)

## Rules

- Course content NEVER goes in git
- Every AI mutation is audited (`audit_log`)
- Brightspace sync is on-demand (Duo 2FA)
- Chat uses mock SSE locally; wire to `agent.run_turn` on server
