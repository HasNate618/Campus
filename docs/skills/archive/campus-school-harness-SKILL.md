# Archived original skill body — consolidated into campus-operations.md / campus-harness.md
# Source: Hermes homelab profile skill `campus-school-harness` (homelab/hippocampus-school-harness), archived 2026-08-04


# Campus (school AI harness)

Personal AI study/org system for Nate's Western SE degree. The AI is an agent
over stores (SQLite structured facts + files on disk), NOT a context dump.
All AI mutations are audited (`audit_log`); course content never goes in git.

## Repo & remote

- **Repo:** `/home/nate/campus` on `home` (10.0.0.45). Renamed from
  `school-harness` (2026-07-31). Git `main`.
- **Remote:** PUBLIC GitHub `git@github.com:HasNate618/campus.git`
  (repo is named Campus with capital C — remote URL must match).
  Push after every commit (`git push github main`) — a local-only repo is one
  crash away from history loss (git-corruption recovery: nixos-homelab-workflow
  skill).
- **Docs:** `docs/DESIGN.md` + `docs/HANDOFF.md` canonical; `docs/BUILD_PLAN.md`
  = the build plan (phases 0-5, locked decisions table). The planning agent
  (Cursor) may edit docs/ externally — check git status before assuming state.
- **Forgejo** is reserved for private DATA backup (DB dumps) later, not the
  code. Auth: `nate@home.lab` or a token (write:repository).

## Layout

```
schema.sql         SQLite: courses, course_sessions, assignments, exams,
                   content_nodes, files, announcements, memory_facts,
                   events, work_links, sync_runs, audit_log (notes table DROPPED)
seed/courses.json  14 courses (2026F/2027W) + SE 2250B pilot (is_pilot=1)
sync/              sync engine: config.py, token_store.py, d2l.py, auth.py,
                   db.py, sync.py, extract.py, __main__.py (auth.py captures
                   session cookies to ~/.campus/cookies.json for images)
agent/             the model harness (the product):
  context.py       system prompt builder: time, term, course scope, memory
                   card, upcoming events (classes computed from sessions)
  tools.py         12 tools: harness_* reads, content_* file access (read w/
                   offset/limit pagination, grep w/ snippets), mutate_* audited
                   writes, file_write (audited, content/ read-only), web tools
  chat.py          tool-calling loop: nudge at 22, hard stop at 24; streaming
                   (token emit), reasoning_content passback for thinking mode
  mcp.py           minimal MCP streamable-HTTP client (trawl)
  memory.py        memory card generator + supersede pass (term/recency)
api/               FastAPI backend (Phase 3, live): routers for courses/data/
                   sync/digest/chat (SSE tool_start/tool_end/token/done),
                   services.py, SPA fallback routes, /api/proxy (session-
                   cookie image proxy), /api/assets (locally cached images)
web/               React/TS PWA (Vite): 3-tab mobile nav (Home/Courses/Chat),
                   single-panel content view, pdf.js viewer, zen markdown
                   (marked+highlight.js), collapsible course tree
tools/             one-off ops: dedupe_files.py (URL-encoded dup rows),
                   backfill_linkage.py, cache_images.py (local image cache)
Dockerfile         runtime image: python slim + git/rg/node + playwright/chromium
config.yaml        gitignored; HIPPO_* env vars override every URL/path
shell.nix          nixpkgs playwright (host-side auth/dev; pip playwright fails on NixOS)
```

## Current state (2026-08-03)

- **H0+H1 done:** pilot SE 2250B synced (42 content nodes, 27 files, 24
  announcements, 20 assignments); digest validated (facts + sync log via
  bifrost `opencode-go/deepseek-v4-flash`).
- **Phase 0 done:** agent harness (above), memory card, extraction cloud-only,
  notes→files migration, whole-sync ntfy (start ping + final breakdown),
  trawl web tools, loop 22/24. Commits: 4d62b1d (Phase 0), 437291d (memory
  hygiene), 3f5e71c (container files).
- **Phase 1 container deployed + verified:** `campus` on proxy network (NixOS
  module `modules/server/ai/campus.nix`), runs as `--user 1000:100`, cap-drop ALL,
  mounts: /srv/homelab/school (rw), /home/nate/campus:/app (ro code
  mount — no rebuild on code changes), data/ (rw DB), ~/.campus (token).
  WHY uid 1000: cap-drop ALL strips CAP_DAC_OVERRIDE, so container root can't
  traverse 700-permission /home/nate — see nixos-docker-service-pattern.
