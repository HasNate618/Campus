# HippoCampus — personal AI study/org system

Everything for school in one place: Brightspace sync, lecture recordings +
transcription, AI memory (structured facts + RAG), calendar, files, and a
chat interface to it all. Canonical docs: `docs/DESIGN.md` (architecture),
`docs/HANDOFF.md` (implementer brief), `docs/PLAN.md` (historical).

## Layout

```
schema.sql          SQLite schema (courses, assignments, lectures, memory…)
seed/               registrar course data + seed script (SE 2250B pilot)
sync/               H1: deterministic Brightspace sync engine (Python)
  auth_cli.py       Playwright + Duo auth → own token store (~/.hippocampus)
  d2l.py            D2L REST client (version discovery, bearer/cookie)
  sync.py           orchestrator: content/files/dropbox/news + AI digest
  db.py             audited SQLite upserts (content_nodes, files, …)
docs/               DESIGN.md (canonical) · DATA_MODEL.md · HANDOFF.md
data/               SQLite DB (gitignored)
school/             synced content per course (gitignored; {data_root} in prod)
shell.nix           NixOS dev shell (nixpkgs playwright + chromium)
```

## Sync usage (H1)

```bash
nix-shell                                   # NixOS-patched python + playwright
export HIPPO_USERNAME=user@example.com
export HIPPO_BRIGHTSPACE_PASSWORD=…        # or config.yaml (gitignored)
python -m sync.auth --status                # is token valid?
python -m sync.auth                         # browser login → Duo push → token
python -m sync --code "SE 2250B"            # pilot sync (or --dry-run first)
```

Sync is always on-demand (Duo 2FA) — no background scraping. AI/AI-mutations
are audited (`audit_log`). Course content never enters git.

## Seed

```bash
nix-shell --run "python seed/seed.py --reset"   # needs sqlite-capable python
```
