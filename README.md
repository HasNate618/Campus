# School Harness — personal AI study/org system

Everything for school in one place: Brightspace sync, lecture recordings +
transcription, AI memory (structured facts + RAG), calendar, files, and a
chat interface to it all. See `docs/PLAN.md` for the full architecture.

## Layout

```
schema.sql          SQLite schema (courses, assignments, lectures, memory…)
seed/               registrar course data + seed script
docs/PLAN.md        architecture & roadmap
data/               SQLite DB (gitignored)
school/             synced content per course (gitignored, on /srv in prod)
sync/               (P1) deterministic Brightspace sync engine
app/                (P2) FastAPI backend + web UI
android/            (P3) lecture recorder app
```

## Quick start

```bash
python3 seed/seed.py          # create DB + seed courses (needs sqlite-enabled python)
```

## Rules

- Course content NEVER goes in git (see .gitignore)
- Every AI mutation is audited (audit_log table) — reversible by design
- Brightspace sync is always on-demand (Duo 2FA) — no background scraping