- **Phase 2 DONE (a30d7fd, verified):** `terminal_run` tool — runs INSIDE the
  container (the jail), blocklist (sudo/su/docker/podman/nixos-rebuild/
  systemctl/journalctl/shutdown/reboot/mkfs/dd/chmod/chown/kill, `rm -rf /`,
  `.campus` token paths, `config.yaml`, `python -m sync auth`), content/
  write-guard, workdir bounded to data_root, timeouts, 10KB cap, audited.
- **Phase 3 DONE + LIVE (2026-08-03):** frontend merged (one repo, history
  preserved); real API in the container (uvicorn CMD, `127.0.0.1:8087:8000`
  published, `school.home.lab` serves UI + chat). Chat = SSE over run_turn
  (tool_start/tool_end/token/done), multi-turn works via per-course
  reasoning-content cache. Sync is FAST now (fast-path skips downloads for
  linked topics; extraction runs as a DETACHED process; announcements_new
  stats fixed). Files 42/42 linked to topics. Images cached locally
  (`_assets/` + /api/assets), pdf.js viewer, zen markdown, single-panel
  content tree, 3-tab mobile nav. Assignment descriptions populate on the
  next sync (CustomInstructions.Html).
- **Phase 4-5:** OneDrive rclone one-way mirror, lecture recordings. `term_dates`
  still needed from Nate (2026F/2027W start dates) for class events.

## Pitfalls (hard-won, 2026-08-03)

Full detail + fixes in `references/phase3-backend-debugging.md`. Top ones:

- **Hung process → faulthandler.dump_traceback_later** — don't theorize for
  hours; dump the stack (see reference for the exact runpy wrapper).
- **DeepSeek thinking mode**: every follow-up call needs the assistant's
  `reasoning_content` passed back (400 otherwise); rebuilt streamed messages
  need `"role"` too.
- **SSE is CRLF from sse-starlette** — split on `/\r?\n\r?\n/`, never `'\n\n'`.
- **`crypto.randomUUID` is undefined on plain HTTP** (LAN apps) — v4 fallback.
- **Dockerfile**: `|| true` swallows pip failures; multi-source COPY is flaky;
  `ENV PLAYWRIGHT_BROWSERS_PATH` must precede the playwright install RUN.
- **Orphaned uvicorn/docker-exec children hold ports** — kill the real PID
  (`ss -tlnp`), or you test stale code forever.
- **`ON CONFLICT DO UPDATE` + rowcount says 1 for updates** — select-first for
  is_new; SQLite LIKE has no default escape (`instr()` instead).
- **Brightspace `/content/enforced/...` needs the session cookie**, not the
  Bearer token — auth.py captures cookies.json; proxy/sync use it.
- **URL-encoded filenames → duplicate rows + mislinks** — dedupe tool
  (`tools/dedupe_files.py`); verify topic→file linkage after syncs.
- **Background jobs = detached subprocess** (start_new_session), not daemon
  threads (die with the CLI).
- **Brightspace descriptions are `{Text, Html}` — store the HTML.** The
  sync used `Description.Text`, which FLATTENS the course-schedule table,
  module banner images, and embedded hyperlinks (e.g. the "Git and Unity"
  tutorial link) — they exist only in `.Html`. Prefer
  `obj.get("Html") or obj.get("Text")` (sync/sync.py). Related: unit banner
  images live inside the "Unit Introduction" TOPIC, not the module page —
  the UI renders the intro inline on module pages. And the course hub
  endpoint hard-limits announcements `LIMIT 10` — a "cut off at date X"
  report is usually the limit, not missing data.
- **The consumer said data is missing? Check the READ PATH before the data
  (2026-08-04).** The full rubric criteria lived in `assignments.rubrics_json`
  all along — the tool only surfaced names, so both the harness AI and I
  declared them absent; only a mutation echo leaked them. Same pattern with
  memory_facts: 23 rows existed but `is_active=0` → "empty store". When any
  consumer reports missing data, diff what the tool returns vs what the DB
  holds before concluding a data gap.
