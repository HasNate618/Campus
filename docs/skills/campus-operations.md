# Campus — Operations (sync / auth / deploy / verify)

Operational knowledge for the Campus project (repo `~/campus`, public on
GitHub as `HasNate618/campus`). Consolidates the `campus` and
`campus-school-harness` skill bodies; full verbatim originals in
[archive/](archive/), deep dives in [references/](references/).

## Where things live

| What | Path |
|------|------|
| Repo | `~/campus` (git, branch `main`); **public GitHub** `git@github.com:HasNate618/campus.git` (repo named **Campus, capital C** — remote URL must match; SSH key works as HasNate618; `gh` CLI NOT installed) |
| Runtime data (prod) | `/srv/homelab/school/{term}/{code}/…` |
| SQLite DB | `data/harness.db` (gitignored) |
| Config | `~/campus/config.yaml` (gitignored, chmod 600; copy of config.example.yaml) |
| Token | `~/.campus/token.json` plaintext chmod 600 — **but see the `~/.hippocampus` caveat below** |
| Session cookies | `~/.campus/cookies.json` (d2l* browser cookies captured at auth; the content proxy needs them) |
| Browser profile | `~/.campus/browser-data/` (Playwright SSO cookies) — **campus-web-ui skill verified auth actually writes `/home/nate/.hippocampus/`; renaming breaks Duo auth state** |
| Brightspace MCP (reference only) | `/var/lib/brightspace-mcp` — patterns for auth/client, NOT a runtime dependency |

> **Token path caveat:** the `campus` skill says `~/.campus/`, but the
> `campus-web-ui` skill verified (2026-08-03) that auth writes
> `/home/nate/.hippocampus/token.json` — the `~/.hippocampus` path is the
> truth (renaming it breaks Duo auth state). Both paths appear in the source
> skills; verify with `python -m sync auth --status` before assuming.

## Commands (always via nix-shell)

```bash
cd ~/campus && nix-shell
python -m sync auth --status     # token valid?
python -m sync auth              # browser login → Duo push → token (1h TTL)
python -m sync sync              # full sync (start+final ntfy ping); --code X, --dry-run, --model M
python -m sync extract           # PDF → markdown queue (keeps originals); --code X, --file P, --max-mb N
python -m sync models            # list bifrost models (136); default marked
python -m agent --one "Q" --course "SE 2250B"   # agent single question (tools visible)
python -m agent --course "SE 2250B"             # agent REPL (exit to quit)
```

Container variants:
```bash
docker exec campus python -m sync auth --status
docker exec campus python -m sync sync
docker exec campus python tools/dedupe_files.py        # dedupe URL-encoded twin rows
```

NixOS notes: `python3` lacks `_sqlite3` — use nix-shell python or
`/nix/store/…-python3-*-env/bin/python3`. Browser work needs `nix-shell`
(playwright patched for NixOS; pip-installed playwright chromium won't run —
never `playwright install chromium` on NixOS, ~300MB wasted).

## Repo layout

```
schema.sql         SQLite: courses, course_sessions, assignments, exams,
                   content_nodes, files, announcements, memory_facts, events,
                   work_links, sync_runs, audit_log (notes table DROPPED)
seed/courses.json  14 courses (2026F/2027W) + SE 2250B pilot (is_pilot=1)
sync/              sync engine: config.py, token_store.py, d2l.py, auth.py,
                   db.py, sync.py, extract.py, __main__.py (auth.py captures
                   session cookies to ~/.campus/cookies.json for images)
agent/             the model harness (the product) — see campus-harness.md
api/               FastAPI backend (Phase 3, live): routers for courses/data/
                   sync/digest/chat (SSE tool_start/tool_end/token/done),
                   services.py, SPA fallback routes, /api/proxy (session-
                   cookie image proxy), /api/assets (locally cached images)
web/               React/TS PWA (Vite) — see campus-web-ui.md
tools/             one-off ops: dedupe_files.py, backfill_linkage.py,
                   cache_images.py (local image cache)
Dockerfile         runtime image: python slim + git/rg/node + playwright/chromium
config.yaml        gitignored; HIPPO_* env vars override every URL/path
shell.nix          nixpkgs playwright (host-side auth/dev)
docs/              DESIGN.md, HANDOFF.md, DATA_MODEL.md, BUILD_PLAN.md,
                   PLAN.md, chat-v2-plan.md, skills/ (this dir)
```

