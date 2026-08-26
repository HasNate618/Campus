<p align="center">
  <img src="web/public/logo-full.svg" width="360" alt="Campus wordmark" />
</p>

# Campus

![CI](https://github.com/HasNate618/Campus/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

A personal AI study system. It syncs a university LMS (Brightspace/D2L) into
a local knowledge base — SQLite spine plus files on disk — then answers
questions about your courses through an agent harness with real tool access:
structured facts, file reads, semantic search, and audited mutations.

The agent harness is the product; the web UI is a surface over it.

---

## What it does

- **Deterministic LMS sync** — D2L REST + Playwright/MFA auth. Pulls the
  content tree, module landing pages, files, dropbox assignments,
  announcements, and syllabus. sha256 change detection; nothing is scraped
  in the background, nothing is re-downloaded unchanged.
- **Course-scoped AI chat** — an agent with 19 tools over your data:
  assignments/announcements/facts, paginated file reads, grep, semantic
  search, audited mutations (extend a due date, add a note, write a fact),
  free-recall quizzes, and web search for outside questions. Every mutation
  is written to an `audit_log` with before/after JSON.
- **Semantic + lexical search** — embeddings + rerank over extracted course
  content, with an exact-phrase lexical boost so "where does it say X"
  questions find the verbatim answer instead of burying it under paraphrase
  matches.
- **A web app that runs anywhere** — Today / Course hub / Timetable /
  Calendar / Chat, PWA-installable, zen markdown rendering, a vendored
  pageless PDF viewer, offline-capable assets.
- **Portable by construction** — every URL, path, and credential is
  config-driven (`config.yaml` + `CAMPUS_*` env vars). Point it at any
  Brightspace instance and any OpenAI-compatible model endpoint
  (OpenAI, OpenRouter, Together, a local gateway — with or without an API
  key).

## Why it's interesting

The AI doesn't get a context dump of your courses. It gets **tools over a
structured store**:

```
LMS (Brightspace/D2L)
   │  sync/  — D2L REST + Playwright/MFA, sha256 change detection
   ▼
SQLite spine (21 tables) + files on disk
   │  agent/ — context builder, 17 tools, audited mutations
   ▼
Course-scoped chat (SSE) + search
   │  api/ + web/
   ▼
Browser (PWA)
```

Three decisions shape everything:

1. **The AI reads; it doesn't guess.** The system prompt is rebuilt every
   turn from live state (time, term, course scope, upcoming events, the
   course memory card). Answers are grounded in synced data or the model
   says it doesn't know.
2. **Mutations are audited, not trusted.** The harness can extend a due
   date, add a note, or write a memory fact — but every write lands in
   `audit_log` with before/after JSON, and "supersede, never delete" is
   enforced in the schema (facts flip `is_active = 0` rather than being
   removed).
3. **Search is hybrid.** Short exact phrases embed badly (a 0.34 cosine vs
   a 0.48 cutoff is a real miss), so the pipeline is: embed → cosine top-N →
   rerank, *plus* a SQLite `instr()` lexical pre-filter that force-promotes
   verbatim phrase matches to the front of the results. The snippet is
   windowed around the match so the answer text survives the cut.
4. **Quiz-me is blind-graded free recall.** The harness starts a quiz over
   the course's active memory facts; the grading model sees ONLY the answer
   key and the user's words — never the questions — so it can't flatter or
   leak the lesson. Recently-quizzed facts are skipped for 7 days so the
   answers don't sit in chat history.

## Project layout

| Path | What |
| ------ | ------ |
| `sync/` | LMS sync engine: `config.py` (defaults < yaml < env), `token_store.py`, `auth.py` (Playwright/MFA), `d2l.py` (REST client), `sync.py` (the pipeline), `extract.py` (PDF → markdown), `search.py` (embeddings/rerank/lexical index) |
| `agent/` | The harness: `context.py` (system prompt from live state), `tools.py` (17 tools + security blocklist), `chat.py` (tool-calling loop, SSE), `memory.py` (memory card + supersede), `quiz.py` (blind-graded self-tests), `mcp.py` (minimal MCP client for web tools) |
| `api/` | FastAPI backend: `routers/courses.py`, `data.py`, `sync.py`, `digest.py`, `chat.py` (SSE), `services.py` (read layer), SPA serving |
| `web/` | React/TS PWA (Vite + Tailwind): Today / Course hub / Timetable / Calendar / Chat / Workspace, zen markdown, vendored PDF viewer |
| `seed/` | `courses.example.json` (sample data shipped in the repo) + `courses.local.json` (gitignored real enrollments); `sample.ics` timetable feed |
| `tools/` | One-off ops: `ics_import.py`, `cache_images.py`, `digest_backfill.py`, `dedupe_files.py`, ... |
| `tests/` | 25 pytest units (see Tests) |
| `docs/` | `DESIGN.md` (architecture), `DATA_MODEL.md` (schema + write rules), `HANDOFF.md` (implementation brief) |

## Quickstart (demo, no credentials)

```bash
docker compose up --build
# open http://localhost:8087
```

The container seeds itself with sample courses (CS 1100A, MATH 1600A, …) and
a sample timetable — everything renders without an LMS account. Chat needs
an LLM endpoint; set `CAMPUS_LLM_URL` / `CAMPUS_LLM_MODEL` / `CAMPUS_LLM_API_KEY`
in `docker-compose.yml` if you want to talk to your courses.

Without Docker:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt
cd web && npm ci && cd ..
cp config.example.yaml config.yaml
python3 seed/seed.py                        # sample courses
python3 tools/ics_import.py seed/sample.ics # sample timetable
.venv/bin/python -m uvicorn api.main:app --port 8000
```

## Real deployment

Everything environment-specific lives in `config.yaml` (gitignored) or
`CAMPUS_*` env vars — the repo itself carries zero personal configuration.

| Config key | Env var | Purpose |
| ----------- | --------- | --------- |
| `base_url` | `CAMPUS_BASE_URL` | LMS instance (any Brightspace/D2L) |
| `username` | `CAMPUS_USERNAME` | LMS username; password via `CAMPUS_BRIGHTSPACE_PASSWORD` |
| `llm_url` / `llm_model` / `llm_api_key` | `CAMPUS_LLM_*` | Any OpenAI-compatible `/v1` endpoint; Bearer key optional |
| `data_root` | `CAMPUS_DATA_ROOT` | Where course content lands (`{term}/{code}/…`) |
| `token_dir` | `CAMPUS_TOKEN_DIR` | MFA token + browser profile |
| `institution` | — | Label in the system prompt |
| `brightspace_hosts` / `brightspace_base_url` | `CAMPUS_BRIGHTSPACE_*` | Content proxy allowlist + link rebasing (Brightspace-only features) |
| `term_dates` | — | Anchors computed class events |
| `timezone` | `CAMPUS_TIMEZONE` | User-facing datetimes + prompt clock |
| `web_password` | `CAMPUS_WEB_PASSWORD` | Optional single password for the web API; empty = open demo |

### Authentication

The web UI is open by default (zero-config demo). Set `CAMPUS_WEB_PASSWORD`
(or `web_password` in `config.yaml`) to require a password for every `/api/*`
route — static assets stay public so the login screen can load. Sessions are
in-memory with a 30-day sliding expiry; restarting the server logs everyone
out.

```bash
python3 -m sync auth        # MFA push → token stored (1h TTL)
python3 -m sync sync        # full sync + AI digest + notification
python3 -m sync models      # list models from the LLM endpoint
python3 -m sync extract --code "CS 1100A"   # PDF → markdown queue
python3 -m agent            # CLI chat (REPL)
python3 -m agent --one "What's due this week?" --course "CS 1100A"
```

Your real enrollments go in `seed/courses.local.json` (gitignored) — the
repo only ever ships sample data. Course content and secrets never touch git.

## Design decisions worth knowing

- **Memory card per course** — a ~2-3KB markdown snapshot (deadlines, facts,
  recent sync activity) regenerated on sync deltas and injected into the
  system prompt. Structured rows beat free-form facts; time-sensitive facts
  expire after 30 days; facts from ended terms become history.
- **Digest time rules** — relative dates ("tomorrow", "next week") are
  resolved to absolute before facts are stored, so memory doesn't fill with
  time-bombs.
- **Notes are files, not DB rows** — prose lives in `notes/*.md`; the
  harness writes them through an audited tool. `content/` is read-only.
- **`digested_at` one-time backfill** — announcements are digested exactly
  once, then marked; re-runs stay quiet. Same pattern for any "ingest this
  historical backlog" job.
- **ICS timetable import** — `tools/ics_import.py` maps any weekly
  `.ics` feed (university calendar export) into `course_sessions`, the same
  deterministic delete-and-reinsert the seed uses.
- **Extraction fast path** — PDFs with an embedded text layer extract in
  milliseconds via PyMuPDF; only scanned PDFs fall through to the
  OCR/VLM engine, and long scans are skipped by default.
- **Security blocklist** — the `terminal_run` tool runs inside a jailed
  container with a regex blocklist (sudo, docker, systemctl, token paths,
  config.yaml, `rm -rf /`), audited every invocation.

## Tests & CI

```bash
pip install -r requirements-dev.txt
pytest    # 25 unit tests
```

Coverage: config portability (empty defaults, env overrides, legacy names
gone), seed + ICS import round-trips, the schedule API contract the
frontend depends on, search (lexical phrase hits, snippet windowing,
chunking, cosine), and the agent security blocklist.

GitHub Actions runs the backend tests on Python 3.12 and the web
type-check + production build on Node 22 for every push to `main`.

## License

MIT — see [LICENSE](LICENSE).
