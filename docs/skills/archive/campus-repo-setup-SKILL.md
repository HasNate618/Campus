# Archived original skill body — consolidated into campus-setup.md
# Source: Hermes homelab profile skill `campus-repo-setup`, archived 2026-08-04


# Campus — Fresh-Clone Setup & Bootstrap

Companion to the `campus` / `campus-school-harness` / `campus-web-ui` skills.
This one covers the onboarding path the repo itself does NOT document — the
2026-08-04 setup-friendliness audit found no SETUP/INSTALL doc and a README
that assumes the homelab already exists. Full audit detail:
`references/setup-friendliness.md`.

## Bootstrap order that works (fresh clone)

1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt`
2. `cd web && npm ci`
3. `cp config.example.yaml config.yaml` (chmod 600). Username in YAML;
   **password via env `CAMPUS_BRIGHTSPACE_PASSWORD`, never in the file**
   (see Secrets hygiene).
4. `python3 seed/seed.py --reset` — **seed BEFORE sync, always.**
   schema.sql is applied ONLY by `seed/seed.py` (executescript) or the
   Docker CMD (only when the DB is missing). `sync/db.py` and `api/db.py`
   just connect — they never create tables, so a fresh
   `python -m sync sync` dies with "no such table". This is THE classic
   fresh-dev stumble; it cost real time in the audit.
5. Playwright browsers: on NixOS use `nix-shell` (nixpkgs-patched
   playwright, sets PLAYWRIGHT_BROWSERS_PATH); elsewhere
   `playwright install chromium`.
6. `python -m sync auth` → interactive Duo push → token persisted at
   `~/.hippocampus/token.json` (plaintext JSON, chmod 600, TTL 3600s +
   300s buffer, cookie fallback, persisted browser profile for silent
   re-auth within cookie lifetime).

## Container / NixOS env contract

- The Dockerfile does NOT COPY config.yaml (gitignored) → a standalone
  `docker run` gets the web app on defaults but sync/extract/digest/chat
  are broken: `data_root=/srv/homelab/school` won't exist and service URLs
  default to `127.0.0.1:*` = the container itself.
- The real deployment lives OUT of the repo:
  `/etc/nixos/modules/server/ai/campus.nix` — `--network proxy`,
  `--user 1000:100`, `HOME=/home/nate`, cap-drop ALL, no-new-privileges,
  1g/1cpu/200 pids, `-p 127.0.0.1:8087:8000`; mounts
  `/srv/homelab/school:rw`, `/home/nate/campus:/app:ro` (code bind-mount →
  no image rebuild on code changes), `/home/nate/campus/data:/app/data:rw`,
  `/home/nate/.hippocampus:/home/nate/.hippocampus:rw`; env
  `CAMPUS_BIFROST_URL=http://bifrost:8080/v1`,
  `CAMPUS_PDF_EXTRACTOR_URL=http://pdf-extractor:8000`,
  `CAMPUS_NTFY_URL=http://ntfy:80`, `CAMPUS_TRAWL_URL=http://trawl:8000/mcp`,
  plus `CAMPUS_DATA_ROOT` / `CAMPUS_TOKEN_DIR`.
- Caddy `school.home.lab` → 127.0.0.1:8087 lives in proxy.nix; the SSE
  chat route needs `flush_interval -1` or Caddy buffers the whole stream.
- `.dockerignore` excludes `docs/` → docs never reach the image.

## Secrets hygiene

- ⚠️ The live `config.yaml` (as of 2026-08-04) contains the Brightspace
  password in PLAINTEXT, contradicting `sync/config.py`'s documented
  env-only policy. Gitignored (no git leak), but don't propagate the
  pattern; keep passwords in env.
- `.gitignore` lists `.env` but **nothing loads it** (no python-dotenv
  dependency). Secrets must be exported `CAMPUS_*` env vars.
- Stray literal `~` directory at repo root (empty `~/.hippocampus/`) —
  untracked, unignored artifact of old relative-`~` resolution. Harmless,
  never commit.

## Schema evolution (no migrations)

No migration system. schema.sql is hand-edited; one-off scripts in
`tools/` do the dirty work (migrate_notes.py, backfill_linkage.py,
dedupe_files.py, digest_backfill.py). The only "apply schema" paths are
`seed/seed.py` (always) and the Docker CMD (when DB missing).

## Verification

- `python3 seed/seed.py --reset` then `python -m sync sync --dry-run`
  (enrollments+match only; full sync needs valid auth + bifrost).
- `curl -s localhost:8000/api/health` → `{"status":"ok","db":true}`.

## Pitfalls

- Unseeded DB → "no such table" from sync/API (bootstrap step 4).
- Standalone container with default config → silent service-URL failures.
- Plaintext password in config.yaml — env var only.
- `.env` file is decorative — code never reads it.