## Architecture (what the AI does)

- **Sync is dumb** — fetch/diff/download/store, deterministic, never
  hallucinates. `sync/` package: `config.py` (yaml+env), `token_store.py`
  (plaintext JSON, restart-safe), `d2l.py` (D2L REST client: version
  discovery, lp/le path builders, bearer or cookie auth, token-bucket rate
  limit, 401 retry), `auth.py` (Playwright SSO), `db.py` (audited upserts),
  `sync.py` (orchestrator), `extract.py`, `__main__.py` (dispatcher — use
  `python -m sync <cmd>`, don't reference `sync.auth_cli` style names).
- **AI digest** (end of sync): reads the delta → markdown sync log + durable
  facts into `memory_facts` (source+confidence). Delta carries announcement
  BODIES (800 chars) + extracted-PDF excerpts (`digest_pdf_excerpt_chars`,
  default 2000).
- **AI agent** (built): context + tools + loop over synced data. Chat never
  calls Brightspace live — only SQLite + disk.

## Model config

- Default: `opencode-go/deepseek-v4-flash` in config.yaml `bifrost_model` —
  **Nate's explicit pick** (2026-07-31). Bifrost serves BOTH
  `opencode-go/deepseek-v4-flash` and `DeepSeek/deepseek-v4-flash` (136
  models total).
- Any model from `python -m sync models` works; `--model M` overrides per run.
- bifrost = OpenAI-compatible at `http://127.0.0.1:18081/v1` (host) or
  `http://bifrost:8080/v1` (Docker network). Verify a candidate model
  responds before wiring it in (`/v1/chat/completions` pong test).
- `deepseek-v4-flash` over-surveys open-ended questions (17 tool calls →
  fixed to 9 with `course_map` + prompt rules 9–11). Ceiling is the model's
  tool planning; next lever = stronger chat model, not more prompt tuning.

## Services (host-mapped ports when sync runs on host)

bifrost 127.0.0.1:18081 · pdf-extractor 127.0.0.1:8001 · ntfy 127.0.0.1:8085.
Use Docker hostnames (bifrost/pdf-extractor/ntfy) when containerized.

## Container deployment (Phase 1, DONE 2026-08-01)

NixOS module `modules/server/ai/campus.nix` — systemd oneshot + `docker run
-d`, house pattern. The container IS the sandbox for the AI (terminal tool
runs inside it). Key decisions, all verified live:

- **Run as the file owner's uid, not root** (`--user 1000:100`): `--cap-drop
  ALL` also strips CAP_DAC_OVERRIDE, so container root CANNOT traverse host
  dirs with 0700 perms (/home/nate) — sync/agent crashed with
  `PermissionError` reading the mounted code. This is the single gotcha that
  bit; uid-1000 is also more secure than root.
- `--network proxy` → docker hostnames: `http://bifrost:8080/v1`,
  `http://pdf-extractor:8000`, `http://ntfy:80`, `http://trawl:8000/mcp`.
  config.yaml stays host-oriented; the module passes `HIPPO_*` env overrides
  (config.py supports HIPPO_BIFROST_URL / HIPPO_PDF_EXTRACTOR_URL /
  HIPPO_NTFY_URL / HIPPO_TRAWL_URL / HIPPO_DB_PATH / HIPPO_TOKEN_DIR /
  HIPPO_MODEL / HIPPO_BASE_URL / HIPPO_DATA_ROOT).
- Volumes: `/srv/homelab/school` (rw), `/home/nate/campus:/app` (**ro** —
  code runs from the mount, no image rebuild on code changes; but see the
  web/dist shadowing pitfall), repo `data/:/app/data` (rw, DB), `~/.campus`
  (rw, token + browser profile). config.yaml is read from the ro /app mount.
- `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` in the Dockerfile — must
  come BEFORE `RUN playwright install chromium` or browsers land in root's
  ~/.cache and uid 1000 can't read them.
- Limits: `--memory 1g --cpus 1.0 --pids-limit 200 --cap-drop ALL
  --security-opt no-new-privileges`. `--restart unless-stopped`.
- CLI: `docker exec campus python -m sync|agent …` — auth (Duo) works from
  inside the container (playwright baked in; Debian base sidesteps the NixOS
  pip-playwright problem).
- Dockerfile is multi-stage (node build web/ → python runtime with
  playwright); prod CMD seeds only when the DB is missing, never runs
  pilot_data.py. Container CMD = uvicorn; published `127.0.0.1:8087:8000`.
- Caddy route `http://school.home.lab → 127.0.0.1:8087` (proxy.nix).

### Deploy flow (verified live end-to-end)

1. **web/dist MUST be built on the HOMELAB** — `nix-shell -p nodejs_22
   --run 'cd web && npm ci --no-audit && npm run build'`. The /app:ro mount
   SHADOWS the image's baked web/dist (the repo's web/ has no dist — it's
   gitignored), so FastAPI's static mount finds nothing and the UI root 404s
   while /api still works.
