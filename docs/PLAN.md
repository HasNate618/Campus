# School Harness — Architecture & Plan

> **Superseded for product decisions.** Use [DESIGN.md](DESIGN.md), [HANDOFF.md](HANDOFF.md),
> and [DATA_MODEL.md](DATA_MODEL.md). This file is retained as historical context only.

Personal AI study/org harness for Western SE 3rd year (2026-27).
Repo: private. Course content never committed to git.

## 0. Philosophy

One service, one database, one brain. Everything is a pipeline that ends in
the same two places: **structured facts in SQLite** (dates, deadlines, grades,
policies — queryable and AI-editable) and **unstructured content on disk**
(lectures, transcripts, notes, files — retrievable via RAG).

The AI doesn't own the data. It reads it, writes to it through audited
endpoints, and every mutation is logged. If the AI is wrong, you can see what
it changed and revert.

## 1. Architecture

```
┌────────────┐   ┌──────────────┐   ┌─────────────────┐
│ Android    │──▶│  school-harness (1 container, proxy net)  │
│ recorder   │   │              │   │                 │
└────────────┘   │  FastAPI      │──▶ bifrost (LLM: digests, chat, facts)
                 │  + SQLite     │──▶ cohere transcribe (whisper:8086)
┌────────────┐   │  + vector idx │──▶ pdf-extractor (pdfs → markdown)
│ Web app /  │──▶│  + sync engine│──▶ cohere embed/rerank (RAG)
│ PWA (phone)│   │  + ICS export │──▶ ntfy (notifications)
└────────────┘   └──────────────┘   └─────────────────┘
                 │
Brightspace ─────┘  (D2L REST API, on-demand auth w/ Duo)
OneDrive ─────────┘  (rclone, systemd timer)
```

Deployment: NixOS module, Docker container on `proxy` network, Caddy
subdomain (school.home.lab), data at /srv/homelab/school/. Same pattern as
trawl/brightspace-mcp.

## 2. Data model (schema.sql)

- **courses / course_sessions** — registrar data, seeded, AI-verifiable
- **assignments / exams** — due dates, weights, status, notes (AI extends due
  dates here — audited)
- **lectures** — one row per lecture: date, topic, summary, slides/transcript/
  recording paths, status (scheduled/attended/missed)
- **files** — content-addressed (sha256), source-tracked (brightspace/recording/
  onedrive), processed flag for extraction pipeline
- **announcements** — synced news, deduped by brightspace_id
- **notes** — user + AI notes, markdown, course-scoped or general
- **memory_facts** — the "memory": small single-sentence verifiable facts with
  category, confidence, source, is_active (supersede not delete). course_id
  NULL = cross-course fact. This is the unified memory layer.
- **events** — calendar events (class/assignment/exam/personal), ICS-exportable
- **sync_runs** — audit of every sync: counts, log path, errors
- **audit_log** — every AI/user mutation (before/after JSON)

## 3. Brightspace sync (deterministic, on-demand)

The existing brightspace-mcp stays as a chat-time exploration tool. The sync
engine is a separate CLI inside the harness that talks to the **D2L REST API
directly** — the MCP is just a thin wrapper over these same endpoints:

- `GET /d2l/api/versions/` → auto-discover LP/LE versions (currently 1.62/1.96)
- `GET /d2l/api/lp/{v}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true` → courses
- `GET /d2l/api/le/{v}/{ou}/content/root/` + `/content/modules/{id}/structure/` → content tree
- `GET /d2l/api/le/{v}/{ou}/content/topics/{id}/file` → file download
- `GET /d2l/api/le/{v}/{ou}/news/` → announcements
- `GET /d2l/api/le/{v}/{ou}/dropbox/folders/` (+ submissions) → assignments
- `GET /d2l/api/lp/{v}/{ou}/grades/` → grades
- syllabus, roster, discussions (once per term)

**Auth flow (the only non-deterministic part, by design):**
1. `school-sync` checks for a valid token (plaintext file, chmod 600, 1h TTL)
2. No token → launch Playwright with the persisted browser profile:
   - cookies fresh → silent re-login, no Duo
   - cookies stale → you approve one Duo push, done
3. Token saved, sync proceeds deterministically

**Why not reuse the MCP's session store:** its AES key is derived from the
container hostname — restarting the container invalidates it (we hit this
today). The sync engine keeps its own token file. **Why manual sync:** Duo
2FA is mandatory; a button press + push is the least-friction honest design.
No background scraping of Brightspace.

**Post-sync pipeline (per course):**
1. Download new/changed files (sha256 diff) into
   `/srv/homelab/school/{term}/{code}/content/…`
2. New PDFs → pdf-extractor → markdown next to them
3. AI digest (bifrost): what changed, new deadlines, prof announcements →
   upsert assignments/exams/announcements/memory_facts
4. Write `sync_logs/{date}-{code}.md` (the AI-generated log you asked for)
5. ntfy push: "Sync done — 3 new files, 1 deadline updated, 2 announcements"

The web UI has a **Sync** button (with "auth needed" state); sync also runs as
a one-shot Hermes cron / ntfy-reminder if you forget.

## 4. Lecture recording pipeline

