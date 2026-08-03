# Campus / School Harness — Design

Personal AI course brain for Western SE. Priority: **explain content** → **grounded course facts** → **help with work**.

Product/architecture decisions were made with a separate **planning agent**. Implementers should not re-litigate this doc unless blocked — see [HANDOFF.md](HANDOFF.md) for reconverge gates.

## Goals

1. Answer questions from real course materials (slides, digests, notes) with citations.
2. Know schedule, deadlines, announcements; allow audited AI/user edits (e.g. “extended by 2 days”).
3. Point at work where it lives (Git for code, OneDrive/Office for docs) — harness is not the only filesystem.

Term starts ~1 month out → build a **real draft** against pilot course **SE 2250B**, then attach 2026F/2027W when Brightspace enrollments appear.

## Architecture

**Structured spine (SQLite) + content on disk + RAG over markdown (later).**  
AI reads freely; writes only through audited APIs (`audit_log`).

```
Inputs                         Harness                         Agent
───────                        ───────                         ─────
Brightspace sync (custom)  →   SQLite spine                →   harness_* / content_* / mutate_*
Lecture recordings (later) →   {data_root}/…       →   RAG (H3)
OneDrive rclone            →   vector index                →   trawl (default web search)
Git work_links (URLs)      →   audit_log
```

Brightspace MCP is **not** a runtime dependency. Sync is a custom worker. Chat answers Brightspace questions from **synced harness data only**.

### Work surfaces

| Kind | Canonical home | Harness role |
|------|----------------|--------------|
| Brightspace materials, digests, transcripts, memory | Disk + SQLite | Owns |
| Coding / SE projects | Git (Forgejo/GitHub) | `work_links` only |
| Word/Excel/PPT | OneDrive / Office web | Mirror for search; edit in Office |
| Quick / AI notes | Harness markdown | Owns |

### Brightspace sync

Manual / morning-nudged (Duo). Not background scraping.

1. Playwright + Duo → own token file (survive restarts; do not use MCP hostname-keyed crypto).
2. D2L REST (LP ~1.62 / LE ~1.96): enrollments, content tree, file download, dropbox, news, syllabus.
3. sha256 change detection → `{data_root}/{term}/{code}/…`
4. pdf-extractor → markdown beside PDFs.
5. AI digest → assignments / announcements / `memory_facts` + `sync_logs/{date}.md` + ntfy.

### Pipelines

| Job | Trigger | Notes |
|-----|---------|--------|
| Brightspace sync + AI sync log | Manual / morning nudge | Duo |
| Morning digest | Cron | From DB only — no Brightspace |
| Knowledge cleanup | Scheduled | Upsert/supersede `memory_facts` |
| OneDrive mirror | rclone timer | Not deadline source of truth |
| Lecture digest | Upload + whisper/cohere | Phase H5 |

### Datetime

Every AI call injects: local now (`America/Toronto`), active term(s), timezone, next 7 days of `events`.

### Calendar

In-app `events` is source of truth (v1). Materialize from `course_sessions`, assignment/exam dues, personal notes. No requirement for external Google/ICS as primary.

### Agent tools (v1)

- `harness_*`, `content_*`, `mutate_*`, RAG (H3+)
- **trawl** — default web search (`trawl.local` / host `:11236`)
- Future MCPs pluggable; **no Brightspace MCP**

### UI direction (ceiling until after H1)

Hybrid: **course hubs** (browse real content) + **chat rail** (context-aware). Not chat-only.

Light IA: course switcher · Sync status · calendar strip · Today / Course hub / Calendar / Chat. PWA later. Native Android recorder is H5.

## Data entities

See [DATA_MODEL.md](DATA_MODEL.md) and `schema.sql`.

Core: `courses`, `course_sessions`, `assignments`, `exams`, `lectures`, `files`, `content_nodes`, `announcements`, `notes`, `memory_facts`, `events`, `work_links`, `sync_runs`, `audit_log`.

## Phases

| Phase | Deliverable |
|-------|-------------|
| **H0** | Docs + schema (`work_links`, `content_nodes`) + seed; Forgejo private remote |
| **H1** | Custom Brightspace auth + sync + AI sync log + ntfy; **SE 2250B pilot** |
| **H2** | FastAPI + thin web UI (Sync, browse, calendar, chat + datetime + trawl) |
| **H3** | RAG (Cohere embed/rerank) + knowledge cleanup cron |
| **H4** | OneDrive rclone + `work_links` usage |
| **H5** | Lecture upload/transcribe/digest (Android or simple upload) |

Stack default: FastAPI + React/TS, SQLite WAL, Chroma or sqlite-vec at H3.

## Pilot: SE 2250B

1. Link `brightspace_org_unit_id` after Duo auth.
2. Mark `is_pilot = 1`; sync content/dropbox/news end-to-end.
3. Validate CLI/API: module files, assignments, AI sync log, audited date mutation.
4. Keep as regression fixture when 2026F courses link in.

## Non-goals (v1)

- Grade calculator
- Discord bot
- Word editing / iframe Office
- Auto Brightspace scrape (no Duo)
- Public git with course content or solutions
- Open WebUI as primary UI

## Git / deploy

- **Private Forgejo:** full app, schema, seed, Nix module.
- **Public GitHub skeleton later:** architecture only — no course blobs/secrets.
- Deploy: NixOS Docker on `home`, Caddy `campus.local`, data `{data_root}/`.

## Open (implementer may decide)

- Exact Western term start/end dates for event materialization
- Chroma vs sqlite-vec
- H5: Android vs upload-only API
