# HippoCampus — Build Plan

Status: planning complete, decisions locked. No implementation yet beyond the
existing H1 sync engine + agent harness (both working on host).

## Locked decisions (from design sessions)

| Decision | Choice |
|----------|--------|
| Container | One container `hippo`, proxy network, NixOS module, Caddy school.home.lab |
| Terminal network | Full network inside container |
| Web app auth | NONE — plain Caddy route on LAN/Tailscale (no Authelia) |
| Loop timing | Nudge at 22, hard stop at 24 |
| Web tools | trawl MCP (web_search + web_read), not direct SearXNG |
| File reads | offset/limit pagination, hard caps stay |
| Memory | facts table + per-course memory card (bounded, regenerated on diff); notes folded into workspace files |
| Card regen trigger | only when there's a diff (non-empty sync deltas / facts changed / lecture digest) |
| Conflict rule | structured rows beat memory_facts (facts get superseded on contradiction) |
| PDF extraction | engine=local (credit-free); auto-extract after sync; async + serialized |
| DB refinements | class events computed from course_sessions (not materialized); extracted .md siblings cataloged; file writes audited (before/after hash) |
| Workspace | /srv/homelab/school per-course layout (content/ ro, work/ editable, notes/, recordings/, lectures/, memory-card.md) |
| OneDrive (H4) | rclone one-way mirror of work/ + notes/ only; never bidirectional |
| Dashboard | Brightspace-like HTML views (course hub, content tree, announcements, assignments, files) + chat rail |

## Verified facts (2026-08-01)

- pdf-extractor `PUT /process?engine=local` is accepted but SLOW: >180s on one
  small PDF (cloud VLM ~seconds). It blocks the single worker — other requests
  queue/timeout meanwhile. Extraction must be async, serialized, and never
  block sync.
- trawl MCP on 127.0.0.1:11236 (host) / trawl:8000/mcp (container) — has
  search + read (crawl4ai) tools.
- Bifrost tool-calling works with opencode-go/deepseek-v4-flash.
- Agent harness (context builder + 12 tools + loop) verified live on SE 2250B.

---

## Phase 0 — Agent upgrades + extraction (host-run, quick wins)

1. **Loop timing**: NUDGE_AT=22, MAX_ITERATIONS=24 (agent/chat.py).
2. **trawl MCP client**: reusable helper (initialize → tools/call, from
   tools/mcp-client-example.py pattern). New agent tools: `web_search(query)`,
   `web_read(url)` via trawl. Remove direct SearXNG handler.
