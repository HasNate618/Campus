---
name: campus-deploy
description: Use when a user wants to deploy, set up, or understand Campus (a local-first AI study-assistant that syncs an LMS and provides local RAG chat). Covers honest prerequisites, env vars, the Brightspace/D2L coupling, web-UI build, and a verifiable preflight. One-line behavior: guide the user to a working Campus deploy without overclaiming what it needs.
---

# Campus deploy — honest setup guide

Campus is a local-first study assistant: it syncs course materials from an LMS
into a local SQLite + file store and answers questions with a tool-calling
agent that cites your files. This skill tells you (the agent) exactly what
Campus needs so you can tell the user the truth — no hidden prerequisites, no
overclaiming.

## The ONE hard requirement (and everything else is optional)

**Chat and the AI digest require exactly one thing: an OpenAI-compatible `/v1`
LLM endpoint that supports tool-calling**, configured via `OPENAI_ENDPOINT` +
`OPENAI_MODEL`. `OPENAI_API_KEY` is needed only if that endpoint requires auth
(many local / keyless gateways need none).

- With it: chat + digest work.
- Without it: the app still runs. Browse, timetable, corpus search (lexical by
  default), and sync all work. The chat endpoint returns a clear message
  instead of crashing (`run_turn` preflights on `cfg.llm_endpoints()` and
  `llm_model`).

Everything else is OPTIONAL:
- MCP server (`CAMPUS_MCP_URL`/`CAMPUS_MCP_URLS`) — external web search/read
  tools, auto-discovered and namespaced by server name.
- PDF extractor (`CAMPUS_PDF_EXTRACTOR_URL`) — routes PDFs through a parser
  (Cohere Parse/Docling/…). Empty = local PyMuPDF (digital PDFs instant).
- ntfy (`CAMPUS_NTFY_URL`) — sync notifications. Empty = disabled.
- Brightspace `base_url` — only for D2L automated sync (see below).
- `CAMPUS_EMBED_MODEL`/`CAMPUS_RERANK_MODEL` — opt-in semantic search; empty =
  built-in lexical ranker (no embeddings model needed). A 404 on either
  degrades back to lexical.
- `CAMPUS_WEB_PASSWORD` — single password for `/api/*`; empty = open demo.

**LLM env naming is STRICT: only `OPENAI_*` configures the LLM. There are NO
`CAMPUS_LLM_*` aliases** (config.py rejects them; a test asserts they're
ignored). If you ever see `CAMPUS_LLM_URL`/`CAMPUS_LLM_MODEL`/`CAMPUS_LLM_API_KEY`
anywhere, those env names do nothing — use `OPENAI_*` instead.

## Env-var reference (exact names)

| Purpose | Env var | Notes |
| --- | --- | --- |
| LLM base URL (single) | `OPENAI_ENDPOINT` | `/v1` base, e.g. `https://api.openai.com/v1` or `http://localhost:11434/v1` |
| LLM base URLs (failover list) | `OPENAI_ENDPOINTS` | comma-separated; tried in order |
| LLM Bearer key | `OPENAI_API_KEY` | **optional** — only if endpoint needs auth |
| LLM model | `OPENAI_MODEL` | required for chat/digest (run `python -m sync models` to list) |
| LMS instance (Brightspace/D2L) | `CAMPUS_BASE_URL` | leave empty unless you want automated D2L sync |
| LMS username | `CAMPUS_USERNAME` | D2L-only |
| LMS password | `CAMPUS_BRIGHTSPACE_PASSWORD` | D2L-only (never put in config.yaml) |
| Brightspace hosts allowlist | `CAMPUS_BRIGHTSPACE_HOSTS` | comma-separated; emptiness = proxy disabled |
| Brightspace link-rebase base | `CAMPUS_BRIGHTSPACE_BASE_URL` | optional |
| Course files root | `CAMPUS_DATA_ROOT` | `{term}/{code}/…`; where you drop files if not syncing |
| DB path | `CAMPUS_DB_PATH` (harness) / `CAMPUS_DB` (API runtime) | sqlite file |
| MFA token + browser profile | `CAMPUS_TOKEN_DIR` | D2L-only |
| PDF parser endpoint | `CAMPUS_PDF_EXTRACTOR_URL` | optional |
| Sync pings | `CAMPUS_NTFY_URL` | optional |
| MCP server(s) | `CAMPUS_MCP_URL` / `CAMPUS_MCP_URLS` | optional; tools auto-discovered |
| Semantic search models | `CAMPUS_EMBED_MODEL` / `CAMPUS_RERANK_MODEL` | optional, opt-in |
| Timezone | `CAMPUS_TIMEZONE` | e.g. `America/New_York`; empty = host local |
| Web API password | `CAMPUS_WEB_PASSWORD` | empty = open demo |

Precedence: defaults < `config.yaml` (gitignored) < env vars. Config keys map
1:1 to these env names (see `sync/config.py` `Config.load`).

## The Brightspace/D2L honesty

- **Automated sync targets Brightspace/D2L only.** `sync/d2l.py` is a D2L REST
  client (`/d2l/api/versions/`, lp/le paths). Only set `CAMPUS_BASE_URL` +
  `CAMPUS_USERNAME`/`CAMPUS_BRIGHTSPACE_PASSWORD` if your school is Brightspace/D2L.
- **Non-D2L users (Canvas/Moodle) or non-students:** leave `base_url` empty and
  drop course materials under `CAMPUS_DATA_ROOT` as `{term}/{code}/…`
  (lecture PDFs, notes, assignments). Browse + search + chat then run on those
  files. There is no automated pull for non-D2L LMSes.
- **ToS/automation:** D2L sync uses Playwright + MFA and stores a ~1h Bearer
  token. Scripted LMS access may be governed by your institution's terms of
  service — state this factually, don't scare the user. It is their call.

