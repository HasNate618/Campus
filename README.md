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
python -m sync auth --status                # is token valid?
python -m sync auth                         # browser login → Duo push → token
python -m sync models                       # list models served by bifrost
python -m sync sync --code "SE 2250B"       # pilot sync (or --dry-run first)
python -m sync sync --model M               # override digest model per-run
python -m sync extract --file <path>        # PDF → markdown (keeps original)
python -m sync extract --code "SE 2250B"    # extract all PDFs for a course
```

Sync is always on-demand (Duo 2FA) — no background scraping. Digest model is
configurable (`bifrost_model` in config.yaml, default opencode-go/deepseek-v4-flash).
PDF extraction is on-demand until pdf-extractor gains a local mode
(`auto_extract_pdfs: true` flips it on after sync). AI/AI-mutations are
audited (`audit_log`). Course content never enters git.

## Seed

```bash
nix-shell --run "python seed/seed.py --reset"   # needs sqlite-capable python
```