3. **Pagination**: `content_read_file` gains offset/limit; caps stay.
4. **PDF extraction queue**:
   - Cloud engine by default (no engine param — pdf-extractor's default).
     Local mode removed: it pegged host CPU and crashed the machine.
   - Extraction runs as a background job after sync (never in the sync
     critical path): serialized, one at a time, skip when the pdf-extractor
     worker is busy.
   - `auto_extract_pdfs: true` (config already exists).
   - Pilot backfill: skipped (cloud = API credits on old content; user's call).
   - **Digest sees PDF content**: deltas carry a bounded excerpt of the
     extracted markdown (config `digest_pdf_excerpt_chars`, default 2000) —
     facts extraction reads real content, not just paths. Full text stays
     out of the digest prompt (context budget); deep reads happen at chat
     time via paginated content_read_file.
5. **ntfy = one notification for the WHOLE sync**: start ping when sync
   begins, completion ping when everything finished (sync + extraction +
   digest) with the full breakdown: files new/changed, announcements,
   PDFs extracted, digest facts, log path. No per-batch extraction chatter.
6. **Notes → files migration**: notes table → `{course}/notes/*.md`
   (one-off script; existing rows converted). `mutate_add_note` becomes
   `file_write` (audited, before/after hash). Drop notes table from schema.
7. **DB refinements**:
   - events: stop materializing class meetings — the events query computes
     classes from course_sessions; events table holds only hand-created rows.
   - Catalog extracted markdown: files rows with kind=extracted for .md
     siblings (content_list_files shows everything readable).
8. **Memory card**:
   - `memory_card.md` per course: bounded (~2-3KB, ~20 bullets),
     DEADLINES / POLICIES / PROF NOTES / OPEN THREADS / STATE.
   - Generator (consolidator script): reads facts table + recent deltas +
     recent notes; resolves conflicts by priority (structured rows > facts);
     supersedes contradicting facts; atomic write (tmp+rename), keeps .prev.
   - Regen triggers: sync with non-empty deltas; facts changed; lecture digest.
   - Injected into system prompt (agent/context.py) for course-scoped chats.

**Verify**: trawl tools answer a live question; backfill completes with ntfy
pings; a fact vs exam-row contradiction resolves to the structured row; card
regens only on diff (quiet sync → no regen).

## Phase 1 — Container (the sandbox)

- NixOS module `hippo` on proxy network; image: python3 + node + git + rg
  (+ dotnet SDK when a course needs it).
- Volumes: /srv/homelab/school (rw), data/harness.db, ~/.hippocampus
  (token + browser profile — sync keeps working from the container).
- No docker socket, no host secrets, no /etc/nixos.
- Caddy school.home.lab (plain reverse proxy — no auth per decision).
- Config URLs → docker hostnames (bifrost, trawl, ntfy, pdf-extractor).
- Move sync + agent + CLIs into the container; nix-shell stays for dev.

**Verify**: `python -m sync sync` and `python -m agent` work inside the
container; auth (Duo) still works; dashboard not yet — Phase 3.

## Phase 2 — Terminal tool (inside the container)

- `terminal_run(command, workdir?, timeout_s?)` → {stdout, stderr, exit_code,
  cwd, duration}. Default cwd: course work/ when scoped, workspace root else.
- Blocklist: sudo, su, docker, podman, nixos-rebuild, systemctl, shutdown,
  reboot, mkfs, dd, /etc, /nix, ~/.ssh, `python -m sync auth` (no Duo spawn).
- content/ write-guard: refuse write-class commands targeting /content/.
- Timeout 30s default / 120s max; output cap ~10KB (tail).
- Audit every call: actor=ai, command, cwd, exit code, duration.
- `file_write` tool (audited, before/after hash) for notes/work files —
  prose writes go through this instead of raw shell redirects.

**Verify**: AI edits a file in work/, runs a script, hits the blocklist
(denied + audited), cannot touch content/.

## Phase 3 — Dashboard (Brightspace-like HTML + chat rail)

- FastAPI backend: thin read endpoints (courses, course home, content tree,
  announcements, assignments, files, events, sync runs, sync trigger).
- React/TS frontend, PWA:
  - course switcher rail
  - course hub: announcement feed + calendar strip
  - content tab: module/topic tree (expand/collapse, hidden/locked badges,
    file topics → view extracted markdown or original PDF via pdf.js)
  - assignments tab (due dates, status, weights)
  - sync page: button + run history + log viewer
  - chat rail: SSE streaming over run_turn, scoped to course/module
- Files served via the app (LAN/Tailscale only — no auth by decision).

**Verify**: browse SE 2250B content exactly like Brightspace but local;
chat answers in the rail with tool calls visible; sync from the button.

## Phase 4 — OneDrive (H4)

- rclone remote for school M365 OneDrive (one-time browser auth).
- One-way mirror work/ + notes/ → OneDrive/{term}/{code}/…, systemd timer.
- Not content/, not recordings/. Never bidirectional.

## Phase 5 — Recordings (H5, after term starts)

- Upload endpoint + Android app (Kotlin, foreground service) → recordings/
- Transcribe (cohere container) → transcript.md → lecture digest →
  lectures/ + memory card regen.
- Native app decision at the H5 gate (per HANDOFF).

## Optional add-on — Grades + discussions sync

- MCP exposes get_my_grades + get_discussions; adding the same D2L endpoints
  to the sync engine (~1 day) enables a grades page on the dashboard.
- Recommended before 2026F midterms land.

## Sequencing rationale

0 first: cheap fixes that make the agent honest (loop timing, real web tools,
complete catalog) and unblock extraction (local engine). 1 before 2: the
terminal tool is only safe inside the container. 2 before 3: the dashboard's
file/note views assume the file tooling exists. 3 is the payoff — everything
before it feeds it. 4/5 are conveniences for the live term.