## Deployment that actually works

### A. Self-contained demo (repo's `docker-compose.yml`)
```bash
cd <repo-root>          # wherever you cloned Campus
docker compose up --build
# open http://localhost:8087
```
This builds the image, which **bakes `web/dist` at build time** (multi-stage:
node:22 builds the React PWA into the Python image). Sample data seeds when the
DB is missing. Works with zero config — chat is the only thing disabled until
you set `OPENAI_*`.

To enable chat, set the LLM env in the `environment:` block — **using the
correct `OPENAI_*` names**:
```yaml
environment:
  CAMPUS_DB: /app/data/harness.db
  CAMPUS_DATA_ROOT: /app/data/school
  OPENAI_ENDPOINT: https://api.openai.com/v1     # NOT CAMPUS_LLM_URL
  OPENAI_MODEL: gpt-4o-mini
  OPENAI_API_KEY: your-key                       # only if endpoint needs auth
```

### B. Repo-mount (homelab-style) deployment — build the web UI FIRST
If the container mounts the repo at `/app` (as the homelab deployment does), the
browser loads the **host's** `web/dist`, not a baked one. Python restarts do
NOT rebuild it. So you MUST build the UI on the host before (and after any)
frontend change:
```bash
make build-web          # = bash scripts/build-web.sh  (uses node:22-alpine, no local Node needed)
```
The running container picks up the new `web/dist` on the next request — no
restart required. If `web/dist` is missing, the API returns
`{"detail":"Frontend not built"}` (HTTP 404).

### C. Bare-metal (no Docker)
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt
cd web && npm ci && npm run build && cd ..     # builds web/dist
cp config.example.yaml config.yaml
python3 seed/seed.py
python3 tools/ics_import.py seed/sample.ics
.venv/bin/python -m uvicorn api.main:app --port 8000
```

### D. Docker run (single container, env-driven)
```bash
docker run --rm -p 8087:8000 \
  -e OPENAI_ENDPOINT=https://api.openai.com/v1 \
  -e OPENAI_MODEL=gpt-4o-mini \
  -e OPENAI_API_KEY=your-key \
  -v campus-data:/app/data \
  campus   # after: docker compose build (bakes web/dist)
```
If you mount the repo instead of using the baked image, build `web/dist` on the
host first (`make build-web`).

## Preflight checklist (runnable / verifiable)

1. **Repo present?** `test -d <repo-root> && ls <repo-root>/docker-compose.yml`
2. **Web UI built?** `test -f <repo-root>/web/dist/index.html && echo OK || echo MISSING — run make build-web`
   - Critical only for repo-mount deploys; the baked image covers the demo.
3. **LLM configured?** `python3 -c "from sync.config import Config; c=Config.load(); print('endpoint=', c.llm_endpoints(), 'model=', c.llm_model)"`
   - Empty endpoint + model → chat disabled, rest works.
4. **Endpoint reachable + tool-calling?** `curl -s $OPENAI_ENDPOINT/models -H "Authorization: Bearer ***"` (or `python -m sync models`). Confirm the model appears and the endpoint serves `/chat/completions` with `tools`.
5. **DB + data root wired?** `echo CAMPUS_DB=$CAMPUS_DB CAMPUS_DATA_ROOT=$CAMPUS_DATA_ROOT`
6. **D2L?** If `CAMPUS_BASE_URL` set, also set `CAMPUS_USERNAME`/`CAMPUS_BRIGHTSPACE_PASSWORD`; run `python3 -m sync auth` for MFA then `python3 -m sync sync`.
7. **Health:** after start, `curl -s localhost:8087/api/health` → `{"status":"ok",...}`. Frontend: `curl -s localhost:8087/ | head` should return HTML, not `{"detail":"Frontend not built"}`.

## Pitfalls

- **`CAMPUS_LLM_*` does nothing.** The LLM is configured ONLY via `OPENAI_ENDPOINT`/`OPENAI_ENDPOINTS`/`OPENAI_MODEL`/`OPENAI_API_KEY`. Do not use `CAMPUS_LLM_URL`/`CAMPUS_LLM_MODEL`/`CAMPUS_LLM_API_KEY` — they were removed.
- **Stale web UI.** In a repo-mount deploy, editing `web/src` without `make build-web` leaves the browser running old JS silently. Rebuild after every frontend change.
- **`web/dist` missing = 404 shell.** If you get `{"detail":"Frontend not built"}`, the UI was never built (bare-metal / repo-mount). Run `make build-web` or `docker compose build` (demo).
- **Chat "no endpoint" is not a crash.** Without `OPENAI_*`, chat returns a friendly notice; browse/search/sync keep working. Don't tell the user the app is broken.
- **Tool-calling required.** A plain completions endpoint won't drive the agent; it must serve `/chat/completions` with `tools`/`tool_choice`. Verify with `python -m sync models` + a test call.
- **`pilot_only: true` by default.** Sync only pulls `is_pilot` courses; set `pilot_only: false` (config) for all courses.
- **ntfy/trawl/MCP are generic.** Refer to them as "an MCP server you provide" / "your OpenAI-compatible endpoint" — don't assume a specific homelab service.

## Verify (after deploy)

- `curl -s localhost:8087/api/health` → `{"status":"ok","db":true}`
- `curl -s localhost:8087/` → HTML (not the "Frontend not built" JSON)
- If `OPENAI_*` set: `curl -s localhost:8087/api/chat/models` → `{"models":[...]}` non-empty
- Non-D2L: drop a PDF at `$CAMPUS_DATA_ROOT/<term>/<code>/` and confirm it shows in Browse + corpus search
- D2L: `python3 -m sync sync` completes and courses appear; chat answers from synced files
