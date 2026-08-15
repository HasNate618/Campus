# Campus

![CI](https://github.com/HasNate618/Campus/actions/workflows/ci.yml/badge.svg)

A personal AI study system: sync your university LMS into a local knowledge
base, then ask your courses anything. The agent harness is the product — the
web UI is a surface over it.

- **Deterministic LMS sync** — D2L REST + Playwright/MFA auth, content tree,
  files, dropbox assignments, announcements, syllabus. Change detection via
  sha256; nothing is scraped in the background.
- **AI agent harness** — course-scoped chat over a SQLite spine + files on
  disk. Every AI mutation is audited (`audit_log`); memory facts supersede,
  never rewrite history.
- **Semantic search** — embeddings + rerank over extracted course content,
  with an exact-phrase lexical boost so precise answers don't get lost in
  the rerank.
- **Web app (PWA)** — Today / Course hub / Timetable / Calendar / Chat.
  Zen markdown + a vendored pageless PDF viewer, offline-capable assets.
- **Portable** — every URL, path, and credential is config-driven
  (`config.yaml` + `CAMPUS_*` env). Point it at any Brightspace instance,
  any OpenAI-compatible model endpoint.

## Architecture

```
LMS (Brightspace/D2L) ──sync──▶ SQLite spine + files on disk ──▶ agent harness ──▶ web UI
                                    │                                │
                                    └── semantic search ◀── embed/rerank (configurable)
```

- `sync/` — LMS sync engine: config, token store, D2L client, extractors
- `agent/` — the harness: context builder, tools (read/mutate/web), chat loop
- `api/` — FastAPI backend: courses/data/sync/digest/chat (SSE) + SPA serving
- `web/` — React/TS PWA (Vite + Tailwind)
- `seed/` — registrar seed (`courses.example.json` sample, or a local
  `courses.local.json` override) + `sample.ics` timetable import
- `tools/` — one-off ops: ICS import, image caching, digest backfill

## Quick start (demo with sample data)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt
cp config.example.yaml config.yaml
python3 seed/seed.py              # seeds sample courses (CS 1100A, …)
python3 tools/ics_import.py seed/sample.ics   # optional: timetable from ICS
python3 -m uvicorn api.main:app --port 8000
```

Then open http://localhost:8000 — sample courses render without any LMS
credentials. Chat needs `llm_url` + `llm_model` (any OpenAI-compatible
endpoint; set `llm_api_key` if it requires auth).

## Real use

```bash
cp config.example.yaml config.yaml   # fill in your LMS + services
python3 -m sync auth                 # MFA push → token stored
python3 -m sync sync                 # full sync + AI digest
python3 -m agent --one "What's due this week?" --course "CS 1100A"
```

Your real enrollment data goes in `seed/courses.local.json` (gitignored) —
the repo only ever ships sample data. Course content and secrets never touch
git (see `.gitignore`).

## Docs

- [docs/DESIGN.md](docs/DESIGN.md) — architecture & decisions
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — schema & write rules
- [docs/HANDOFF.md](docs/HANDOFF.md) — implementation brief

## Tests

```bash
pip install -r requirements-dev.txt
pytest              # 25 unit tests: config portability, seed/ICS import,
                    # schedule API contract, search, agent security blocklist
```

CI (GitHub Actions) runs the backend tests on Python 3.12 and the web
type-check + production build on Node 22 for every push to `main`.

## License

MIT — see [LICENSE](LICENSE).
