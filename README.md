<p align="center">
  <img src="web/public/logo-full.svg" width="540" alt="Campus wordmark" />
</p>

# Campus

![CI](https://github.com/HasNate618/Campus/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

An offline-first study system that syncs Brightspace into a local SQLite + file store and answers questions with an agent that has to show its work.

I built Campus because I was tired of hunting through Brightspace. Files four clicks deep, due dates split between a dropbox and a line in a PDF, announcements that scroll past and disappear. I wanted one place that felt like my desk. Something that would remember what was due, keep my notes next to the source material, and answer from my actual files instead of guessing.

## Preview

<p align="center">
  <img src="docs/images/today.png" width="900" alt="Today — digest and next 7 days" />
</p>
<p align="center"><em>Today — digest and next 7 days</em></p>

<p align="center">
  <img src="docs/images/course-hub.png" width="900" alt="Course hub — browsable content tree" />
</p>
<p align="center"><em>Course hub — browsable content tree, no Brightspace clicks</em></p>

<p align="center">
  <img src="docs/images/chat-citation.png" width="900" alt="Chat — exact citation with source" />
</p>
<p align="center"><em>Chat — exact line with citation, not a guess, and audited writes</em></p>

## Tech stack

| Layer | Choice | Why this one |
| --- | --- | --- |
| Sync engine | Python, Playwright, httpx, PyMuPDF | Playwright handles MFA and keeps a token that survives restarts. PyMuPDF pulls text from most PDFs in milliseconds and I only fall back to OCR for scans |
| Agent harness | Python, SQLite WAL, embeddings + rerank | The agent queries structured state instead of getting a giant context dump. Keeps answers grounded and auditable |
| Search | Embeddings with SQLite `instr()` lexical boost | Exact phrases like "late penalty is 10 percent per day" embed poorly at 0.34 vs a 0.48 cutoff. The lexical check pushes verbatim hits to the front |
| API | FastAPI, SSE, Pydantic | Small typed surface that the web and the agent both call |
| Web | React 19, TypeScript, Vite, Tailwind | Fast PWA that works offline for the shell, pageless PDF viewer included |
| Infra | Docker, GitHub Actions | One command demo and tests on every push to main |

## How it works

The model never gets a dump of your courses. It gets tools over a clean store.

```text
Brightspace / D2L
  -> sync/ (D2L REST + Playwright/MFA, sha256 change detection)
  -> SQLite (21 tables) + files on disk
  -> agent/ (context builder, 19 tools, audited writes)
  -> FastAPI + React PWA
  -> Browser
```

What shaped the design:

- The agent reads, it does not guess. The system prompt is rebuilt every turn from live state: current time, active term, course scope, upcoming events, and the course memory card. If the answer is not in the synced data, it says so.
- Writes are audited. Extending a due date or saving a fact writes before/after JSON to `audit_log`. Facts are superseded by flipping `is_active` to 0 and inserting a new row, never deleted in place.
- Quiz is blind graded. The grading model only sees the answer key and what you wrote, not the question text. That keeps it from being nice or leaking the lesson. Recently quizzed facts are skipped for 7 days so chat history does not give away the answer.

More detail lives in `docs/DESIGN.md` and `docs/DATA_MODEL.md`.

## Project layout

| Path | Contains |
| --- | --- |
| `sync/` | LMS sync. Config with defaults then yaml then env, token store, Playwright auth, D2L REST client, pipeline, PDF to markdown, search index |
| `agent/` | Harness. Context builder, tool definitions with blocklist, tool calling loop over SSE, memory card, blind graded quiz, small MCP client |
| `api/` | FastAPI. Routers for courses, data, sync, digest, and chat, plus services and SPA serving |
| `web/` | React and TypeScript PWA. Today, Course hub, Timetable, Calendar, Chat, Workspace, zen markdown, vendored PDF viewer |
| `seed/` | `courses.example.json` ships sample data, `courses.local.json` is gitignored for real enrollments, `sample.ics` for timetable |
| `tools/` | One off scripts like `ics_import.py` and `digest_backfill.py` |
| `tests/` | 25 pytest units. Config, seed round trips, search, security blocklist |
| `docs/` | DESIGN, DATA_MODEL, HANDOFF |

## What I learned

This is the largest thing I have shipped end to end and it changed how I think about building with an agent in the loop.

The sync and the store are the product, not the prompt. When the data is clean and queryable, the agent can stay simple and still look smart. When the data is messy, no prompt fixes it. The sha256 check that skips unchanged files and the deterministic delete and reinsert for timetable imports both started as small reliability wins and ended up being the reason the app feels trustworthy.

Portability was worth the extra config layer. Defaults then yaml then env felt fussy at first, but it means a fresh clone runs with no secrets and a prod deploy only needs env vars. Same pattern made Docker work without special casing.

Search humbled me. I assumed embeddings would just work. Then a short exact phrase failed at 0.34 cosine against a 0.48 cutoff and buried the right slide. Adding a SQLite `instr()` lexical pre filter felt almost too simple, but it fixed the exact questions a student actually asks, and windowing the snippet around that match kept the answer text from getting cut.

Tradeoffs I made on purpose: SQLite WAL for portability over Postgres, polling style sync you trigger instead of background scraping that would fight MFA, polling for search rerank that is good enough for one user before I add heavier infra.

Next I want to add tracing around the agent loop and a heavier test around the timetable generation.

## Run it

Prerequisites: Docker, or Python 3.12 and Node 22 if you run outside Docker.

```bash
docker compose up --build
# open http://localhost:8087
```

Without Docker:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt
cd web && npm ci && cd ..
cp config.example.yaml config.yaml
python3 seed/seed.py
python3 tools/ics_import.py seed/sample.ics
.venv/bin/python -m uvicorn api.main:app --port 8000
```

Try this once it is running:

```bash
# CLI chat over your local data, no browser needed
python3 -m agent --one "What's due this week?" --course "CS 1100A"
```

Chat needs a model endpoint. Set `CAMPUS_LLM_URL`, `CAMPUS_LLM_MODEL`, and `CAMPUS_LLM_API_KEY` in `docker-compose.yml` or `config.yaml`. Any OpenAI compatible `/v1` endpoint works.

## Configuration

All personal values live in `config.yaml` (gitignored) or `CAMPUS_*` env vars. The repo ships with no secrets.

| Key | Env var | Purpose |
| --- | --- | --- |
| `base_url` | `CAMPUS_BASE_URL` | Your Brightspace instance |
| `username` | `CAMPUS_USERNAME` | LMS username, password via `CAMPUS_BRIGHTSPACE_PASSWORD` |
| `llm_url`, `llm_model`, `llm_api_key` | `CAMPUS_LLM_*` | Any OpenAI compatible endpoint, key is optional for local gateways |
| `data_root` | `CAMPUS_DATA_ROOT` | Where course files land as `{term}/{code}/...` |
| `token_dir` | `CAMPUS_TOKEN_DIR` | MFA token and browser profile |
| `web_password` | `CAMPUS_WEB_PASSWORD` | Single password for `/api/*` routes, empty means open demo |
| `timezone` | `CAMPUS_TIMEZONE` | Dates you see and the clock in the prompt |
| `term_dates` | n/a | Start and end dates that anchor class events |

Common commands once configured for a real term:

```bash
python3 -m sync auth        # MFA push, stores token with 1h TTL
python3 -m sync sync        # full sync, AI digest, notification
python3 -m sync extract --code "CS 1100A"
python3 -m agent            # REPL chat
```

Your real enrollments go in `seed/courses.local.json`. Course content and secrets never get committed.

## Tests and CI

```bash
pip install -r requirements-dev.txt
pytest    # 25 tests
```

Covers config portability with env overrides, seed and ICS import round trips, the schedule contract the frontend relies on, search behavior with lexical hits and snippet windowing and chunking, and the agent security blocklist.

GitHub Actions runs backend tests on Python 3.12 and the web typecheck plus production build on Node 22 for every push to main.

## License

MIT. See LICENSE.

---

I am Nate, a software engineering student looking for internships and new grad roles. I like boring reliability work: hash checks, audit logs, deterministic imports, the things that make a system trustworthy when AI is in the loop. If this kind of work is interesting to your team, I would love to talk.
