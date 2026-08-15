# Campus — Design

Personal AI course brain: syncs a university LMS, builds a structured local
knowledge base, and answers course questions from *synced data only* with an
agent harness. Priority: **explain content** → **grounded course facts** →
**help with work**.

## Goals

1. Answer questions from real course materials (slides, digests, notes) with citations.
2. Know schedule, deadlines, announcements; allow audited AI/user edits (e.g. “extended by 2 days”).
3. Point at work where it lives (Git for code, cloud docs for documents) — the harness is not the only filesystem.

## Architecture

**Structured spine (SQLite) + content on disk + semantic search over markdown.**
AI reads freely; writes only through audited APIs (`audit_log`).

```
Inputs                          Harness                         Agent
───────                         ───────                         ─────
LMS sync (custom)          →   SQLite spine                →   harness_* / content_* / mutate_*
Lecture recordings (later) →   {data_root}/{term}/{code}/…  →   semantic search
Cloud docs mirror          →   vector index                →   web tools (default)
Git work_links (URLs)      →   audit_log
```

The LMS MCP is **not** a runtime dependency. Sync is a custom worker. Chat
answers LMS questions from **synced harness data only**.

### Work surfaces

| Kind | Canonical home | Harness role |
|------|----------------|--------------|
| Course materials, digests, transcripts, memory | Disk + SQLite | Owns |
| Coding / SE projects | Git | `work_links` only |
| Word/Excel/PPT | Cloud / Office web | Mirror for search; edit elsewhere |
| Quick / AI notes | Harness markdown | Owns |

### LMS sync

Manual / nudged (MFA push). Not background scraping.

1. Playwright + MFA → own token file (survive restarts).
2. LMS REST API: enrollments, content tree, file download, dropbox, news, syllabus.
3. sha256 change detection → `{data_root}/{term}/{code}/…`
4. PDF extractor → markdown beside PDFs (fast path: embedded text layer; fallback: OCR/VLM).
5. AI digest → assignments / announcements / `memory_facts` + `sync_logs/{date}.md` + push notification.

### Pipelines

| Job | Trigger | Notes |
|-----|---------|--------|
| LMS sync + AI sync log | Manual / nudge | MFA |
| Morning digest | Cron | From DB only — no LMS |
| Knowledge cleanup | Scheduled | Upsert/supersede `memory_facts` |
| Cloud mirror | Timer | Not deadline source of truth |
| Lecture digest | Upload + whisper/embed | Later phase |

### Datetime

Every AI call injects: local now, active term(s), timezone, next 7 days of `events`.

### Calendar

In-app `events` is source of truth (v1). Materialize from `course_sessions`
(which may be imported from an ICS feed), assignment/exam dues, personal
notes. No external calendar required as primary.

### Agent tools (v1)

- `harness_*`, `content_*`, `mutate_*`, semantic search
- web search/read via a pluggable MCP tool
- Future MCPs pluggable; **no LMS MCP** — everything comes from synced data

### UI direction

Hybrid: **course hubs** (browse real content) + **chat rail** (context-aware).
Not chat-only.

Light IA: course switcher · sync status · timetable · Today / Course hub /
Calendar / Chat. PWA.

## Data entities

See [DATA_MODEL.md](DATA_MODEL.md) and `schema.sql`.

Core: `courses`, `course_sessions`, `assignments`, `exams`, `lectures`,
`files`, `content_nodes`, `announcements`, `notes`, `memory_facts`, `events`,
`work_links`, `sync_runs`, `audit_log`.

## Phases

| Phase | Deliverable |
|-------|-------------|
| **H0** | Docs + schema + seed |
| **H1** | Custom LMS auth + sync + AI sync log + push notification; pilot course end-to-end |
| **H2** | FastAPI + web UI (Sync, browse, timetable, chat + datetime + web tools) |
| **H3** | Semantic search (embed/rerank) + knowledge cleanup cron |
| **H4** | Cloud docs mirror + `work_links` usage |
| **H5** | Lecture upload/transcribe/digest |

Stack: FastAPI + React/TS, SQLite WAL, semantic search over chunks.

## Non-goals (v1)

- Grade calculator
- Chat-app bot
- Word editing / iframe office
- Background LMS scraping
- Course content or solutions in git
- Another chat UI as primary surface

## Portability

Everything environment-specific lives in `config.yaml` (gitignored) or
`CAMPUS_*` env vars: LMS base URL, credentials, data root, service URLs,
model, term dates. The repo ships `config.example.yaml` + `seed/courses.example.json`
with sample data so a fresh clone runs without any personal configuration.

## Open (implementer may decide)

- Term start/end dates for event materialization (config `term_dates`)
- Embedding store choice
- Lecture capture: app vs upload-only API