2. Rebuild flake from /tmp/nixos-flake-build: copy flake there, `git add`
   new files (flakes need tracked files), nix eval smoke test,
   `sudo nixos-rebuild switch --flake /tmp/nixos-flake-build#home`.
   (Or for code-only changes: `docker build -t campus:latest .` +
   `sudo systemctl restart campus`.)
3. **PROVE it**: curl 127.0.0.1:8087/api/health, curl 127.0.0.1:8087/
   (index.html), `curl -H 'Host: school.home.lab' http://127.0.0.1/` (Caddy
   path), `docker exec campus python -m sync auth --status`, and one SSE
   chat turn through 8087. UI bundle hash check:
   `curl -s http://127.0.0.1:8087/ | grep -o 'assets/index-[^"]*\.js'` —
   the hash MUST change after a rebuild, else you tested a stale bundle.

### /etc/nixos git

- /etc/nixos is its own git repo with a **ROOT-owned .git** — stage/commit
  with `sudo git …` (identity flags inline); a plain `git add` dies with
  "insufficient permission for adding an object". Remote = Forgejo
  `nixos-config.git` (private backup): `sudo git push origin HEAD`.
- The /tmp/nixos-flake-build copy is build-only; live /etc/nixos is the
  source of truth.

## GitHub (public code backup)

