# Campus repo — fresh-developer setup audit (2026-08-04)

Full audit of `~/campus` for setup-friendliness: README, config template,
setup docs, Docker/NixOS assumptions, missing pieces. Findings only; no
files changed. Re-verify before acting — repo state moves fast.

## Repo facts

- Branch is `main` (not master). 118 tracked files.
- Git remotes: `github` = `git@github.com:HasNate618/campus.git` (public);
  `frontend` = `ssh://nate@100.77.172.11/home/nate/Projects/HippoCampus`
  (same host over Tailscale — that's where any "HippoCampus" workspace path
  comes from). No private Forgejo remote yet (HANDOFF H0 item still open).
- `web/dist` built at Docker build time / `npm run build`; NOT tracked.
- Live repo has a `data/harness.db` (gitignored) and a stray literal `~`
  directory at the root containing an empty `~/.hippocampus/` — untracked,
  unignored artifact; never commit.

## Bootstrap order that actually works (fresh clone)

1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r api/requirements.txt`
2. `cd web && npm ci`
3. `cp config.example.yaml config.yaml` (chmod 600); username in YAML,
   password via env `CAMPUS_BRIGHTSPACE_PASSWORD` — NOT in the file.
4. `python3 seed/seed.py --reset` — **required**. Applies schema.sql via
   executescript + seeds courses/sessions. Neither `sync/db.py` nor
   `api/db.py` creates tables; `python -m sync sync` on an unseeded DB
   dies with "no such table". `api/db.py ensure_wal()` only sets WAL mode.
5. Playwright browsers: `nix-shell` (nixpkgs-patched playwright, sets
   PLAYWRIGHT_BROWSERS_PATH) on NixOS, else `playwright install chromium`.
6. `python -m sync auth` → Duo push; token at `~/.hippocampus/token.json`
   (plaintext JSON, chmod 600, TTL 3600s + 300s refresh buffer, cookie
   fallback, persisted browser profile for silent re-auth).

## Container / NixOS assumptions (deployment glue is OUT of the repo)

- Dockerfile (multi-stage node:22-alpine → python:3.12-slim w/ playwright
  chromium, antiword, ripgrep): CMD seeds DB only if `$CAMPUS_DB` missing.
  **config.yaml is NOT COPYed into the image** → standalone `docker run`
  runs on defaults: `data_root=/srv/homelab/school` and service URLs
  `127.0.0.1:18081/8001/8085/11236` resolve to the container itself →
  sync/extract/digest/chat all broken without env vars.
- The real deployment is `/etc/nixos/modules/server/ai/campus.nix` (NOT in
  repo): `--network proxy`, `--user 1000:100`, `HOME=/home/nate`,
  `--cap-drop ALL --security-opt no-new-privileges`, `--memory 1g --cpus 1
  --pids-limit 200`, `-p 127.0.0.1:8087:8000`; mounts
  `/srv/homelab/school:rw`, `/home/nate/campus:/app:ro` (code bind-mount →
  no image rebuild on code changes), `/home/nate/campus/data:/app/data:rw`,
  `/home/nate/.hippocampus:/home/nate/.hippocampus:rw`; env
  `CAMPUS_BIFROST_URL=http://bifrost:8080/v1`,
  `CAMPUS_PDF_EXTRACTOR_URL=http://pdf-extractor:8000`,
  `CAMPUS_NTFY_URL=http://ntfy:80`, `CAMPUS_TRAWL_URL=http://trawl:8000/mcp`,
  `CAMPUS_DATA_ROOT`, `CAMPUS_TOKEN_DIR`.
- Caddy `school.home.lab` → 127.0.0.1:8087 lives in proxy.nix; SSE route
  needs `flush_interval -1` or Caddy buffers the whole stream
  (docs/chat-v2-plan.md documents the fix).
- `.dockerignore` excludes `docs/` → docs not in the image. No `USER`
  directive in the image; uid-1000 requirement (CAP_DAC_OVERRIDE stripped)
  comes from the NixOS module.

## Secret / config hygiene

- ⚠️ Live `config.yaml` (as of 2026-08-04) contains the Brightspace
  password in **plaintext** — contradicts `sync/config.py` docstring
  ("never config file") and config.example.yaml. Gitignored (no git leak),
  still a hygiene gap. When touching the repo, don't propagate this pattern.
- `.gitignore` lists `.env` but **no code loads it** (no python-dotenv in
  requirements; config precedence: defaults < config.yaml < exported
  `CAMPUS_*` env vars, per sync/config.py docstring).
- Stray literal `~` directory at repo root (contains empty
  `~/.hippocampus/`) — untracked, unignored artifact of an old
  relative-`~` resolution. Harmless; never commit.

## Schema evolution

- No migration system. schema.sql is hand-edited; one-off scripts in
  `tools/` do the dirty work (migrate_notes.py, backfill_linkage.py,
  dedupe_files.py, digest_backfill.py). The only "apply schema" paths are
  `seed/seed.py` (always) and the Docker CMD (when DB missing).

## Docs state

- No SETUP/INSTALL doc anywhere. README.md (57 lines) documents how it runs
  on the homelab (layout, dev commands, prod container), not how to set up
  from scratch. docs/ = DESIGN, HANDOFF (implementer brief assuming
  `ssh home` + sops-nix + Forgejo), BUILD_PLAN, PLAN (superseded),
  DATA_MODEL, chat-v2-plan (work plan). `web/README.md` is untouched Vite
  template boilerplate.
- Auth (`sync/auth.py`) is Western-UWO-locked: campus-selector
  `data-onclick`, Microsoft Entra form fill, Duo MFA. Not generalizable.
- CLI surface well self-documented in `sync/__main__.py` docstring:
  auth / sync / extract / models.
