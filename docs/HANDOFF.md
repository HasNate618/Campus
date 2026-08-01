# Handoff — implementer on `home`

You are the **coding/implementer agent**. Canonical project dir: **`~/hippocampus`** on the homeserver (`ssh home`). Nate may also keep a mirror elsewhere; **build and deploy on `home`**.

Architecture and product scope were set by a separate **planning agent**. Do not invent a second product. If you hit a fork that changes goals, data model, phase order, or non-goals — **stop and reconverge** (see below).

Read first: [DESIGN.md](DESIGN.md), [DATA_MODEL.md](DATA_MODEL.md), `schema.sql`, `seed/`.

Older notes in `docs/PLAN.md` are historical; **DESIGN.md is canonical**.

**Python on `home`:** default `python3` may lack `_sqlite3`. Prefer a full Python (e.g. `nix-shell -p python3`) for seed/sync CLIs.

## Where things live

| What | Path / endpoint |
|------|-----------------|
| This repo | `~/hippocampus` |
| Runtime course data (prod) | `/srv/homelab/school/` |
| Local/dev DB & content | `data/`, `school/` (gitignored) |
| D2L API **reference only** | `/var/lib/brightspace-mcp` — patterns for auth/client; **not** a runtime dependency |
| Brightspace MCP HTTP (optional probe) | `127.0.0.1:11234` — do not wire the app to it |
| Bifrost (LLM gateway) | `bifrost.home.lab` |
| pdf-extractor | Docker `pdf-extractor` on `home` |
| Whisper / transcribe | Docker `whisper` (and/or Cohere transcribe container) |
| trawl (web search MCP) | `127.0.0.1:11236`, `trawl.home.lab` |
| ntfy | `ntfy` container / usual home.lab route |
| Caddy | `*.home.lab` → services |

Western Brightspace base URL: `https://westernu.brightspace.com`.

## Rules

1. **Custom Brightspace sync only** — Playwright + Duo, own token store (chmod 600). Token must survive container/host restarts. Do not depend on MCP session crypto keyed to hostname.
2. **No auto-scrape** of Brightspace. Morning “sync” = ntfy nudge + manual Sync (or CLI) when Duo needed.
3. **Chat never calls Brightspace** — only SQLite + disk (+ trawl for web).
4. **AI mutations** go through audited APIs → `audit_log` with before/after JSON.
5. **Secrets never in git** — use env / sops-nix. Do not commit Brightspace passwords or tokens.
6. **Course content never in git** — see `.gitignore` (`data/`, `school/`, `sync_logs/`, `*.token`, etc.).

## Current phase focus

**Finish H0 leftovers → H1 (SE 2250B pilot sync).**  
Do not deep-build H2 UI until H1 success checks pass and Nate reconverges with planning if needed.

### H0 remaining (if not done)

- [ ] Private Forgejo remote for this repo
- [ ] Seed row for SE 2250B with `is_pilot = 1` (org unit id filled on first auth)
- [ ] Confirm schema applied (`work_links`, `content_nodes`)

### H1 success checks

- [ ] Duo auth → token persisted → D2L calls work after process/container restart
- [ ] SE 2250B `brightspace_org_unit_id` linked
- [ ] Content tree + files + dropbox + news on disk and in SQLite
- [ ] AI sync log written under course `sync_logs/`; ntfy fired
- [ ] ≥1 PDF processed via pdf-extractor → markdown
- [ ] CLI or API lists assignments and module files from harness data (no live Brightspace)

### Nate must

- Approve Duo on first auth
- Confirm SE 2250B still appears in Brightspace enrollments

## Suggested H1 implementation order

1. Python package preferred (matches future FastAPI): config, token store, D2L client (version discover LP/LE, cookie or bearer).
2. Auth CLI: launch Playwright with persisted profile; wait for Duo; save token.
3. Sync: enrollments → match pilot course → content root/modules/topics → download files → dropbox folders → news → syllabus.
4. Upsert `content_nodes`, `files`, `assignments`, `announcements`; write `sync_runs`.
5. Call pdf-extractor for new PDFs; mark `files.processed`.
6. Bifrost AI pass: digest deltas → `memory_facts` + markdown sync log + ntfy.

Reuse ideas from `/var/lib/brightspace-mcp/src/api` and `src/auth` — reimplement cleanly in-tree.

## When to reconverge with planning

Come back to Nate / the planning agent at these gates — **not** continuously:

| Checkpoint | Why |
|------------|-----|
| **After H1** (SE 2250B sync works) | Validate data model vs real Western content before H2 |
| **Before H2 UI** | Short IA pass from pilot data |
| **Before H5 recorder** | Android vs upload-only |
| **When 2026F courses appear** | Link real org units; term dates |
| **Blocked fork** | Auth impossible as designed; want MCP back; change memory/RAG approach; expand into grades/Discord/etc. |

**Do not reconverge** for routine eng choices (library X, Chroma vs sqlite-vec, path tweaks). Decide, document here or in DESIGN if lasting.

Default until **after H1**: you own execution; planning is on hold.

## UI (do not over-build yet)

Ceiling until post-H1: Sync · course browse · calendar · chat rail with datetime + trawl. See DESIGN.md. No full visual redesign; no Android app in H1.

## Stack defaults

- FastAPI + React/TS (H2)
- SQLite WAL
- Cohere embed/rerank via existing home AI stack (H3); Chroma embedded default unless sqlite-vec is simpler