```
Android app (Kotlin) ──▶ POST /api/recordings (Tailscale)
    foreground service,   │
    m4a, course selector  ▼
                  /srv/homelab/school/{term}/{code}/recordings/
                          ▼
        cohere transcribe (whisper:8086 container) → transcript.md
                          ▼
        AI parse (bifrost): topic, key points, action items,
        questions raised → lectures row + summary + memory_facts
                          ▼
        ntfy: "ECE 3390B lecture digested — 4 key points, 1 assignment hint"
```

App design: Kotlin, foreground service (recordings survive screen-off), simple
UI (course picker, record/stop, upload status, auto-delete after upload
confirmed). This is a real SE project — SE 3350/3351/3352 material.

## 5. Interface (custom web app + PWA)

FastAPI backend, React/TS frontend (SE 3316 pays off here). PWA manifest so it
installs on your phone.

- **Dashboard**: today's classes, next deadlines, unread announcements
- **Chat**: course-scoped conversation; streams from bifrost; tools = query DB,
  update records (audited), RAG search, read/write files
- **Courses**: per-course hub — syllabus, content tree, lectures, files
- **Lecture view**: transcript + slides side-by-side, chat "about this lecture"
- **Files**: browser + text editor (CodeMirror) for md/txt/code; PDFs via
  pdf.js; docx read-only (docling) v1, generate .docx from markdown for
  submissions
- **Calendar**: upcoming view + ICS subscription
- **Sync**: the button + run history + logs

## 6. Memory / RAG

Two layers, deliberate split:

- **Structured (SQLite)** — assignments, exams, memory_facts, announcements.
  Answers "when is X due", "what changed", "what did the prof announce".
  This is the primary memory. AI edits flow through audited endpoints.
- **Unstructured (RAG)** — lecture transcripts, content markdown, notes.
  Chunked + embedded with **Cohere embed** → vector index; **Cohere rerank**
  on retrieval. Answers "what did the prof say about X".
- **Consolidation pass**: after each sync/lecture, AI extracts candidate facts
  → memory_facts upsert (dedupe, supersede by is_active=0, confidence).

Vector store: Chroma (embedded, persistent) — battle-tested, no extra
container needed. sqlite-vec is the fallback if you want zero extra deps.

## 7. Files & OneDrive

- rclone remote for your school Microsoft 365 OneDrive (one-time browser auth)
- `rclone sync school-onedrive:/ /srv/homelab/school/onedrive/` on a systemd
  timer (15 min) — content-addressed, safe
- AI can read/edit text files there; Word docs read via extraction, writes as
  generated .docx from markdown (python-docx)
- Course work you create lives in OneDrive (school's canonical copy) + local
  mirror — no dual maintenance

## 8. Calendar

- events table → `GET /calendar.ics` (stable UIDs, regenerated on change)
- Subscribe in Google Calendar / phone calendar → classes, assignments,
  exams all show up automatically
- Say "assignment X extended by 2 days" → audited update → ICS regenerates →
  calendar picks it up. Prof said X in lecture → memory_fact + event note.
- Morning digest via ntfy (Hermes cron): today's classes, deadlines this week

## 9. Git strategy

**Private repo.** GitHub (HasNate618) as primary — offsite backup, familiar
tooling. Optional Forgejo mirror. Course content stays out of git entirely
(.gitignore: data/, school content, secrets); only code, schema, config
templates, docs. Public-ify later only a cleaned skeleton if you want a
portfolio piece — course materials are Western's IP and assignment solutions
must never be public.

## 10. Roadmap

- **P0 (done)**: repo, schema.sql, seed (13 courses / 37 sessions), PLAN
- **P1**: sync engine — auth flow + D2L pulls + sync log + ntfy. The
  foundation; everything else consumes synced data.
- **P2**: web app v1 — dashboard, chat, sync button, file browser. Works on
  seeded data immediately, so value shows up fast.
- **P3**: recording pipeline — Android app + transcribe + lecture digests
- **P4**: RAG + consolidation + ICS + OneDrive + morning digest

## 11. Open decisions (need your input)

1. **Git hosting**: GitHub private (rec) vs Forgejo only vs both
2. **Stack**: FastAPI + React/TS (rec) — confirm before I scaffold the app
3. **Vector store**: Chroma embedded (rec) vs sqlite-vec
4. **Android app**: native Kotlin (rec, real foreground-service recording)
   vs PWA recorder vs third-party app + Syncthing
5. **Term dates**: fill in 2026F (Sep–Dec) and 2027W (Jan–Apr) exact dates
   (I didn't want to invent registrar calendar dates)
6. **OneDrive**: confirm your school account is the Western M365 one for rclone
7. Schedule conflicts found in seed data — check with registrar (see below)

## 12. Schedule conflicts flagged from your registrar data

- Wed 13:30–15:30: SE 3316A LAB (ACEB-4440) **vs** SE 3353B LEC (AHB-1R40)
- Tue 12:30–13:30: SE 3309A LEC (HSB-240) **vs** SE 3353B TUT (SEB-2200)
- Wed 15:30–16:30: SE 3316A LEC (SEB-1200) **vs** ECE 3390B LEC (ACEB-1420)

(One of these may be intended — e.g. a recorded/async lecture. Worth
confirming; the harness will auto-flag conflicts going forward.)