- Remote MUST be `git@github.com:HasNate618/campus.git` (capital C — GitHub
  redirects the lowercase guess; a wrong case fails push with "Repository
  not found" even when auth is fine).
- **Push after every commit** (`git push github main`). Repo rename
  HippoCampus → campus happened 2026-08-03; the GITHUB-side rename is a
  MANUAL web action (Settings → rename) — until done, push fails with
  "Repository not found". After any remote rename, check `git remote -v`
  BEFORE blaming credentials.
- Nate creates repos manually at github.com/new (Public, NO README checkbox —
  a README conflicts with the first push); the SSH key cannot create repos.
- Pre-push hygiene: `git ls-files` to confirm no data/*.db/config.yaml/.venv
  tracked, grep for secrets, scan docs for homelab service names. Accepted
  as public: seed/courses.json, docs mentioning bifrost/trawl/school.home.lab
  (tailnet-internal names, inert publicly).
- **Forgejo is NOT the code remote anymore** — repurposed as the FUTURE
  PRIVATE DATA backup (DB dumps + school dir), a separate job. Needs Nate's
  auth (nate@home.lab) or a token; not wired yet.
- Commit identity: `git -c user.name='Nathan Espejo' -c
  user.email='nate.e.espejo@gmail.com'` — task specs pass it inline; don't
  rely on a repo-local gitconfig existing.

## PWA installability + HTTPS (2026-08-03)

The app IS installable, but ONLY via HTTPS: **https://home.tail3b22c4.ts.net**
(Tailscale Let's Encrypt cert, Caddy TLS route, weekly renewal timer). Plain
`http://school.home.lab` can NEVER be installed (secure-context requirement).
What landed: SW (`web/public/sw.js` — /api never cached, hashed assets
cache-first, offline shell) + registration in main.tsx; PNG icons (192/512/
maskable from favicon.svg — NOT icons.svg, that's a sprite sheet) + manifest
id/scope; apple/mobile meta tags. Full recipe (cert issue, Caddy block,
renew timer, icon commands, install steps): references/pwa-https-setup.md.

## Renaming a deployed project (HippoCampus → campus, 2026-08-03)

Order: (1) mechanical code/UI/docs rename (UI copy, package.json, PWA
manifest name, SW cache VERSION bump, log/doc strings, brand file names +
imports) → build + restart + verify + commit; (2) infra: rename nix module +
systemd service + docker container, move repo dir, update mount paths — ALL
in ONE rebuild so the data-loss window is seconds; (3) GitHub remote URL last.

**The KEEP-list is the safety net — rename NEVER touches:** hostnames/URLs
(school.home.lab, the ts.net PWA host), ports, data roots
(/srv/homelab/school), token/config dirs (~/.hippocampus — renaming breaks
Duo auth state), provider model ids (bifrost model strings are NOT branding),
git identity, other services. Grep-verify after: leftover brand strings in
code are OK; leftover REAL PATHS in the keep-list are OK — don't "fix" them.
Skills/memory follow the rename (paths, `docker exec campus`,
`systemctl restart campus`) — rename the CONTENT, not the skill dirs.

## Phase status (through 2026-08-04)

- H0+H1 done: pilot SE 2250B synced (42 content nodes, 27 files, 24
  announcements, 20 assignments); digest validated (facts + sync log via
  opencode-go/deepseek-v4-flash).
- Phase 0 done: agent harness, memory card, extraction detached, notes→files
  migration, whole-sync ntfy, trawl web tools, loop 22/24.
- Phase 1 done: container deployed + verified (above).
- Phase 2 done (a30d7fd): `terminal_run` tool — runs INSIDE the container
  (blocklist: sudo/su/docker/podman/nixos-rebuild/systemctl/journalctl/
  shutdown/reboot/mkfs/dd/chmod/chown/kill, `rm -rf /`, `.campus` token
  paths, `config.yaml`, `python -m sync auth`; content/ write-guard; workdir
  bounded to data_root; timeouts; 10KB cap; audited).
- Phase 3 done + LIVE (2026-08-03): frontend merged (one repo, history
  preserved); real API in container (uvicorn CMD, 127.0.0.1:8087:8000,
  school.home.lab serves UI + chat); chat = SSE over run_turn (multi-turn
  via per-course reasoning-content cache); sync fast-path; extraction
  detached; images cached locally; pdf.js viewer + zen markdown + 3-tab
  mobile nav.
- Phase 4–5: OneDrive rclone one-way mirror, lecture recordings. `term_dates`
  still needed from Nate (2026F/2027W start dates) for class events.

## Ops pitfalls (hard-won)

- **Hung process → faulthandler.dump_traceback_later** — don't theorize for
  hours; dump the stack. Recipe: references/debugging-stuck-processes.md.
- **Extraction MUST be a detached process, never inline** (2026-08-02): the
  H1 inline loop made sync look STUCK for 10 min × N PDFs. NOW: sync spawns
  `python -m sync extract` via subprocess.Popen(start_new_session=True,
  stdout→sync_logs/extraction.log) AFTER the digest; extract CLI pings ntfy
  once when done. A daemon thread is NOT enough — it dies with the CLI.
  `--file` wants an ABSOLUTE path under data_root (relative dies with "not
  in the subpath of '/srv/homelab/school'").
- **PDF engine: local is DEFAULT again (2026-08-03 reversal)** — pdf-extractor
  runs `PDF_ENGINE=local` (PP-OCRv6 CPU OCR, ~27s/page; big books = overnight
  jobs; cloud VLM was ~3s/page but costs API credits). Nate reverses engine
  decisions — check the live container (`docker inspect pdf-extractor
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PDF_ENGINE`)
  before assuming. Per-request override: `PUT /process?engine=auto|local|cloud`.
  Originals always kept beside the .md.
- **extract_pdf PUT timeout SCALES BY FILE SIZE** (3600s for >2MB, else
  120s). The old fixed 120s timed out the 148-page e-book; the worker DROPS
  the in-flight job when the requester disconnects (no recovery via
  /api/jobs — re-PUT with a long timeout instead). The worker also
  self-wedges on its 148-page demo file at startup — check `/api/jobs`.
- **PDF extraction stalls (two workers):** pdf-extractor (VLM wrapper) and
  pdf-ocr (local PP-OCRv6, nvidia libs) BOTH expose `PUT /process`. Isolate:
  curl the PUT from host AND container, check worker docker logs, check
  nvidia-smi; jobs live in /var/lib/pdf-extractor and /var/lib/pdf-ocr.
  When both hang for everyone, it's homelab infra, not campus.
- **Host crashes corrupt git mid-write** — recovery: anchor on last valid
  commit in `.git/logs/HEAD` (reflog FILE survives; NUL bytes = crashed
  write), delete empty objects, repoint refs/heads/main, `rm -f .git/index
  && git add -A`, re-commit. Full procedure: nixos-homelab-workflow skill →
  "Git Object Corruption Recovery". Prevention: the GitHub remote.
- **config.yaml password gets clobbered on rewrite** — happened TWICE when
  regenerating config.yaml (placeholder `password: PLACEHOLDER`). Restore
  from `/var/lib/brightspace-mcp-config/config.json` (sudo) and verify with
  `python -m sync auth --status` after any config.yaml write. Keep the
  placeholder in config.example.yaml; never write real secrets into it.
- **config.yaml `~` and Path coercion** — YAML values stay strings and `~`
  isn't expanded. `Config.load()` must str→Path→expanduser. A token written
  to `~/campus/~/.campus/` is the failure mode (looks fine, wrong place).
- **Config() ≠ Config.load()** — bare `Config()` returns DEFAULTS only
  (e.g. pdf_extractor_url = 127.0.0.1:8001 — nothing listens there in the
  container); `Config.load()` applies config.yaml + CAMPUS_* env overrides
  (the deployed http://pdf-extractor:8000).
- **Auth CLI saves token only on full success** — verify
  `~/.campus/token.json` mtime after auth; a killed/starved run loses it.
- **ON CONFLICT needs a real constraint** — announcements upsert uses
  `ON CONFLICT(brightspace_id)`; table needs a UNIQUE index. Partial unique
  indexes need the WHERE clause repeated in the conflict target — use a
  non-partial index.
- **`ON CONFLICT DO UPDATE` + rowcount lies** — rowcount is 1 for BOTH
  insert and conflict-update, so is_new was always True → `announcements_new:
  24` every sync, digest re-processed forever. Fix: select-first. Any upsert
  whose is_new derives from rowcount/lastrowid on a DO UPDATE is broken.
- **Pipes mask exit codes** — `nix-shell --run 'python x.py' | tail -5`:
  pipeline exit status is the LAST command (tail → 0), so `&&` chains
  continue even when x.py crashed (this cost a table — DROP TABLE notes ran
  before the export completed). Check PIPESTATUS or run separately.
- **Mutable defaults in dataclasses:** `term_dates: dict = {}` →
  `ValueError: mutable default ... use default_factory` — use
  `field(default_factory=dict)`.
- **Dockerfile `&& … || true` swallows pip failures** — pip install in its
  own RUN without the escape hatch; `|| true` only on genuinely-optional
  steps. Prefer explicit single-source COPYs over multi-source `COPY a b ./`
  (silently missed api/requirements.txt once).
- **Brightspace enforced-content URLs need the browser SESSION, not the API
  token** — `/content/enforced/<orgUnit>-<code>/…` with the Bearer token
  returns the app shell HTML (200) or redirect to /d2l/login (302). The
  token only authorizes `/d2l/api/*`. Fix (43d81ab): auth.py captures
  session cookies into ~/.campus/cookies.json; `/api/proxy?url=…` sends them
  as the Cookie header (host allowlist: westernu.brightspace.com +
  s.brightspace.com; redirect-to-login → 502 "session expired — run auth").
  Re-auth is SILENT when the persisted playwright profile still has a live
  session (no Duo push). Full story: references/content-auth-proxy.md.
- **URL-encoded filename twins cause duplicate file rows + mislinks** — fix
  `tools/dedupe_files.py` (deletes encoded rows with a decoded twin of the
  same sha256; run via `docker exec campus python tools/dedupe_files.py`).
  SQLite footgun: `LIKE '%\%%'` doesn't match literal % without an ESCAPE
  clause — use `instr(path, '%') > 0`.
- **Sync topic→file linkage (content_node_id) was NULL for all files** —
  fixed in `_download_topic_file` (look up content_nodes by brightspace_id,
  upsert COALESCEs on re-sync) + `tools/backfill_linkage.py`. New syncs SKIP
  downloading when the topic already has a linked file on disk — why syncs
  went from minutes to seconds.
- **Brightspace descriptions are `{Text, Html}` — store the HTML.** Using
  `Description.Text` FLATTENS the course-schedule table, module banner
  images, and embedded hyperlinks. Prefer `obj.get("Html") or
  obj.get("Text")` (sync/sync.py). Related: unit banner images live inside
  the "Unit Introduction" TOPIC, not the module page; the course hub
  endpoint hard-limits announcements `LIMIT 10` (a "cut off at date X"
  report is usually the limit, not missing data — the standalone endpoint
  supports limit up to 100).
- **schema.sql changes DON'T retro-apply to the live DB** — CREATE TABLE IF
  NOT EXISTS never adds tables that appeared AFTER the live DB was created
  (chat tables were missing for days, silently). After any schema.sql edit:
  `docker exec campus python -c "import sqlite3; c=sqlite3.connect('data/harness.db'); c.executescript(open('schema.sql').read()); c.commit()"`
  (all IF NOT EXISTS, idempotent). Verify with `PRAGMA table_info(<table>)`.
- **Orphaned uvicorn/docker-exec children hold ports** — kill the real PID
  (`ss -tlnp | grep <port>`), or you test stale code forever. `process kill`
  on the host-side wrapper can orphan the container process — kill by
  container pid. Slim image: no ps/pkill/kill/ss — scan `/proc/[0-9]*`,
  `os.kill(PID, 9)` via `docker exec campus python -c ...`; match on
  `$p/comm` (python3), NOT on cmdline strings you typed (your own shell
  matches the pattern — bit twice). Sync CLI output is block-buffered when
  redirected — an EMPTY log ≠ hung process; DB progress is ground truth; use
  `python -u`.
- **Test API changes with a throwaway uvicorn INSIDE the container** —
  `docker exec -d campus sh -c 'cd /app && uvicorn api.main:app --host
  127.0.0.1 --port 8091'` → `docker exec campus curl -s
  http://127.0.0.1:8091/...`. The container python has ALL deps — the
  reliable test interpreter even when the host .venv is broken (its symlink
  points at a GC'd nix store path). ro /app mount serves host edits live.
- **New FastAPI endpoints that `raise HTTPException` need the import** —
  session CRUD endpoints 500'd on missing rows (HTTPException never
  imported). TEST the missing-row path (PUT/DELETE a nonexistent id —
  expect 404, not 500).
- **A ro /app mount shadows the image's baked artifacts** — anything
  gitignored in the mounted repo (web/dist) vanishes at runtime.
- **Digest model output must be coerced** — models invent categories outside
  the `memory_facts` CHECK constraint; coerce unknown → 'general', never
  crash the run. Parse strict JSON by slicing between first `{` and last `}`.
- **Verification pattern:** bifrost doesn't log requests — to prove the AI
  ran, point at downstream effects (e.g. a CHECK-constraint error from the
  model's parsed output). Nate asked "did you actually run the ai? if so
  what model?".
- **An approval-denied command isn't a policy statement** — the denial
  usually means he was away or reviewing, not that the operation is
  forbidden. Stop, report, let him re-approve; don't treat it as a ban.
- **Honor "stop X" immediately** — kill the job AND anything sharing the
  resource (the sync's extraction queue would have started right after a
  backfill died), report exact state, wait for new instructions.

## Working with Nate (ops-relevant)

- Commit as you go AND push after each working increment — keep the tree
  clean at the end of each work chunk, not one big commit.
- Check git status first — external agents edit the repo; verify state,
  don't assume. When a parallel agent owns api/ + sync/, stage ONLY your
  scope (`git add web`) — `git add -A` sweeps their uncommitted work.
- Design-first: discuss structure/workflow/priorities BEFORE
  stack/scaffolding. Major features get a written technical plan committed to
  docs/ FIRST ("plan this out technically first"), then he says "start".
- Explain on request; implement on explicit "start"/"go". "dont implement
  anything yet just plan" is a hard planning-only signal.
- Answer design questions head-on with an opinion; when he asks "give me all
  options", enumerate the FULL option set with tradeoffs AND state a
  recommendation — he decides, but wants the complete menu first.
- **When Nate pastes an AI conversation summary for review, verify its
  claims against the live system before agreeing** (2026-08-04): a summary's
  "rubric criteria not in my data" was false at the DB layer (only the tool
  hid them); its "whoami fails" was false (present). He wants grounded
  opinions — he'll ask "are you absolutely sure?" if you overclaim. Answer
  with verified state, rank gaps by actual pain, plan — never implement in
  the review turn.