- **Tool-surface bugs found by the harness AI's own 21-call audit (2026-08-04):**
  `due_within_days` had no lower bound (returned every dated assignment ever —
  needs `>= datetime('now')` AND `<= now+N`); fuzzy title matching on mutate is
  a hazard with duplicate dropbox titles (id-required now); unknown course
  should raise, not silently return `[]`; long raw-JSON payloads get truncated
  by the context window — return compact structured text instead (rubric_detail
  builds criteria/levels/points lines); a unified `state` field
  (open/closed/overdue/submitted/graded) resolves the status-vs-closed
  conflict; `harness_sync_delta` answers "what changed since last sync".
 - **Re-test round (2026-08-04) — proving filter tools + the stale-claim trap:**
 To PROVE a SQL-filtered tool's positive case when live data has no in-range
 fixture, insert a synthetic row inside a transaction and roll it back
 (INSERT → run the tool → assert found/excluded → DELETE). Settled
 `due_within_days` both directions (found at 30d, excluded at 2d) with zero
 pollution. Also: a consumer's "still broken" claim can be STALE — the
 harness AI's byte-scan complaint about the .doc contracts was written
 before the antiword round landed; re-run the exact probe before believing
 it. Fixed in this round: announcement bodies are now HTML-stripped in
 `harness_get_announcements` (they're the richest corpus source and arrived
 as raw `<p>`/`&#160;`/`\r\n`); beyond-EOF paging says "offset 9000 is past
 the end — file has 2 lines" instead of "lines 9000-9000 of 2".
 - **Memory-card mechanics (verified 2026-08-04) — how fresh is the AI's
 memory?** The card is read FRESH on EVERY turn (context.py reads
 `{course}/memory-card.md`, capped at 3000 chars, at context-build time —
 not once per session), so a sync that regenerates the card is visible on the
 very next message. The card only regenerates when the sync found deltas
 ("nothing new" syncs leave it untouched — correct, not a bug). Two standing
 blind spots: (1) the digest's announcement window is 14 days, so OLD but
 important announcements (extensions, bonus rules, grace periods) never
 become facts — they're queryable via `harness_get_announcements(days=365)`
 but absent from standing memory; widening the window is a design choice
 (card grows, supersede pass prunes). (2) The per-turn "upcoming events (next 7 days)" block reads assignments'
 due_at, exams, AND the events table (verified 2026-08-04 with a synthetic
 in-range due — it appeared correctly) — so "what's due this week" works from
 assignment data alone with NO term_dates. It only says "(none)" because the
 pilot's due dates are all past and the events table is empty; class/lab
 meetings still need `term_dates`. The AI has assignment deadline awareness,
 but not class-meeting awareness.
 with 1-2 syncs/day the pipeline is responsive; the remaining gaps are the
 calendar (below) and the announcement backlog — which is now SOLVED by the
 backfill (see next bullet).
 - **Announcement backlog backfill (b35c25f, 2026-08-04) — one-time digest
 pattern.** Announcements carry a `digested_at` marker: new ones are marked
 at sync time (they ride the delta digest), and every digest run ALSO ingests
 undigested historical announcements (config `digest_announcement_days`,
 default 365, max 25, HTML-stripped) so extensions/policies/bonus rules land
 in memory_facts exactly once, then get marked — self-limiting, no duplicate
 facts. This is the reusable "digested_at one-time backfill" pattern: mark
 each source row consumed after a successful pass so the backfill runs once
 and stays quiet. Verified: a "nothing new" sync consumed all 24 backlog
 announcements and the digest correctly stored ZERO facts (model judged every
 relevance window passed for the finished pilot — its reasoning is in the
 sync log; correct behavior, not a bug). The digest RUNS even with no deltas
 when an undigested backlog exists. Note the 90-day default initially
 excluded the pilot's Jan-Apr announcements — for finished terms the window
 must reach the whole course.
- **.doc attachments: antiword.** Container image has antiword; sync/extract.py
  `_extract_doc` writes a `.md` sibling that content_read_file auto-falls-back
  to (no more hand-rolled byte-scans). After adding a new extractor,
  already-skipped rows need `UPDATE files SET processed=0` to re-queue — the
  queue only visits processed=0 rows. `processed=1` means "attempted", not
  "text exists" — document that to the model.
- **D2L dropbox metadata map** (what the folders actually carry + the
  whoami-str-vs-int pitfall + instructor-only ceilings):
  `references/d2l-dropbox-metadata.md`.
