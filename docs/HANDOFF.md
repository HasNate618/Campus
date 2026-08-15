# Implementation handoff

This brief is for the implementing agent/contributor. Architecture and
product scope were set separately — do not invent a second product. If you
hit a fork that changes goals, data model, phase order, or non-goals, stop
and reconverge (see below).

Read first: [DESIGN.md](DESIGN.md), [DATA_MODEL.md](DATA_MODEL.md),
`schema.sql`, `seed/`.

## Where things live

| What | Path / endpoint |
|------|-----------------|
| This repo | `~/campus` |
| Runtime course data | `{data_root}/{term}/{code}/` (config; `./school` in dev) |
| Local/dev DB & content | `data/`, `school/` (gitignored) |
| LMS REST API | `base_url` in config (any Brightspace/D2L-compatible instance) |
| LLM gateway | `llm_url` in config — any OpenAI-compatible `/v1` endpoint; `llm_api_key` for Bearer auth |
| PDF extraction | `pdf_extractor_url` in config |
| Web search/read | `trawl_url` in config (MCP) |
| Notifications | `ntfy_url` in config |

Every URL, path, and credential is config-driven: `config.yaml` (gitignored,
copy of `config.example.yaml`) + `CAMPUS_*` env overrides.

## Rules

1. **Custom LMS sync only** — Playwright + MFA push, own token store
   (chmod 600). Token must survive container/host restarts.
2. **No auto-scrape** of the LMS. Morning "sync" = notification nudge +
   manual sync (or CLI) when MFA is needed.
3. **Chat never calls the LMS** — only SQLite + disk (+ web tools).
4. **AI mutations** go through audited APIs → `audit_log` with before/after JSON.
5. **Secrets never in git** — use env / secret manager. Do not commit
   passwords or tokens.
6. **Course content never in git** — see `.gitignore` (`data/`, `school/`,
   `sync_logs/`, `*.token`, etc.).

## Current phase focus

H1: pilot-course sync end-to-end (auth → content tree → files → dropbox →
news → AI digest). Do not deep-build the UI until H1 success checks pass.

### H1 success checks

- [ ] MFA auth → token persisted → REST calls work after process/container restart
- [ ] Pilot course `brightspace_org_unit_id` linked
- [ ] Content tree + files + dropbox + news on disk and in SQLite
- [ ] AI sync log written under course `sync_logs/`; notification fired
- [ ] ≥1 PDF processed via the extractor → markdown
- [ ] CLI or API lists assignments and module files from harness data (no live LMS)

### The user must

- Approve the MFA push on first auth
- Confirm the pilot course still appears in LMS enrollments

## Suggested implementation order

1. Python package (matches FastAPI): config, token store, LMS client
   (version discovery, cookie or bearer).
2. Auth CLI: launch Playwright with persisted profile; wait for MFA; save token.
3. Sync: enrollments → match pilot course → content root/modules/topics →
   download files → dropbox folders → news → syllabus.
4. Upsert `content_nodes`, `files`, `assignments`, `announcements`; write
   `sync_runs`.
5. Call the PDF extractor for new PDFs; mark `files.processed`.
6. LLM digest pass: deltas → `memory_facts` + markdown sync log + notification.

## When to reconverge

Come back at these gates — not continuously:

| Checkpoint | Why |
|------------|-----|
| After H1 (pilot sync works) | Validate data model vs real LMS content before H2 |
| Before H2 UI | IA pass from pilot data |
| Before lecture capture | App vs upload-only |
| When real enrollments appear | Link org units; term dates |
| Blocked fork | Auth impossible as designed; want MCP back; change memory/search approach; expand scope |

Do **not** reconverge for routine engineering choices (library X, embedding
store, path tweaks). Decide, document in DESIGN if lasting.

## Stack defaults

- FastAPI + React/TS
- SQLite WAL
- Embedding/rerank via the configured gateway; embedded vector store
  unless something simpler fits
