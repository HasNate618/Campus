# Campus

Personal AI study/org system for Western SE — Brightspace sync, structured
memory, calendar, files, and a course-scoped AI chat. The model harness is
the product; the web UI is a surface over it.

## Layout

```
agent/              AI harness: context builder, 14 tools, tool-calling loop
sync/               Brightspace sync engine (D2L REST + Playwright auth)
api/                FastAPI backend (Phase 3) — serves web/ + SSE chat
web/                React/TS PWA frontend (Vite + Tailwind v4 + shadcn)
schema.sql          SQLite schema (source of truth for structured data)
seed/               registrar + SE 2250B pilot seed (+ pilot_data.py dev mock)
docs/               architecture + handoffs (DESIGN, HANDOFF, BUILD_PLAN,
                    DATA_MODEL, FRONTEND_HANDOFF)
data/               SQLite DB (gitignored)
{data_root} synced course content (gitignored, on the homelab)
```

## Dev (frontend, on the workstation)

```bash
./scripts/dev.sh          # seeds dev DB, starts API (:8000) + Vite (:5173)
cd web && npx tsc -b      # type-check
cd web && npx vite build  # production build
```

## Dev (harness / sync, on the homelab)

```bash
nix-shell                 # playwright + python (system python lacks sqlite3)
python -m sync auth       # Duo flow — token in ~/.hippocampus
python -m sync sync       # deterministic Brightspace sync + AI digest
python -m agent           # interactive harness chat (REPL)
python -m agent --one "What's due in SE 2250B?" --course "SE 2250B"
```

## Production (homelab)

The `campus` Docker container runs everything (NixOS module
`modules/server/ai/campus.nix`): code mounted ro from `/home/nate/campus`,
DB + token mounted rw, on the proxy network, running as uid 1000 with
`--cap-drop ALL`. Web app binds `:8000` → `127.0.0.1:8087` →
`http://campus.local` (no auth — LAN/Tailscale only).

```bash
docker exec campus python -m sync sync
docker exec campus python -m agent --one "question" --course "SE 2250B"
```

## Rules

- Structured rows beat facts; all AI mutations are audited (audit_log).
- Never commit data/, *.db, config.yaml, school/ content.
- The harness owns the tools (terminal, web, mutations); the UI renders them.