- **Config() ≠ Config.load() (2026-08-04).** `Config()` bare returns DEFAULTS
  only (e.g. pdf_extractor_url = 127.0.0.1:8001 — nothing listens there in the
  container); `Config.load()` applies config.yaml + CAMPUS_* env overrides
  (the deployed http://pdf-extractor:8000). When debugging config values, use
  `Config.load()` — a bare-constructor value that looks wrong is just the
  un-overridden default, not a config bug. Also: `sync extract --file` wants
  an ABSOLUTE path — it `relative_to()`s data_root and raises ValueError on a
  relative one.
- **PDF extraction stalls: two workers, one /process each.** `pdf-extractor`
  (VLM wrapper; env PDF_ENGINE=local, BIFROST_URL, VISION_MODELS) and
  `pdf-ocr` (the local PP-OCRv6 engine, nvidia libs mounted) BOTH expose
  `PUT /process`; GET health answers fine while job uploads stall
  (WriteTimeout — the request never even logs in the worker). Isolate like
  this: curl the PUT from host AND container (if both stall it's not campus's
  network), check the worker's docker logs for whether the PUT arrived,
  check nvidia-smi (clean GPU ≠ workers fine), jobs live in
  /var/lib/pdf-extractor and /var/lib/pdf-ocr (different volumes/images).
  When both hang for everyone, it's homelab infra, not campus — and the
  extracted content-tree copy usually already covers the content need.

## Design rules (locked)

- **Memory card** per course (`{course}/memory-card.md`, ~2-3KB, injected into
  system prompt): REGENERATED on diff (sync deltas/facts changed/lecture
  digest), never hand-edited. Structured rows BEAT facts (DEADLINES section
  from assignments/exams only). Supersede pass: time-sensitive categories
  (scheduling/exam/assignment/logistics/prof-note) expire after 30 days;
  ALL facts from ended-term courses are history (term windows: YYYYF =
  Sep-Dec YYYY, YYYYW = Jan-Apr YYYY+1).
- **Digest TIME RULES:** resolve relative dates ("tomorrow"/"next week") to
  absolute; convert ephemeral instructions to dated facts; skip passed-window
  facts. Without this, memory fills with time-bombs.
- **Notes = files, not DB:** prose lives in `{course}/notes/*.md`; `file_write`
  tool is audited (head-sha before/after). `content/` is read-only.
- **Extraction:** pdf-extractor CLOUD default. `engine=local` REMOVED — it
  pegged host CPU and contributed to machine crashes. `auto_extract_pdfs:
  true`, `digest_pdf_excerpt_chars: 2000` — digest sees PDF excerpts, not full
  text (deep reads via paginated content_read_file at chat time).
- **Class events** are COMPUTED from course_sessions (config `term_dates`,
  e.g. {2026F: "2026-09-01"}) — never materialized rows.
- **Auth:** manual (Duo push), token `~/.campus/token.json` 1h TTL,
  plaintext chmod 600. Container does auth too (playwright baked with
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` so uid 1000 can read it).
- **Service URLs:** host ports (127.0.0.1:18081 etc.) on host; docker
  hostnames (bifrost:8080/v1, trawl:8000/mcp, pdf-extractor:8000, ntfy:80)
  via HIPPO_* env in the container.

## Commands

```bash
cd /home/nate/campus
nix-shell --run 'python -m sync auth'          # Duo push; --status to check token
nix-shell --run 'python -m sync sync'          # full sync (start+final ntfy)
nix-shell --run 'python -m sync models'        # list bifrost models
nix-shell --run 'python -m sync extract --code "SE 2250B"'   # extraction queue
nix-shell --run 'python -m agent'              # REPL; --one "q" --course "SE 2250B"
docker exec campus python -m sync auth --status # container variant
```
NixOS: sqlite-capable python at /nix/store/*python3-*-env/bin/python3;
browser work needs `nix-shell` (playwright patched for NixOS).

## Working with Nate on this project

- **The agent harness is the product, not the UI.** Context construction,
  tools, audited actions, memory — before any web app. (Nate corrected
  2026-08-01.)
- **"Explain how it works" = explain ONLY.** Never implement in the same turn
  as an explanation request. (Nate corrected 2026-08-01.)
- **Commit as you go AND push to GitHub** after each working increment.
- Design-first: discuss structure/workflow/priorities BEFORE stack/scaffolding.
- Check git status first — external agents edit the repo; verify state, don't
  assume. Services: bifrost, pdf-extractor, trawl, ntfy, whisper on proxy
  network / host ports.
- **When Nate pastes an AI conversation summary for review, verify its claims
  against the live system before agreeing (2026-08-04).** The summary's "rubric
  criteria not in my data" was false at the DB layer (only the tool hid them);
  its "whoami fails" was false (present); "calendar drift" was moot (events
  table empty). Nate wants grounded opinions — he'll ask "are you absolutely
  sure?" if you overclaim. Answer with verified state, then rank the gaps by
  actual pain, then plan (never implement in the review turn).
