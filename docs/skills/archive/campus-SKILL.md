# Archived original skill body — consolidated into campus-operations.md / campus-harness.md / campus-web-ui.md
# Source: Hermes homelab profile skill `campus` (homelab/hippocampus), archived 2026-08-04


# Campus — School Harness

Personal AI study/org system for Nate's Western SE degree. Deterministic
Brightspace sync + AI digest + (future) web UI, RAG, lecture recordings.
Canonical docs in the repo: `docs/DESIGN.md` (architecture),
`docs/HANDOFF.md` (implementer brief), `docs/DATA_MODEL.md` (schema).

## Where things live

> D2L dropbox/assignments metadata map (what the folder objects actually
> carry, the dump-all-fields audit lesson, whoami str-vs-int pitfall,
> instructor-only ceilings): references/d2l-dropbox-metadata.md in the
> campus-school-harness skill.

| What | Path |
|------|------|
| Repo | `~/campus` (git); **public on GitHub** `HasNate618/campus` (SSH push, 2026-08-01); course content/data never in git |
| Runtime data (prod) | `/srv/homelab/school/{term}/{code}/…` |
| SQLite DB | `data/harness.db` (gitignored) |
| Config | `~/campus/config.yaml` (gitignored, chmod 600; copy of config.example.yaml) |
| Token | `~/.campus/token.json` (plaintext, chmod 600) |
| Session cookies | `~/.campus/cookies.json` (d2l* browser cookies, captured at auth — the content proxy needs them, see references/content-auth-proxy.md) |
| Browser profile | `~/.campus/browser-data/` (Playwright SSO cookies) |
| Brightspace MCP (reference only) | `/var/lib/brightspace-mcp` — patterns for auth/client, NOT a runtime dependency |

## Commands (always via nix-shell)

```bash
cd ~/campus && nix-shell
python -m sync auth --status     # token valid?
python -m sync auth              # browser login → Duo push → token (1h TTL)
python -m sync sync              # pilot sync (SE 2250B); --code X, --dry-run, --model M
python -m sync extract           # PDF → markdown (keeps originals); --code X, --file P, --max-mb N
python -m sync models            # list bifrost models (136); default marked
python -m agent --one "Q" --course "SE 2250B"   # agent single question (tools visible)
python -m agent --course "SE 2250B"             # agent REPL (exit to quit)
```

## Architecture

`sync/` Python package: `config.py` (yaml+env), `token_store.py` (plaintext
JSON, restart-safe — deliberately NOT the MCP's hostname-keyed AES),
`d2l.py` (D2L REST client: version discovery, lp/le path builders, bearer or
cookie auth, token-bucket rate limit, 401 retry), `auth.py` (Playwright SSO),
`db.py` (audited upserts), `sync.py` (orchestrator), `extract.py`,
`__main__.py` (subcommand dispatcher).

`agent/` Python package (the harness — built + validated 2026-08-01, this is
the product per Nate, NOT the UI): `context.py` (system prompt built from
live state: America/Toronto time, active terms, course scope, next-7-days
events incl. classes computed from course_sessions when `term_dates` set in
config, and the per-course memory card), `tools.py` (tool registry via a
`_tool()` builder — harness_* DB reads, content_* file reads with offset/limit
pagination + .md-sibling fallback + ripgrep with snippets, mutate_* audited
writes, file_write audited, web_search/web_read via trawl MCP),
`mcp.py` (minimal MCP streamable-HTTP client for trawl), `memory.py`
(per-course memory-card generator: bounded ~24 bullets, DEADLINES from
structured rows only — structured beats facts — atomic write, .prev kept),
`chat.py` (tool-calling loop: NUDGE_AT=22, MAX_ITERATIONS=24; tool results
capped 6000 chars; stateless REPL).

Division of labor (user asked "what does the AI do?" — explain it like this):
- **Sync is dumb** — fetch/diff/download/store, deterministic, never hallucinates.
- **AI digest** (end of sync): reads the delta → markdown sync log + durable
  facts into `memory_facts` (with source+confidence). Delta now carries
  announcement BODIES (800 chars) + extracted-PDF excerpts
  (`digest_pdf_excerpt_chars`, default 2000) so the model reads content, not
  just paths.
- **AI agent** (built): context + tools + loop over the synced data — query
  DB, read/grep files, audited updates ("assignment extended 2 days").

Key design rules (from HANDOFF, non-negotiable):
- No auto-scrape of Brightspace — sync is manual/on-demand (Duo).
- Chat never calls Brightspace live — only SQLite + disk.
- AI mutations go through audited paths (`audit_log`, before/after JSON).
- Secrets never in git (config.yaml gitignored); course content never in git.
- `memory_facts` supersede (is_active=0), never delete.

## GitHub (public code backup) — 2026-08-01

- Code repo is PUBLIC at `github.com/HasNate618/campus` (NOTE: canonical
  name is **Campus, capital C** — GitHub redirects the lowercase guess;
  remote URL must be `git@github.com:HasNate618/campus.git`. Nate's
  choice: "the code itself would be public in github"; verified remote ==
  local, SSH key `git@github.com` works as HasNate618; `gh` CLI is NOT
  installed).
- **Push after every commit** (`git push github main`) — the remote must
  never fall behind; a host crash already corrupted local git once.
- Commit identity: `git -c user.name='Nathan Espejo' -c
  user.email='nate.e.espejo@gmail.com'` — task specs pass it inline; don't
  rely on a repo-local gitconfig existing.
- **Repo rename 2026-08-03: HippoCampus → campus.** Local remote updated to
  `git@github.com:HasNate618/campus.git`; the GITHUB-side rename is a MANUAL
  web action (Settings → rename; no `gh` CLI and SSH cannot rename repos) —
  until Nate does it, `git push github main` fails with "Repository not
  found" even though auth is fine. After any remote rename, check
  `git remote -v` matches BEFORE blaming push failures on credentials.
- Nate creates repos manually at github.com/new (Public, NO README checkbox —
  a README conflicts with the first push); the SSH key cannot create repos.
- Pre-push hygiene (audited 2026-08-01): `git ls-files` to confirm no
  data/*.db/config.yaml/.venv tracked (gitignore covers them), grep for
  secrets, scan docs for homelab service names. Items Nate accepted as
  public: seed/courses.json (his registrar schedule) and docs mentioning
  bifrost/trawl/school.home.lab (tailnet-internal names, inert publicly).
- **Forgejo is NOT the code remote anymore** — repurposed as the FUTURE
  PRIVATE DATA backup (DB dumps + school dir), a separate job. Needs Nate's
  auth (nate@home.lab) or a token; not wired yet.

## Model config

- Default: `opencode-go/deepseek-v4-flash` in config.yaml `bifrost_model` —
  **Nate's explicit pick** (2026-07-31: "not deepseek direct theres also
  opencode-go/deepseek-v4-flash"). Bifrost serves BOTH
  `opencode-go/deepseek-v4-flash` and `DeepSeek/deepseek-v4-flash` (136 models
  total) — the direct DeepSeek ID was the agent's initial guess, user overrode.
- Any model from `python -m sync models` works; `--model M` overrides per run.
- bifrost = OpenAI-compatible at `http://127.0.0.1:18081/v1` (host) or
  `http://bifrost:8080/v1` (Docker network). Verify a candidate model responds
  before wiring it in (`/v1/chat/completions` pong test).

## Services (host-mapped ports when sync runs on host)

bifrost 127.0.0.1:18081 · pdf-extractor 127.0.0.1:8001 · ntfy 127.0.0.1:8085.
Use Docker hostnames (bifrost/pdf-extractor/ntfy) when containerized.

## Container deployment (Phase 1, DONE 2026-08-01)

NixOS module `modules/server/ai/campus.nix` — systemd oneshot + `docker run
-d`, house pattern. The container IS the sandbox for the AI (terminal tool
runs inside it). Key decisions, all verified live:

- **Run as the file owner's uid, not root** (`--user 1000:100`): `--cap-drop
  ALL` also strips CAP_DAC_OVERRIDE, so container root CANNOT traverse
  host dirs with 0700 perms (/home/nate) — sync/agent crashed with
  `PermissionError` reading the mounted code. This is the single gotcha that
  bit; uid-1000 is also more secure than root.
- `--network proxy` → docker hostnames: `http://bifrost:8080/v1`,
  `http://pdf-extractor:8000`, `http://ntfy:80`, `http://trawl:8000/mcp`.
  config.yaml stays host-oriented; the module passes `HIPPO_*` env overrides
  (config.py supports HIPPO_BIFROST_URL / HIPPO_PDF_EXTRACTOR_URL /
  HIPPO_NTFY_URL / HIPPO_TRAWL_URL / HIPPO_DB_PATH / HIPPO_TOKEN_DIR /
  HIPPO_MODEL / HIPPO_BASE_URL / HIPPO_DATA_ROOT).
- Volumes: `/srv/homelab/school` (rw), `/home/nate/campus:/app` (ro —
  code runs from the mount, no image rebuild on code changes), repo
  `data/:/app/data` (rw, DB), `~/.campus` (rw, token + browser
  profile). config.yaml is read from the ro /app mount.
- `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` in the Dockerfile — the
  image bakes chromium at a shared path so uid 1000 (not root) can read it;
  root's ~/.cache is unreadable to uid 1000.
- Limits: `--memory 1g --cpus 1.0 --pids-limit 200 --cap-drop ALL
  --security-opt no-new-privileges`. `--restart unless-stopped`.
- CLI: `docker exec campus python -m sync|agent …` — auth (Duo) works from
  inside the container (playwright is in the image; Debian base sidesteps
  the NixOS pip-playwright problem).
- Deploy flow: docker build first (image must exist before switch), copy
  flake to /tmp/nixos-flake-build, `git add` new files (flakes need
  tracked files), nix eval smoke test, `sudo nixos-rebuild switch --flake
  /tmp/nixos-flake-build#home`, then PROVE it: docker exec auth --status +
  a live agent query (both verified working).
- **/etc/nixos is its own git repo with a ROOT-owned .git** — stage/commit
  there with `sudo git …` (identity flags inline); a plain `git add` dies
  with "insufficient permission for adding an object". Remote = Forgejo
  `nixos-config.git` (private backup): `sudo git push origin HEAD`. The
  /tmp/nixos-flake-build copy is build-only; live /etc/nixos is the source
  of truth.
- Dockerfile is now multi-stage (node build web/ → python runtime with
  playwright); prod CMD seeds only when the DB is missing, never runs
  pilot_data.py (dev mock).
- Caddy route `http://school.home.lab → 127.0.0.1:8087` already stubbed
  (Phase 3 web app; 502 until uvicorn binds).

## Frontend merged + Phase 3 backend wiring (2026-08-01)

Frontend agent built a full React/TS PWA (web/ + FastAPI scaffold api/) in a
separate repo on the flow workstation (`/home/nate/Projects/Campus`,
reachable: `ssh nate@100.77.172.11`). Nate: ONE repo, keep the frontend
history → merged via `git remote add frontend ssh://…` + `git fetch frontend
master` (their default branch was **master**, not main — check with `git
ls-remote`) + `git merge frontend/master --allow-unrelated-histories
--no-commit`; resolved add/add conflicts keeping OUR schema.sql/docs/seed
(their copies were older) and hand-merging Dockerfile + README. Their
`docs/FRONTEND_HANDOFF.md` kept. Merge commit 0ff034e, pushed.

Their SSE contract (backend must implement, in order):
`tool_start {tool, args}` · `tool_end {tool, result}` · `token {text}` ·
`done {answer}`. **2026-08-03 chat-pipeline overhaul (43a5abd):** the SSE
contract gained `reasoning {text}` — chain-of-thought chunks emitted BEFORE
tokens each iteration (bifrost streams it as `delta['reasoning']`, deepseek
native as `reasoning_content`; agent/chat.py `_model_call` accumulates both
into msg['reasoning'] AND msg['reasoning_content'] — the latter is the
provider passback requirement, the former feeds the API reasoning cache and
the UI thinking block). Frontend assistant msgs carry `thinking`/
`thinkingDone`; tool msgs carry `turnId` for per-turn collapse; UI shows an
expandable Thinking block, a busy spinner, 'N tool calls' summary rows, and
renders chat markdown with the SITE's `.md` styling (ChatMd, marked-based) —
NOT ZenMarkdown. Nate rejected zen in chat ("assistant markdown no longer
styled like the rest of the site — changed by subagent"); zen is
CONTENT-VIEWER only. Chat is course-scoped; **since 2a71c8a chats are SERVER-SIDE** — the
message tree lives in `chat_sessions.nodes_json` (SQLite), localStorage
(`hc.chat.sessions.v3`, a MESSAGE TREE — v2 linear sessions migrate to v3
automatically on load) is demoted to an offline cache. See
references/chat-v2.md → \"Server-side storage\".
**Model selector (9463595):** chat header has a model picker chip (CPU
icon) — GET /api/chat/models proxies bifrost /v1/models (136 models),
selection persisted in localStorage `hc.chat.model`, sent as `model` on
every /api/chat request (ChatRequest.model → run_turn; null = config
default). Nate's answer to the model-swap question: "keep model. but i
want model selector" — flash stays the default, the picker is the lever.
**Moved (ee959bf) + reworked twice (f815211 → e25168e): the picker lives
in the chat INPUT, whose FINAL shape is shadcn-style — the textarea on
top, then its OWN `.input-toolbar` bottom row INSIDE the same container
(`.chat-input` is `flex-direction: column`):
flex spacer, ctx-meter (right-aligned), model pill, paperclip upload
stub, send button. The model popover is searchable (filters the 136
models) and expands UP (`bottom: calc(100% + 8px)`); the header chip and
the old `.input-tools` second row below the input are gone; the
`hc.chat.model` state/localStorage key are unchanged. Nate's evolution:
f815211 put everything in ONE line with the send button; e25168e said
"more shadcn-like — the buttons have their own separate row at the
bottom" — shadcn-like HERE means the toolbar-inside-input pattern
(textarea + tool row inside the same rounded container), not controls
scattered in the input line. **Padding lesson (0fc4e32 — "when i said
padding i meant make the content of the chat viewport a bit further from
the edges. revert the other padding changes"): Nate's "padding" asks
mean the chat VIEWPORT's edge distance — `.chat-scroll` is now
`28px 24px 12px` — NOT the message/input internals. The e25168e message
bump (.msg-user 11px/16px, .msg-assistant line-height 1.65) and the
input padding (14px 14px 10px) were all REVERTED to the originals
(.msg-user 9px 14px, no line-height, input 10px 10px 10px 16px). Ask
which surface before padding anything.**
**Chat v2 BUILT + DEPLOYED (2026-08-03, 4a8c2df, per docs/chat-v2-plan.md):**
message TREE like Open WebUI — sessions are a flat `MsgNode` store
(parentId/children/activeNodeId); the visible chat is the path root→active.
Regenerate FORKS (new assistant sibling; old branch preserved, branch chips
`v1 v2` on multi-child parents switch paths), edit rewinds (rewrite user
node + delete whole subtree + auto re-send), delete REMOVES just the
message and REJOINS the conversation (since 607859f — direct non-tool
children re-parent to the deleted node's parent; tool/intermediate
artifacts die with it; see the Pitfalls entry for the edge cases),
tool nodes are children of assistant nodes (collapsed to "N tool calls").
`branch` field on the POST keys the reasoning cache per-branch
`(session_id or course_id, branch)`. The `done` SSE event grew to
`{answer, model, usage}` (bifrost streams `usage` in the final chunk;
_model_call captures it, run_turn aggregates) → the UI shows context in
the input dock's BOTTOM ROW (ee959bf): a `ctx-meter` — the last turn's prompt_tokens vs the SELECTED model's
REAL context window (GET /api/chat/models returns a per-model `contexts`
map from bifrost's context_length; only ~42/136 models report it —
deepseek does NOT → the meter shows used-tokens only, NO invented 200K;
Nate: "including actual max content instead of just 200k") + the
searchable model selector + a disabled paperclip upload stub, all in ONE
row with the send button. The old context-bar above the input and the
stream-status line (build marker) were REMOVED (ee959bf) — stream status
is no longer shown above the bar. Shared `zenMd.tsx`
post-process (mermaid lazy-import dark theme with click-to-zoom overlay +
code-block copy headers) wired into BOTH chat ChatMd and content
Migration: localStorage `hc.chat.sessions.v2` (linear
messages) → `v3` (tree) happens automatically on load. Architecture
detail: references/chat-v2.md.
**Post-launch regression fixes (b8e0326 + bdca860, same day):** (1) the
busy flag was set at send but NEVER reset — `streamTurn` lacked a
`.finally` → the Thinking spinner stuck on ALL chats and sends were
blocked until reload. Rule: any async stream turn must reset its busy
state in `.finally`, not in a success path. (2) the active session was
memory-only — after reload, sending created a FRESH session with no
history. Persist the active-session map (`hc.chat.active`) alongside the
sessions. (3) touch devices: `.msg-actions` were `opacity:0` until hover
but still clickable → invisible accidental deletes; `@media (hover:
none) { opacity: 1 }`. (4) `deleteMessage` falls back safely when the
path root would vanish (never leave activeNodeId pointing at a deleted
node). (5) **Never fail silently (bdca860):** a stream failure or a
stream that ends WITHOUT a `done` event now renders a visible ⚠ message
with the actual error (the `done` event sets a
  `receivedDone` flag checked in `.finally`), and `streamChat` logs
  read failures to the console — before this, a client-side failure
  showed ONLY the user's message while bifrost logs showed the agent
  working, and it was undiagnosable. See the streaming pitfalls for the
  diagnosis sequence. (6) **Server-side sync round (2a71c8a + cac54b6,
  same day):** sessions now persist to `chat_sessions.nodes_json` via
  CRUD endpoints; localStorage is an offline cache. Two empty-chat bugs
  followed, both root-caused from DB + container-log evidence (see
  references/chat-v2.md → "Post-launch debug round"): (a) the first save
  loop SWAPPED the session id (uuid → server id) mid-stream, so every
  stream event after the swap targeted a nonexistent id and was silently
  dropped (session 13: user node saved, assistant node never landed, no
  error, API logged 200). Fix: the client id NEVER changes — sessions
  carry a stable uuid plus a separate `serverId?: number` field. (b) the
  GET /chat/sessions list endpoint returned only id/title/updated (built
  for the popover) but the client's on-mount load used it as the restore
  source → every chat reloaded with `nodes: []` → "opening a chat shows
  the new chat screen". Fix: the list returns the FULL tree. Rule: the
  client's LOAD path must receive everything the RENDER path needs; and
  never change the identity an in-flight stream targets.

Backend wiring ALL DONE + DEPLOYED (2026-08-01, commits 454fe90 + 13607b9):
1) api/routers/chat.py runs `agent.run_turn` with an emit callback; chat.py
   streams (stream=True) and emits tool_start/tool_end/token/done — the
   deepseek thinking-mode quirks are handled INSIDE the loop (see
   agent-harness-development → "Streaming tool-calling": reasoning_content
   passback, role field, name set-once, reasoning cache). 2)
   chat_sessions/chat_messages tables in schema.sql; the API persists turns
   when the client sends session_id (frontend wires it when server session
   mode lands). 3) Multi-turn works TODAY with zero frontend changes: the
   API keeps an in-memory reasoning cache keyed by session_id or course_id
   and injects the cached reasoning_content into incoming history (their
   localStorage history can't carry it). 4) POST /api/sync/trigger runs the
   real engine in a background thread — engine.run() owns the sync_runs
   lifecycle, so the trigger must NOT duplicate error handling. 5)
   /api/files/{id}/content (markdown, .md-sibling aware) + /api/files/{id}/raw
   (FileResponse, path-guarded under SCHOOL_ROOT) for pdf.js. 6) DEPLOYED:
   uvicorn is the container CMD, published 127.0.0.1:8087:8000,
   school.home.lab → HTTP 200. api/requirements: fastapi, uvicorn[standard],
   sse-starlette.

Deploy recipe (verified live end-to-end):
- web/dist MUST be built on the HOMELAB (`nix-shell -p nodejs_22 --run
  'cd web && npm ci --no-audit && npm run build'`) — the /app:ro mount
  SHADOWS the image's baked web/dist (the repo's web/ has no dist, it's
  gitignored), so FastAPI's static mount finds nothing and the UI root 404s
  while /api still works.
- campus.nix gained `-p 127.0.0.1:8087:8000` (commit 98c7b1a) → rebuild
  flake from /tmp/nixos-flake-build → `docker build -t campus:latest .` →
  `sudo systemctl restart campus` → verify: curl 127.0.0.1:8087/api/health,
  curl 127.0.0.1:8087/ (index.html), curl -H 'Host: school.home.lab'
  http://127.0.0.1/ (Caddy path), docker exec auth --status, and one SSE
  chat turn through 8087.

## PWA installability + HTTPS (2026-08-03, 6ec0730 + proxy.nix)

Nate: "is pwa properly set up? chrome and firefox arent creating the app
properly on android" — the app now IS installable, but ONLY via HTTPS:
**https://home.tail3b22c4.ts.net** (Tailscale Let's Encrypt cert, Caddy TLS
route, weekly renewal timer). plain `http://school.home.lab` can NEVER be
installed (secure-context requirement) — that was the real reason Android
refused, on top of the missing service worker + SVG-only icons. What landed:
SW (`web/public/sw.js` — /api never cached, hashed assets cache-first,
offline shell fallback) + registration in main.tsx; PNG icons (192/512/
maskable from favicon.svg — NOT icons.svg, that's a sprite sheet) + manifest
id/scope; apple/mobile meta tags. Full recipe (cert issue, Caddy block,
renew timer, icon commands, install steps for the phone):
references/pwa-https-setup.md. Install = phone + Tailscale → Chrome →
the ts.net URL → Add to Home screen.

## Frontend web/ (React/TS PWA) — 2026-08-03 bug-fix pass (8a376b7)

Nate owns frontend scope; api/ + sync/ belong to a parallel agent. When
working web/ only: `git add web` (NEVER `git add -A` — it sweeps the other
agent's uncommitted api/sync work into your commit), commit describing only
your scope, `git push github main`. Full architecture, contracts, and
patterns: `references/frontend-web.md`.

Quick map: Vite 8 + React 19 + react-router-dom 7 + Tailwind v4 +
framer-motion + react-markdown; `@/*` → src/*; `noUnusedLocals` +
`verbatimModuleSyntax` (use `import type`). Build ONLY via
`nix-shell -p nodejs_22 --run 'npm run build'` (node is not on the host
PATH). Design system = hand-rolled "dark glass" classes in
src/styles/global.css (`.card/.chip/.btn/.split/.tree-*/.md/.tabbar/…`),
NOT shadcn components — read global.css before writing UI.

- `/api/files/{id}/content` contract: `{content, format, rawUrl}`, format ∈
  markdown|html|code|pdf|download; rawUrl → `/api/files/{id}/raw`
  (usable in an `<iframe>`). pdf: content = extracted markdown if
  processed else ''. **PDF viewer policy (2026-08-03, REVISED 4b128fb):
  original PDF by DEFAULT, rendered by embedding Nate's ACTUAL
  zen-pdf-viewer in an iframe** — web/public/zen-pdf/viewer.html
  (pdfjs-dist@2.16.105 vendored locally, NO CDN) is served statically at
  /zen-pdf/; ContentPage's `ZenPdfFrame` iframes it with src
  `/zen-pdf/viewer.html?file=<abs raw url>&zen=1&pageless=1&t=<file id>`.
  The old canvas reimplementation (PdfViewer.tsx + zenPdf.ts) is DELETED.
  The earlier "NOT an iframe; Android Chrome iframes just download" rule
  applied to iframes pointing at the RAW pdf — an iframe at viewer.html
  (an HTML page that renders the pdf itself via pdf.js canvas inside the
  iframe) works everywhere including Android. "View extracted
  text" toggle renders the markdown via ZenMarkdown** — the old
  markdown-first default was flipped at Nate's request. PDFs render
  full-bleed on a TRANSPARENT zen surface (`.pdf-zen`) — the github-dark
  `#0d1117` background was removed at Nate's request ("remove the github
  coloured background for viewing pdfs"); pages float on the app surface
  with a subtle per-page shadow. **Final state (2026-08-03, 4b128fb):
  the real viewer supplies the zen pipeline (zen=1&pageless=1 in the
  iframe src) — per-pixel luma inversion, paper detection → transparent
  pageless pages, text-layer selection, zoom, rotation, keyboard nav —
  see web/public/zen-pdf/README.md for the vendoring + param contract.**
- **Nate's zen repos are TWO separate projects — do not conflate them
  (2026-08-03 gotcha: a subagent ported the wrong one).**
  `zen-markdown-viewer` (github.com/HasNate618/zen-markdown-viewer) =
  MARKDOWN rendering: marked + highlight.js, GitHub-dark typography
  (headings w/ border-bottom, blockquotes, tables, task lists), ported as
  `.zen-md` in styles/zen.css, transparent bg inside the app.
  `zen-pdf-viewer` (github.com/HasNate618/zen-pdf-viewer) = PDF VIEWER:
  pdf.js PAGELESS CONTINUOUS SCROLL (all pages in one column, rendered
  progressively, first page instant), transparent `.pageShell` wrappers,
  minimal dark toolbar (page count, zoom in/out, fit-width reset), and —
  the signature — **Zen mode: a per-pixel luma-inversion pipeline**
  (dark-on-light pages become light-on-dark; paper detected per-page and
  dropped to TRANSPARENCY in pageless mode). **Since 4b128fb the app
  embeds the ACTUAL viewer** (web/public/zen-pdf/viewer.html vendored
  with pdfjs-dist@2.16.105, driven by ?file=&zen=1&pageless=1 URL params
  in an iframe — see web/public/zen-pdf/README.md); the old
  web/src/lib/zenPdf.ts + PdfViewer.tsx port is DELETED.
  ZenMarkdown follows zen-markdown-viewer. When Nate says "zen
  rendering", ask WHICH repo if the target (markdown vs PDF) is
  ambiguous. **Nate rejects lookalike reimplementations of his zen repos
  ("the integration of it sucks"; "read the repo yourself and implement
  the zen rendering")** — a simplified port (subset CSS, approximate
  pixel pipeline, render-all-pages) is NOT acceptable; use the real
  viewer/engine (embed the actual viewer.html with vendored deps + URL
  params, or port the exact pipeline with the reference's threshold
  constants and behavior — IntersectionObserver visible-page rendering,
  page cache, text layer), and read the repo's AGENTS.md + viewer.html
  before coding. Subagents get this in the brief verbatim.
- Markdown rendering = **ZenMarkdown** (web/src/lib/ZenMarkdown.tsx +
  styles/zen.css): marked + highlight.js ported from Nate's
  zen-markdown-viewer repo (github.com/HasNate618/zen-markdown-viewer) —
  GitHub-dark typography. **Since 4a8c2df BOTH chat ChatMd and content
  ZenMarkdown run the shared `zenMd.tsx` post-process** (web/src/lib/
  zenMd.tsx): mermaid fences → lazy-imported dark-theme SVGs with a
  click-to-zoom overlay, and code blocks get a `.code-header` bar with a
  copy button (clipboard + execCommand fallback); elements are tagged
  `data-zen-processed` so per-token streaming re-runs never duplicate.
  **2026-08-03 streaming-smoothness fix (the "all at once" round):** the
  post-process effect re-ran on EVERY html change — the ChatMd rAF throttle
  coalesces token updates to ≤60 renders/s, so the effect scanned the whole
  message DOM (mermaid/copy-header decoration) up to 60×/s, fighting the
  token renderer for the main thread; on mobile the text appeared in large
  jumps / all-at-once. Fix: the heavy DOM scanning inside useZenPostProcess
  is trailing-debounced (~250ms) — decorations (copy buttons, mermaid SVG)
  settle right after the message stops growing; the click-listener
  attach/detach stays immediate and the effect cleanup clears the timer.
  Rule: during token streaming, decoration work must never run at render
  frequency. **Amendment (d89815c): the effect now runs after EVERY render
  (no deps array — the internal 250ms debounce keeps it cheap) — a reload or
  any re-render that RESETS the message DOM (dangerouslySetInnerHTML
  replaces the decorated innerHTML with raw markdown) gets re-decorated
  within the debounce window. Without this, a reset left code blocks /
  mermaid reverted to raw permanently (user saw: basic code block → decorated
  for a split second → basic again). Elements tagged `data-zen-processed`
  prevent double-processing within a run.
  Chat tables got the zen treatment in global.css (.md th/td borders,
  zebra rows). **User-reported .md regressions fixed in global.css
  (d89815c):** headers render at normal weight — `.md h1-h4` needs explicit
  `font-weight: 700`; bullets vanish — a global `list-style: none` reset
  kills them, so `.md ul { list-style: disc }` / `.md ol { list-style:
  decimal }` must be set explicitly; tables stretch full-width —
  `width: auto; display: inline-table; max-width: 100%` makes them
  shrink-to-fit. Any future .md restyle must keep these three.
  react-markdown is no longer used for content.
- Content tree is COLLAPSIBLE (2026-08-03): per-module chevron collapse
  (`.tree-module.collapsed`) + Collapse all/Expand all. View-mode toggle
  "Side by side"/"Full width", persisted in localStorage
  `hc.content.viewMode` (default fullWidth). **REMOVED ENTIRELY (0fc4e32 — "from the content tree remove the buttons
for expand/collapse all and side by side/single toggle"): the content
view has NO view toggle and NO collapse-all buttons — it is FIXED
single-pane (`split-mode-full` always; per-module chevrons still
collapse modules; `.view-toggle`/`split-mode-split` CSS is dead). History
**Tree-header buttons GONE, viewer-header toggle RESTORED (0fc4e32 + 0025eee).** First pass (0fc4e32 — "from the content tree remove the buttons for expand/collapse all and side by side/single toggle") removed EVERYTHING including the VIEWER's view toggle; Nate came back with "you removed the other toggle view button, not just the one in the content tree. restore the other." Final state (0025eee): the TREE header has NO buttons (no collapse-all, no view toggle; per-module chevrons still collapse modules) — but the VIEWER header (next to "All topics") KEEPS its view-mode toggle (Columns2/Maximize2 icon, title="Show the content tree beside the viewer"), and the viewMode state + `hc.content.viewMode` persistence are back; `.split-mode-full` (default, single pane) and `.split-mode-split` (tree + viewer side-by-side) are both emitted again. History: the toggle was originally in the tree header — display:none in fullWidth mode whenever a node is selected — so the user couldn't see or click it ("toggle doesnt do anything" = control trapped in hidden chrome). Rules: (a) a control that changes the content view must live in always-visible chrome, not in a panel that the mode hides; (b) when Nate asks to REMOVE a control, check EVERY instance of it first — the view toggle existed in BOTH the tree header and the viewer header, and he wanted only the tree-header ones gone. `.split-mode-full` = single panel (tree XOR
  content; grid ALWAYS
  `minmax(0,1fr)` so the tree spans the row when nothing is selected — no
  empty gutter); `.split-mode-split` = 300px tree + viewer side-by-side
  (no longer emitted). The old Hide-tree button + `.split.tree-hidden` CSS are GONE (dead, no
  component references them). **Class-name mismatch pitfall (f815211): the
  component emitted `split-mode-${viewMode}` with viewMode
  'fullWidth'|'sideBySide' but the CSS only defines `split-mode-full` and
  `split-mode-split` — no rule ever matched, so the toggle SILENTLY did
 nothing (desktop was permanently two-pane, which is exactly Nate's
 "on desktop it always acts like side by side and the full width layout
 is unavailable"). A toggle that 'does nothing' → verify the emitted
 class names match the stylesheet rules FIRST, before touching behavior.
 (Since 0025eee the toggle lives ONLY in the viewer header — the class-name
 lesson stands for any view-mode control.)
- Brightspace html `<img>` srcs are rewritten through `/api/proxy?url=…`
  by the sanitizer (src/lib/sanitize.ts proxifyUrl) — direct img tags 401
  without a Brightspace session (see the enforced-content pitfall).
- Content tree `/api/courses/{id}/content-tree` → `{nodes, files}`:
  modules carry `description` (Brightspace landing-page HTML — render
  sanitized), link topics carry `url` (external open button).
- Brightspace HTML is raw → sanitize before dangerouslySetInnerHTML
  (src/lib/sanitize.ts, zero-dep DOMParser allowlist); react-markdown
  ESCAPES raw HTML, it is not a sanitizer.
- Mobile content viewer = one pane at a time: `.split.has-selection` swap
  (list ↔ viewer + "All topics" back link), scoped under
  `.split.split-mode-full` so side-by-side mode keeps both panes on
  desktop. The ≤860px media query forces one column for BOTH modes —
  `.split.split-mode-full, .split.split-mode-split { grid-template-columns:
  minmax(0,1fr) }` — because the mode class (0,2,0) beats a bare `.split`
  rule (0,1,0). Grid blowout guard: `.split > * { min-width: 0 }`,
  `.md table {display:block; overflow-x:auto}`.
- Per-kind chips derive from file PATH extension, shown for ALL files
  (pdf shows even unprocessed). GOTCHA: check md/markdown BEFORE the
  code-ext set or .md files get labeled 'code' (bit once in 8a376b7).
- Bottom nav = exactly Home/Courses/Chat (MOBILE_TABS in AppShell);
  Calendar/More/Sync have no tab but stay routable by URL — don't delete
  their routes. Sidebar (ee959bf): Home entry (was 'Today'), Recent Chats
  section with per-session delete buttons (session-delete, stopPropagation
  200px wide (`--sidebar-w`), styled EXACTLY like the cards (--glass-bg
  + border + --glass-shadow + backdrop-filter — computed styles match
  .card pixel-for-pixel, verified with a browser probe; the subagent's
  near-clear no-blur "zen" variant was REJECTED: Nate: "sidebar should use
  same styling as other panels" — match the existing panel treatment
  EXACTLY, never reinterpret a styling ask). Collapsed (62px): session
  titles/times/delete fully collapse — `.sidebar.collapsed .session-title/
  .session-time/.session-delete { width:0; flex:0 0 0; opacity:0;
  overflow:hidden }` — the original rule only hid `.side-label`, so the
  "just now" times leaked into the collapsed rail (e25168e: "when
  collapsed the side bar still shows recent chat times"). Flex children
  ignore `width:0` — you also need `flex:0 0 0; min-width:0`.
Course page (ee959bf + f815211): the header row = course code + term
chip + the tabs INLINE (Overview/Content/Assignments). The header is
PINNED — only `.course-scroll` scrolls. The course-SECTION split/full
toggle was REVERTED (f815211 — Nate: the toggle "was meant for the course
content view not the whole course section") — that toggle belongs to the
CONTENT tab's own viewMode (see the content-tree section below). The
Overview has NO page scroll: the announcements panel owns the scroll
internally (`.overview-body` > `.announce-card` > `.announce-scroll`,
overflow-y: auto) so Upcoming is ALWAYS visible without scrolling; the
announcement Show-more/less clamp is GONE — full bodies always
(`white-space: pre-wrap`). **The internal-panel scroll is the UNIVERSAL
rule, not an Overview quirk (e25168e — Nate: "you understood my scroll
intent for the overview but should also be applied to content and
assignments"): the VIEWPORT never scrolls on any tab — panels scroll
inside. Overview: `.overview-body` > `.announce-card` > `.announce-scroll`
(overflow-y auto). Assignments: `.assign-card` flex column +
`.assign-scroll` `overflow-y:auto`. Content: the tree card keeps its
NATURAL height with internal scroll (`.split-tree` `max-height:70vh;
overflow-y:auto`) — Nate REJECTED the viewport-filling stretch
(0fc4e32: "the content doesnt have to expand all the way to match the
height"; the `.split` flex:1 / grid-rows:minmax(0,1fr) /
align-items:stretch experiment was reverted to the plain 2-col grid).
The course header is TRANSPARENT (border-bottom only — the
`rgba(12,12,16,.72)` + blur background was removed: "remove the
styling behind header") and ONE LINE: code · term · name all inline
(`.course-head-name` inside `.course-head-title`, ellipsis — "make the
course code ... one line to make header more compact"). **The course
SplitPane is SWAPPED (0fc4e32 — Nate: "try swapping placements of chat
and course content"): left = the content PAGE, right = ChatView.**
When Nate asks for a scroll/layout treatment on one tab, apply the same
pattern across the whole surface the FIRST time — he will ask for it
everywhere anyway — BUT read his intent per-surface: he wanted Overview +
Assignments to fill-and-scroll-internally, while Content explicitly did
NOT need to fill the height.

**PDF auto-resize + full-width (0025eee — "the pdf doesnt auto resize.
also in full width pdfs should take full width of course viewport").** The
pdf-mode viewer must fill the course pane and the frame must follow. Three
CSS layers, each a classic pitfall: (1) the grid row `minmax(0,1fr)` gives
the row full height but `.split`'s `align-items: start` stops the ITEM from
stretching into it — the pdf-mode block must re-set `align-items: stretch`
(scoped with `.course-scroll:has(.split-viewer.pdf-mode) .split`); (2) an
iframe collapses to its DEFAULT 150px height when ANY ancestor in its flex
chain is a plain block — the frame sits inside `.pdf-zen` (a non-flex div),
so `flex: 1` on `.zen-pdf-frame` was silently ignored until
`.split-viewer.pdf-mode .pdf-zen { display:flex; flex-direction:column;
flex:1; min-height:0 }` was added; (3) full-width break-out — while a pdf
is open, `.course-scroll:has(.split-viewer.pdf-mode) > .page-col {
height:100%; max-width:none }` + `.course-scroll:has(...) { overflow:
hidden }` so the pdf spans the whole course pane instead of the 780px
column. Verified live: frame height tracks the pane (382px of a 544px
pane). **Tab + content-switch animations (0025eee — "add minimal
animations when switching course tab and when switching course
content"):** CourseLayout wraps `<Outlet />` in `<motion.div key={pathname}>`
(opacity 0→1 + y 6px, ~0.16s); the content viewer wraps ViewerBody in
`<motion.div key={nid ?? 'none'}>` (~0.15s fade). BOTH wrappers must carry
`style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}`
or the flex-filling children (`.overview-body`, `.assign-card`) stop
filling the pane — a plain keyed wrapper breaks the height chain
(display:contents also breaks framer-motion's opacity, since contents
elements have no box).

## Renaming a deployed project (2026-08-03, HippoCampus → campus)

Nate: "rename to campus. fits better than hippocampus or hippo... use
subagent to change all references." Worked with one subagent + parent
finishing leftovers. The discipline that kept the live system up:

- **Order:** (1) mechanical code/UI/docs rename (UI copy, package.json,
  PWA manifest name, SW cache VERSION bump, log/doc strings, *brand* file
  names + imports) → build + restart + verify + commit; (2) infra: rename
  the nix module + systemd service + docker container, move the repo dir,
  update the mount paths — ALL in ONE rebuild so the data-loss window is
  seconds (the running container keeps its detached bind mounts until the
  new one starts); (3) GitHub remote URL last.
- **The KEEP-list is the safety net — rename NEVER touches:** hostnames/
  URLs (school.home.lab, the ts.net PWA host), ports, data roots
  (/srv/homelab/school), token/config dirs (~/.hippocampus — renaming
  breaks Duo auth state), provider model ids (bifrost model strings are
  NOT branding), git identity, other services. Grep-verify after: leftover
  brand strings in code are OK; leftover REAL PATHS in the keep-list are OK
  — don't "fix" them.
- **Verification gates:** npm build passes → flake check passes →
  background nixos-rebuild completes → new container Up → every URL 200 →
  one SSE chat turn returns done. Stop + report on any failed gate.
- **/etc/nixos commit needs `sudo git`** (root-owned .git, see Container
  section); its remote is Forgejo nixos-config.git.
- **Skills + memory follow the rename** (paths, `docker exec campus`,
  `systemctl restart campus`) — the skills resolve by their old names, so
  rename the CONTENT, not the skill dirs.
- Subagents timed out twice on this class of work but had committed the
  core before stalling — on timeout check `git log/status` + served bundle
  hash first (see the parallel-subagents section).

## Parallel subagents on the shared repo (2026-08-03, issue-dump → deploy)

Nate's flow for a multi-bug batch: he drops an ISSUE DUMP → wants a plan
FIRST ("plan out before starting working on them. Use subagents where
useful") → then "start". The plan must be grounded in actual code reads
before proposing fixes — reading the data layer up front revealed module
landing HTML was ALREADY synced (content_nodes.description) and link URLs
were already stored, which shrank the backend scope to nearly zero. Present
the plan, wait for "start".

When dispatching parallel subagents on ONE shared repo (worked cleanly):

1. **Lock the contract first.** The API response shapes the frontend builds
   to must be fixed before dispatch (e.g. {content, format, rawUrl} with
   format ∈ markdown|html|code|pdf|download). Both briefs reference the
   exact same contract text; neither agent may change it.
2. **Split by directory, never by file.** Agent A owns api/ + sync/,
   Agent B owns web/. Both briefs say: `git add <your paths>` — NEVER
   `git add -A` (sweeps the other agent's uncommitted work into your
   commit); `git status --short` to confirm nothing outside scope staged;
   push after each commit, and on push rejection `git pull --rebase github
   main && push` (concurrent pushes WILL collide).
3. **Briefs must be self-contained** (subagents have no session memory):
   **AND the FULL brief text must be inlined — "see full brief in
   context" is a failure mode.** A subagent cannot read the parent's
   context, and session_search only indexes the subagent's OWN session DB
   (a recovery attempt for the parent's brief came up empty 2026-08-03).
   A terse summary leaves ambiguous items (e.g. "sidebar zen transparency
   fix") recoverable only by code archaeology — grep global.css for
   orphaned-but-styled classes and design-intent comments before
   guessing.
   **"'Same as X' means match X EXACTLY — the f815211 'everything was
   done but all wrong' round (2026-08-03).** The frontend subagent's
   brief said the sidebar should "use the same styling as other panels"
   — it REINTERPRETED the zen-transparency ask into a near-clear
   no-blur variant, and it put the split/full toggle on the course
   SECTION when Nate meant the CONTENT view. Both were wrong and got
   reverted. Lessons: (a) when a brief says "same as X / like the other
   panels", verify against the ACTUAL styled element — a browser probe
   comparing computed styles (background, blur, shadow) settles it
   before committing; (b) when a brief is ambiguous about WHERE a
   control goes, check whether a component already implements that
   concept — ContentPage ALREADY had a viewMode toggle (the real bug
   was a CSS class-name mismatch, not a missing toggle); (c) on a
   "everything was wrong" report, re-read each item against the live
   UI rather than defending the previous interpretation.
   repo path, git identity flags, scope + forbidden paths, the exact
   contract, the bug list verbatim, local verification commands
   (`.venv/bin/uvicorn` on 8090 for A — kill stale via ss first;
   `nix-shell -p nodejs_22 --run 'npm run build'` for B), and "the main
   agent deploys — do NOT restart the container yourself".
4. **Subagents hit iteration caps — check for leftovers.** Agent A
   committed FIX 1 but left FIX 2+3 modified-but-uncommitted when it ran
   out of iterations. After the batch completes: `git status --short`,
   REVIEW the actual diff (`git diff` — summaries are self-reports), then
   commit + push the leftovers yourself.
   **Harder variant (2026-08-03): the subagent hit the cap with NOTHING
   committed** — the working tree held 4 modified web/ files and
   build/deploy/verify/commit were ALL still undone (its summary said so
   explicitly, but trust the tree, not the summary). On any cap report:
   `git status --short` + `git diff` first, then finish the remaining
   items yourself (build → restart → verify bundle hash → commit web only
   → push), and re-dispatch only if the work genuinely isn't in the tree.
5. **Deploy + verify is the parent's job.** Rebuild web/dist if web changed
   (B did it itself), `sudo systemctl restart campus` (backend code is
   import-time), then verify the API contract via curl against
   127.0.0.1:8087. The browser tool refuses private/tailnet addresses, so
   school.home.lab UI verification is curl-level + the user's click-through.
6. Keep each agent's brief scoped so neither touches shared contract files
   mid-flight (types.ts lives with web/, services.py with api/).
7. **A subagent that reports TIMEOUT may still have finished the work.**
   2026-08-03: a chat-investigation subagent hit the 600s cap with no
   summary — but it had already committed (247874f), built, and restarted
   the container before stalling on its final call. On timeout: check
   `git log --oneline -3` + `git status --short` + the served bundle hash
   FIRST; verify the work with curl (headers, endpoint sequences) and only
   re-dispatch if the commit genuinely isn't there.

## Pitfalls

- **NixOS + Playwright:** pip-installed playwright chromium will NOT run
  (libstdc++/loader). Use `nix-shell` — `shell.nix` provides nixpkgs'
  playwright 1.59 + `PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright.browsers}`.
  Never `playwright install chromium` on NixOS (downloads unusable binaries;
  ~300MB wasted in ~/.cache/ms-playwright).
- **NixOS python lacks `_sqlite3`** — default `python3` is minimal. Use
  nix-shell python or `/nix/store/…-python3-3.13.13-env/bin/python3`.
- **config.yaml `~` and Path coercion** — YAML values stay strings and `~`
  isn't expanded. `Config.load()` must str→Path→expanduser. A token written
  to `~/campus/~/.campus/` is the failure mode (looks fine, wrong place).
- **Module naming:** use `python -m sync <cmd>` via `__main__.py` dispatcher —
  don't reference `sync.auth_cli` style names in docs/README.
- **Auth CLI saves token only on full success** — verify
  `~/.campus/token.json` mtime after auth; a killed/starved run loses it.
- **Digest model output must be coerced** — models invent categories outside
  the `memory_facts` CHECK constraint; coerce unknown → 'general', never crash
  the run. Parse strict JSON by slicing between first `{` and last `}`.
- **ON CONFLICT needs a real constraint** — announcements upsert uses
  `ON CONFLICT(brightspace_id)`; table needs a UNIQUE index. Partial unique
  indexes need the WHERE clause repeated in the conflict target — use a
  non-partial index (SQLite treats NULLs as distinct, so manual rows are safe).
- **PDF engine: local is DEFAULT again (2026-08-03 reversal).** The
  2026-08-01 "cloud only, do NOT re-add local" rule was REVERSED by Nate
  ("you can change back to local pdf extraction"). The pdf-extractor
  container now runs `PDF_ENGINE=local` — PP-OCRv6 CPU OCR, ~27s/page
  (big books = overnight jobs; cloud VLM was ~3s/page). History: local's
  sustained CPU load contributed to July host crashes → cloud became
  default → Nate later chose local anyway (no API credits). Lesson: Nate
  reverses engine decisions — before assuming which engine is live, check
  the running container (`docker inspect pdf-extractor --format
  '{{range .Config.Env}}{{println .}}{{end}}' | grep PDF_ENGINE`); the
  config home is `/etc/nixos/modules/server/pdf-extractor.nix`
  (`-e PDF_ENGINE=…` in the docker run). Per-request override also
  exists: `PUT /process?engine=auto|local|cloud`. Originals always kept
  beside the .md. (Historical cloud facts, now moot: engine=cloud with
  `VISION_MODELS=cohere/command-a-vision-07-2025,opencode-go/mimo-v2.5`
  at ~3s/page via bifrost.)
- **Extraction MUST be a detached process, never inline (2026-08-02).**
  The H1-era inline loop (`for row in unprocessed_files: extract_pdf(row)`
  inside the course loop, 600s timeout per file) made the sync look
  STUCK for 10 min × N PDFs — the single pdf-extractor VLM worker
  (mimo-v2.5, page-by-page) queues everything behind it, and the sync
  never reached the digest/ntfy/finish. This was the "what is takin so
  loong" bug. NOW: sync spawns `python -m sync extract` via
  subprocess.Popen(start_new_session=True, stdout→sync_logs/extraction.log)
  AFTER the digest; extract CLI pings ntfy once when done;
  `python -m sync extract --file <PATH>` wants the ABSOLUTE path under
  data_root (a relative path dies with "not in the subpath of
  '/srv/homelab/school'"); extract_pdf PUT timeout SCALES BY FILE SIZE (3600s for >2MB, else 120s). The old
  fixed 120s timed out the 148-page e-book, and the pdf-extractor DROPS
  the in-flight job when the requester disconnects — the "poll /api/jobs
  later and pull the payload" recovery pattern does NOT work, the job is
  simply gone; re-PUT with a long timeout instead (verified 2026-08-03:
  e-book extracted cleanly on the retry with tools/wait_ebook_extract.py
  as a dead end — its docker exec was SIGKILLed by a container restart,
  exit 137). A daemon thread is NOT enough — it dies with
  the CLI process; a detached subprocess survives. The pdf-extractor
  worker also self-wedges on its 148-page demo file at startup — check
  `/api/jobs` before assuming extraction is broken.
- **Host crashes corrupt git mid-write.** The homelab's hard resets zeroed
  git objects in this repo (empty object files, invalid sha1 pointer,
  "could not parse HEAD", "Error building trees"). Recovery: anchor on the
  last valid commit in `.git/logs/HEAD` (the reflog FILE survives; NUL
  bytes = crashed write), delete empty objects, repoint refs/heads/main,
  `rm -f .git/index && git add -A` (the index caches dead blob hashes),
  re-commit — the working tree preserves content, only the commit ID
  changes. Full procedure: nixos-homelab-workflow → "Git Object Corruption
  Recovery". Prevention: the GitHub remote (see above) — never let the repo
  be local-only again.
- **config.yaml password gets clobbered on rewrite** — happened TWICE when
  regenerating config.yaml (placeholder `password: PLACEHOLDER`). Restore
  from `/var/lib/brightspace-mcp-config/config.json` (sudo) and verify with
  `python -m sync auth --status` after any config.yaml write. The same
  pattern applies to config.example.yaml — keep the placeholder there, never
  write real secrets into it.
- **Commit as you go** — Nate said "commit as you go" (2026-07-31); keep the
  repo's working tree clean at the end of each work chunk, not one big commit.
  When a parallel agent owns api/ + sync/, stage ONLY your scope (`git add
  web`) — `git add -A` sweeps their uncommitted work into your commit; verify
  with `git status --short` that nothing outside your scope got staged.
- **An approval-denied command isn't a policy statement** — twice this session
  (nix-shell test, SQL DELETE) a security-scan denial was followed by "continue
  with what you were doing". The denial usually means he was away or reviewing,
  not that the operation is forbidden. After a denial: stop, report, and let
  him re-approve — don't treat it as a permanent ban.
- **Verification pattern:** bifrost doesn't log requests — to prove the AI ran,
  point at downstream effects (e.g. a CHECK-constraint error from the model's
  parsed output). User asked "did you actually run the ai? if so what model?".
- **Pipes mask exit codes** (cost a table): `nix-shell --run 'python x.py' |
  tail -5` — the pipeline's exit status is the LAST command (tail → 0), so a
  `&&` chain continues even when x.py crashed. The notes→files migration
  crashed on a dataclass error but the chained `DROP TABLE notes` still ran,
  dropping the table BEFORE the export. When exit status matters: check
  PIPESTATUS, or run the two commands separately.
- **Mutable defaults in dataclasses:** `term_dates: dict = {}` in the Config
  dataclass → `ValueError: mutable default ... use default_factory`. Use
  `field(default_factory=dict)`.
- **Dockerfile `&& … || true` swallows pip failures.** `RUN pip install …
  && playwright install … || true` — if pip fails, the layer still succeeds
  with NO packages installed (uvicorn missing → container crash-loop
  "uvicorn: not found" at runtime, looked like a bad image). Keep pip in
  its own RUN without the escape hatch; `|| true` only on genuinely-optional
  steps (playwright install-deps). Also prefer explicit single-source COPYs
  (`COPY requirements.txt ./`, `COPY api/requirements.txt ./api/…`) over
  multi-source `COPY a b ./` — a multi-source COPY silently missed
  api/requirements.txt once, failing pip at RUN time.
- **Brightspace enforced-content URLs need the browser SESSION, not the API
  token.** Image/PDF links inside html content use
  `/content/enforced/<orgUnit>-<code>/…` — fetched with the Bearer API token
  they return the app shell HTML (200) or a redirect to `/d2l/login` (302),
  never the file. The token only authorizes `/d2l/api/*`. Fix (2026-08-03,
  commit 43d81ab): `auth.py` captures the browser session cookies
  (`d2lSessionVal`, `d2lSecureSessionVal`, …) into
  `~/.campus/cookies.json` at auth time; `/api/proxy?url=…` sends them
  as the Cookie header (host allowlist: westernu.brightspace.com +
  s.brightspace.com; redirect-to-login → 502 "session expired — run auth").
  The frontend's sanitizer rewrites Brightspace img srcs through
  /api/proxy. Re-auth is SILENT when the persisted playwright profile still
  has a live session (no Duo push) — so refreshing cookies costs nothing.
  Full story: references/content-auth-proxy.md.
- **Content files come in TWO shapes — "Lecture Slides" are HTML shells
  linking to the real PDF (2026-08-03 investigation).** `files.kind='slide'`
  = real downloaded PDFs (extracted, viewable); `kind='other'` = Brightspace
  template HTML topic pages. The Lecture Slides family is a ~2.5KB template
  shell whose ONLY meaningful content is one
  `/content/enforced/<orgUnit>-<code>/…pdf` anchor (auth-gated — needs the
  session cookies via /api/proxy, NOT the API token); Unit Introduction /
  Instructor Contact pages have real content (images cached via
  /api/assets). Handling options (sync-time link-following vs serve-time
  link surfacing vs hybrid) + the announcements "cutoff" root cause
  (`course_hub()` hard-limits announcements `LIMIT 10` — all 24 ARE in the
  DB; the standalone endpoint supports limit up to 100): see
  references/brightspace-content-file-shapes.md.
- **URL-encoded filename twins cause duplicate file rows + mislinks.**
  The July-era sync saved files under raw `%20` names; the current sync
  writes decoded names — both rows exist with identical sha256, and a
  mislink followed (Unit 1's `Lecture%20Slides.html` ended up linked to
  Unit 6's topic → "unit 6 is a clone of unit 1"). Fix: `tools/dedupe_files.py`
  deletes encoded rows that have a decoded twin with the same sha256
  (run via `docker exec campus python tools/dedupe_files.py`). SQLite
  footgun: `LIKE '%\%%'` does NOT match literal % without an ESCAPE
  clause — use `instr(path, '%') > 0`.
- **`process kill` can orphan the server child** — killing the bash wrapper
  leaves uvicorn serving OLD code on the port; the new instance dies with
  "address already in use" (exit 3) and you debug against stale code (bit
  twice in one session). Before restarting: `ss -tlnp | grep <port>` → kill
  the real PID → confirm port free. Same class of bug as the host's git
  corruption: verify what's ACTUALLY listening, don't trust process bookkeeping.
- **A ro /app mount shadows the image's baked artifacts.** Anything
  gitignored in the mounted repo (web/dist) vanishes at runtime; if FastAPI
  mounts web/dist statically, the dist must exist on the HOST (build it
  there) or the mount must exclude that path.
- **SSE chat streams hang forever if the runner task dies.** The
  sse-starlette pattern (emit → asyncio.Queue → EventSourceResponse
  generator) only closes the stream when the runner puts None. If the
  blocking run_turn raises (bifrost 400, DB error), the to_thread raises,
  the runner never puts None, and the UI shows the message as
  "sending…" forever — backend logged 200, client saw nothing. Wrap the
  turn in try/except: emit an `error` event, THEN close the queue.
  Also: restarting uvicorn via `process kill` + relaunch silently leaves
  the OLD worker on the port (see process-kill pitfall) — you debug
  against pre-fix code; verify the listening PID's start time.
- **Frontend SSE parsers MUST be CRLF-aware.** sse-starlette emits frames
  separated by `\r\n\r\n` (not `\n\n`). The chat client split on
  `'\n\n'` — which never matches `\r\n\r\n` — so ZERO events were ever
  parsed while the backend streamed 700+ events (the user saw the request
  in bifrost, the UI saw nothing; "no indication of response" round 2,
  after the runner-hang had already been fixed). Split on
  `/\r?\n\r?\n/`, split lines on `/\r?\n/`, and JOIN multiple `data:`
  lines with `\n` per the SSE spec (don't let the last data line win).
  Verify the raw bytes with curl once (`curl -N` shows `\r\n` endings)
  before debugging anything else in a no-stream UI.
- **asyncio.Queue is NOT thread-safe — the emit-from-worker-thread burst
  (9463595).** The sse-starlette pattern runs run_turn in a worker thread
  (`asyncio.to_thread`) and the thread calls `queue.put_nowait` per event.
  That's a cross-thread queue write: events pile up corrupted/unwoken and
  the WHOLE response flushes in one burst when the turn ends — streaming
  looks completely dead (text appears only at the end) while bifrost shows
  the request streaming fine. Fix: capture `loop = asyncio.get_running_loop()`
  in the endpoint and emit via `loop.call_soon_threadsafe(queue.put_nowait,
  item)` (also for the terminating None). This was THE "no streaming"
  root cause — distinct from the CRLF parser bug and the runner-hang bug;
  all three present the same symptom (no live text) so check them in order:
  parser frame-splitting → runner exception → queue thread-safety.
  VERIFY STREAMING CORRECTLY: pipe `curl -N` LIVE into a timestamping
  script (timestamps at read time, not after), and use a LONG prompt
  (3-4 paragraphs) — a 5-word answer streams its 6 tokens in milliseconds
  and looks like a burst no matter what. Reading a completed file and
  stamping then measures nothing.
- **Caddy buffers SSE — `flush_interval -1` is the FOURTH streaming
  killer (2026-08-03, proxy.nix).** The server was fixed (queue
  thread-safety, verified 451 tokens over 9s on 127.0.0.1:8087) yet the
  user STILL saw no streaming — and a live timing test through
  school.home.lab showed 636 token events in 0.01s. The Caddy route
  `http://school.home.lab` (modules/server/access/proxy.nix) lacked
  `flush_interval -1` (other routes had it), so Caddy held the entire SSE
  body and flushed at the end. Fix: add `flush_interval -1` to that
  route's `reverse_proxy` block. RULE: when a stream is dead, test the
  SAME URL the user uses (through the proxy), not just the origin port —
  the proxy can be the buffer; the check order is now parser\n  frame-splitting → runner exception → queue thread-safety → reverse-proxy\n  buffering.\n- **Caddy cold-start burst (2026-08-03, rename day): one SSE run right\n  after a caddy container restart delivered ALL events in a single 0.13s\n  burst (1031 events at 13.37s), making the whole response appear at once;\n  re-tests minutes later through the SAME route streamed progressively\n  (654 events over 8.6s HTTP, 612 over 6.58s HTTPS). A single burst\n  measurement immediately after a proxy restart is a COLD-START ARTIFACT,\n  not a config regression — re-run the timing test (same long prompt,\n  timestamping reader) before touching the proxy config or the frontend.\n  Also: when the user reports \"all at once\", distinguish (a) proxy\n  cold-start burst, (b) short answers (a 5-word reply streams in\n  milliseconds — always test with a 3-4 paragraph prompt), (c) the\n  decoration-vs-render jank fixed by the zenMd debounce above, (d) the\n  four classic killers (parser/runner/queue/proxy), and (e) **model burst\n  delivery (2026-08-03, the FINAL root cause — ed23cf4 — later DISPROVEN; see the SUPERSEDED note below): bifrost's prompt\n  cache makes answer generation near-instant, so the whole answer arrives\n  as ONE ~13KB chunk while the reasoning phase streams progressively.**\n  Measured with a raw fetch probe in the browser: chunks at 2.2s / 5s,\n  then the entire answer in a single read at 9.2s. React then batches the\n  tokens+done events (same synchronous dispatch loop) into ONE render, so\n  the node is NEVER observed mid-stream — streaming flag or not, the UI\n  jumps 0 → full text. This is not a transport bug; no amount of\n  parser/proxy work fixes it. Fix: a **one-shot typewriter reveal in\n  ChatView** — keyed to the ARRIVAL of a new assistant message (its id),\n  NOT to the streaming flag (which bursts never show): animate\n  `content.slice(0, revealed)` 0 → len over ~2.2s via rAF
  (speed = max(700, len/2.2) chars/s — extends naturally if a slow stream
  keeps growing the content via a lenRef), cursor + the context-bar
  counter (`⟳ streaming N / total chars`) track the reveal, and the done
  the done state snaps to full text. Verified in a real browser: chars climbed
  97 → 302 → 512 → 717 → 937 → 1146 → 1310 over 2s. Any chat UI on this
  stack needs this reveal — later DISPROVEN — SUPERSEDED (156219d): the burst was the HARNESS's httpx buffering, not the model — see references/chat-v2.md → "Post-launch debug round 4". The typewriter reveal (ed23cf4) was built on this misdiagnosis and was REMOVED (7d6e893) after Nate rejected it ("isn't this worse?" → "remove it"): a synthetic reveal masks the symptom instead of finding the buffer. Rule: probe the PROVIDER directly (urllib streaming, per-delta timestamps) to attribute a burst — browser→API measurements include the harness.
  See references/chat-v2.md → \"Post-launch debug round 3\" + scripts/stream_probe.py.
- **The provider's `reasoning_content` passback check is STATEFUL and
  intermittently 400s a perfectly-formed request (2026-08-03, 8b04184 —
  the "Test" chat investigation).** Symptom: a turn dies mid-flight —
  thinking streams, tools complete (course_map results land in the tree),
  then NOTHING; the API logs `POST /api/chat 200` (the runner's error
  event went to the client), and the saved tree shows a truncated
  assistant node + tool nodes + no done. Provider error:
  `The reasoning_content in the thinking mode must be passed back to the
  API.` Repro/attribution recipe: (a) pull the session tree from
  `chat_sessions.nodes_json`; (b) rebuild the EXACT second call — history
  (role+content ONLY, as the frontend sends it — thinking is stripped),
  the assistant message with the REAL stored thinking + real tool_calls,
  the real tool results — and send it straight to bifrost; (c) it 400s on
  one attempt and PASSES on an identical re-send (provider-side cache
  state). Replaying the whole turn via the API with the real branch id
  also passes — the failure is transient, not structural. Fixes that must
  both be in: (1) `run_turn` retries `_model_call` up to FOUR attempts
  (3 retries, 1s/2s/3s backoff — 51cabc6; the user explicitly asked for
  "retry 3 times before giving up", log each retry, re-raise on the 4th)
  — a transient upstream failure must never kill a whole turn; (2) the
  client's `error` SSE branch renders a VISIBLE node
  — append `⚠ Stream failed: <message>` to the existing (partial)
  assistant content, or create a new assistant node with it — a
  status-line-only error was the reason "thinking and other stuff
  happened but no response rendered, even after reload" (the partial
  tree persisted). Corollary: a session tree with user node + truncated
  assistant + tool nodes and no ⚠ node = the pre-8b04184 silent error
  generated; regenerating the message now completes.
- **The `intermediate` flag hides tool-call answers — THE tool-call bug
  (2026-08-03, a9141ef, user-diagnosed).** Symptom: turns that call tools
  show Thinking + tool chips then NOTHING — no answer, no error, even after
  reload; non-tool turns are fine. Mechanism: the chat UX pass marks
  in-flight assistant messages `intermediate: true` on `tool_start` (to hide
  mid-turn narration blobs) and ChatView SKIPS intermediate assistant nodes
  (`if (node.role === 'assistant' && node.intermediate) continue`). But the
  FINAL answer streams into the SAME node (run_turn emits call-2 tokens via
  the same assistantId) and NOTHING ever cleared the flag — so every
  tool-call turn's answer was in the state and the DB (complete, saved) but
  skipped at render. Proof path (this session's decisive one): Playwright
  probe showed the stream completed (done received, assistantId set,
  reasoning chunks in console), localStorage held the FULL tree (user +
  assistant + tool + activeNodeId), yet the DOM showed only the user
  message — state right, render wrong → read the render path, found the
  skip. Temporary instrument that pinned it: render `data-debug` attribute
  with `{sid, activeNodeId, nNodes, path}` on chat-wrap — one rebuild later
  the live render state was visible in the DOM (path: [user, assistant] —
  the node was ON the path and still not rendered, proving the skip).
  Fix: clear `intermediate: false` in ALL terminal paths — the token
  handler (real content tokens mean the answer is back), the done handler,
  the error branch, AND `normalizeZombies`. Rule: any hide-mid-turn flag
  MUST be cleared on every terminal event (done/error) and on load
  normalization — and verify tool-call turns with a browser probe, not just
  curl (curl proves the SSE, not the render). **Final state (b776db4): the
  hide-on-tool_start marking was REMOVED entirely** — the assistant node
  stays visible during the tool phase so each tool chip renders LIVE as it
  starts (running spinner → done checkmark; parallel calls collapse to the
  "N tool calls" chip once all done; **since d89815c the chips render ABOVE
  the answer text — chronological, they ran before it**). The clears on token/done/error/load
  stay as defense for old persisted nodes. Browser-verified timeline:
  thinking at 1.6s → tool chips visible at 2.4s (mid-tool-phase) → answer
  streams at 4.9s.
- **EDIT-REWIND deletes the user message itself if `collectSubtree` is used
  raw (2026-08-03, d89815c — the "deleting a message makes the whole session
  disappear except the assistant's last message" bug).** `editMessage` computed
  `doomed = collectSubtree(nodes, nodeId)` — which INCLUDES the target node —
  then filtered it out of the session and re-sent the turn with the now-missing
  user node as the assistant's parentId: the path walked assistant → ghost
  parent → path `[assistant]` only, so the session appeared to collapse to just
  the new response. Fix: `doomed.delete(nodeId)` for REWIND (the user message
 survives, rewritten; only its DESCENDANTS die). Plain `deleteMessage`
 uses DIFFERENT semantics (since 607859f) — see the next pitfall.
 Whenever a subtree helper is shared
 between delete and rewind paths, check which side keeps the root.
 - **Delete = remove JUST the message + REJOIN the conversation; active
 branch falls back to a sibling; last message removes the session
 (2026-08-03, 607859f — Nate's edge-case dump: "deleting the user message
 wipes all history after it", "deleted the v2 which also made v1
 disappear but still there after sending a msg", "just look for edge
 cases").** His mental model: deleting a message removes THAT message,
 not everything it spawned. Old subtree-delete made him delete the
 assistant reply FIRST then the user message (two deletes per exchange)
 to avoid nuking the tail. New `deleteMessage`:
 (1) REJOIN — the deleted node's direct children with
 `role` user|assistant (excluding `intermediate`) re-parent to the
 deleted node's parent; the parent's `children` array swaps the deleted
 id for the rejoin ids; tool/intermediate children are ARTIFACTS and are
 deleted with their parent. Deleting a middle user message leaves every
 later message in the conversation (verified: 3-turn chat, deleted turn
 2's user msg → turns 1 + 3 with all replies intact).
 (2) SIBLING FALLBACK — when the ACTIVE node is deleted, fall back to the
 last remaining non-tool child of the parent BEFORE the parent itself:
 deleting a regenerated v2 shows v1 immediately (v1 was always in the
 tree — it just wasn't on the active path; it "reappeared after sending
 a message" because the next user node attached under the parent and the
 branch chips listed it). (3) EMPTY-SESSION — if the session ends with
 zero nodes, DELETE the session entirely (server + local), consistent
 with "only sessions with messages". Edge-case verification recipe (each
 one needs a real browser probe on a THROWAWAY session — never the
 user's real chats): delete middle user msg → later messages remain;
 regenerate → v2 → delete v2 → v1 visible; delete everything → session
 gone from the list. Probe gotcha: the regenerate button's title is
 "Regenerate (forks the conversation)" — `[title="Regenerate"]` exact
 match misses it; use `[title*="Regenerate"]`.
- **Session title: set when the session has ZERO nodes, not `isNew`
  (b776db4).** Sessions created via the "New chat" button kept the
  placeholder title forever — only inline-created sessions (first send with
  no session) were titled. Fix: `title: s.nodes.length === 0 ? text.slice(0,
  42) : s.title` in send()'s session update — title from the first user
  message regardless of how the session started.
- **"New chat" creates NO session until the first message (9b1b22d).**
  User: "pressing new chat will always create an empty chat session. only
  sessions with messages should be saved." newChat() no longer calls
  makeSession — it sets an activeMap sentinel (`''` for that course) and
  activeFor treats `''` as the EXPLICIT empty-chat state (returns null
  BEFORE the most-recent-session fallback, which still serves undefined
  keys after deletes). The session materializes in send()'s inline
  creation. Empty drafts never touch memory, the session list, or storage
  (persist + loadSessions also filter sessions with no non-tool nodes).
  The header New-chat button hides while the chat is already empty
  (`session && path.length > 0`).
- **Zombie nodes: a mid-turn reload/close persists an eternal "Thinking…"
  spinner (2026-08-03, 9219ffc).** Symptom: user reloads or closes the tab
  while a turn is still streaming → the fetch aborts (no catch/finally ever
  runs client-side) → the debounced save had already persisted the
  half-built tree: an assistant node with `thinking` set + `thinkingDone:
  false` + empty content. After reload that node renders "Thinking…" with a
  spinner forever — no done, no error, no normalization (the `.finally`
  fallback only fires when the stream actually ends). Diagnosis: pull the
  session tree from `chat_sessions.nodes_json` — a node with
  `thinking && !thinkingDone` is a zombie, not a live stream. Fix:
  `normalizeZombies()` applied in BOTH load paths (`loadSessions` for the
  localStorage cache and `toLocalSession` for server sessions) — any
  assistant node with `streaming` OR (`thinking && !thinkingDone`) becomes
  `streaming:false, thinkingDone:true`, and if content is empty gets the
  visible "⚠ The response was cut short (the page reloaded mid-turn). Try
  again." note. Corollary (the same investigation): a COMPLETED turn's
  thinking IS persisted in the tree — the user reported "no visible
  thinking" on a turn whose node had thinking 320 chars + thinkingDone:
  true; the small collapsed "Thought" chip was just too dim to notice
  (brightened var(--text-3) → var(--text-2)). Check the DB before assuming
  thinking was lost; completed turns show it under the chip (click to
  expand).
- **schema.sql changes DON'T retro-apply to the live DB (2026-08-03, chat
  tables).** The sync's DB init only creates tables on a FRESH database —
  `CREATE TABLE IF NOT EXISTS` never adds tables that appeared in schema.sql
  AFTER the live DB was created. The chat_sessions/chat_messages tables had
  existed in schema.sql for days but were MISSING from the live
  data/harness.db (the frontend never used session_id, so the INSERTs that
  would have crashed never ran — silent). After ANY schema.sql edit, apply
  it to the live DB explicitly:
  `docker exec campus python -c "import sqlite3; c=sqlite3.connect('data/harness.db');
  c.executescript(open('schema.sql').read()); c.commit()"` (all IF NOT EXISTS,
  idempotent). Verify with `PRAGMA table_info(<new table>)`.
- **Server-streams-but-UI-shows-nothing: a client-side diagnosis
  sequence (2026-08-03).** Symptom: user sends, sees only their message
  (or an empty slot), but bifrost logs show the agent worked AND the API
  access log shows `POST /api/chat 200`. Run in order: (1) container logs
  (`sudo docker logs campus --tail 30 | grep -v 'GET /'`) confirm the
  200; (2) reproduce with `curl -N` against the SAME host the browser
  uses — count events per type + the done payload; (3) confirm the SERVED
  bundle is the current build (`curl -s http://127.0.0.1:8087/ | grep -o
  'assets/index-[^"]*\.js'` and check that file exists in web/dist with
  today's mtime — a stale index.html serves an old bundle); (4) the site
  is plain `http://` per the Caddyfile so HTTP/2 is NOT in play (don't
  chase h2). If all server checks pass, the failure is client-side and
  SILENT — make it visible (⚠ error nodes, receivedDone flag, console
 errors, see the chat-v2 regression paragraph). Never debug a silent
 client failure by guessing: instrument first.
 - **Unguarded localStorage writes on the critical path kill sends SILENTLY
 (84ff6ee, "still doesnt work" round 4).** send() called `setLastCourse`
 → `localStorage.setItem` with NO try/catch between appending the user
 node and starting the stream. The per-token persist effect
 (`useEffect(persist, [sessions])` — runs on EVERY node update, i.e. every
 streamed token) had filled the ~5MB quota with the server-loaded session
 trees → setItem threw QuotaExceededError → send() aborted mid-flight →
 **no POST /api/chat ever left the browser** (container access log showed
 exactly ONE POST /api/chat total, while session POSTs/PUTs fired), busy
 stayed true (spinner forever, later sends blocked), NO error node (the
 stream never started so no catch/finally ran). DB fingerprint: the
 session's tree has the USER node only — no assistant node, no ⚠ node.
 Fixes that must ALL be in place: (a) try/catch around EVERY localStorage
 write (quota/security errors are non-fatal); (b) the persist effect skips
 while a stream is running (`if (busyRef.current) return` — the server is
 the live store now, localStorage is a cache); (c) the stream call comes
 before anything non-critical can throw. Rule: browser-storage writes
 NEVER sit on a critical path unguarded — a quota error must degrade to
 \"cache miss\", not \"feature dead\".
 - **Stale-bundle fingerprint: compare the CONSOLE's bundle hash to the
 served hash (2026-08-03, final round).** The user's console trace
 referenced `assets/index-CSYD4hz4.js` while the server served
 `assets/index-aSputqFv.js` (the latest build) — they had been testing
 OLD code with the very bugs being fixed. Caddy sends no cache-control
 headers and FastAPI StaticFiles serves index.html cacheable → browsers
 can pin a stale index.html (and thus a stale bundle) across reloads,
 and \"still doesn't work\" after every fix becomes true from the user's
 seat. When a user pastes console output, ALWAYS check its asset hash
 against `curl -s http://127.0.0.1:8087/ | grep -o 'assets/index-[^\"]*'
 \.js` + the dist mtime FIRST — if they differ, the report is about old
 code. Permanent fix (subagent deleg_dced6a92): `Cache-Control: no-store`
 on index.html (hashed assets can stay cached) + a visible build-version
 marker in the UI so both sides can confirm the live bundle.
 - **Prove streaming/render behavior with a Playwright probe INSIDE the
  container — the browser tool can't reach tailnet/private addresses, but
  the campus image has playwright + chromium (Duo auth).** This was the
  decisive instrument for the all-at-once rounds (2026-08-03): `docker cp
  scripts/stream_probe.py campus:/tmp/ && docker exec campus python
  /tmp/stream_probe.py`. Two modes (see the script): (1) DOM timeline —
  open /chat, click `button[title="New chat"]` (fresh sessions!), type a
  LONG prompt, sample `.msg-assistant .md` textContent every ~300ms →
  progressive char growth proves rendering, one jump proves a burst;
  (2) raw chunk timing — `fetch('/api/chat')` + `res.body.getReader()`
  recording `[t, bytes]` per read → isolates TRANSPORT buffering (Caddy/
  proxy: many chunks, all small) from MODEL burst delivery (one big final
  gotchas learned: `wait_until=
  'networkidle'` NEVER settles on this app (keep-alive/SSE) — use
  'domcontentloaded' + a fixed sleep; the main chat textarea has NO
  className (locate `.chat-input textarea` — `textarea.chat-input-area`
  is the edit-inline one, absent until you edit); a fresh browser profile
  has no localStorage → the chat tab auto-picks courses[0]; probe
  sessions pollute the DB — after probing, delete chat_sessions rows
  whose nodes_json matches your probe prompt/branch markers. **NEVER run
  destructive probes (delete/edit/rewind clicks) against the USER'S real
  sessions** — a repro of the delete/edit flows corrupted Nate's real
  'Hi' chat (deletes + rewind saves landed via the debounced PUT) and it
  had to be deleted; always `button[title="New chat"]` first and probe a
  throwaway session. Console
  capture (`page.on('console')` + `page.on('pageerror')`) is free and
  proves JS exceptions aren't the cause. When the DOM disagrees with the
  state (state has the nodes, DOM doesn't), temporarily render a
  `data-debug` attribute on the root element with `{sid, activeNodeId,
  nNodes, path}` — one rebuild + probe run later you can SEE the live
  render state in the DOM and tell whether the node is missing from the
  path (state bug) or being skipped at render (render bug). Remove the
  attribute before committing.
- **New FastAPI endpoints that `raise HTTPException` need the import
  (2026-08-03).** The session CRUD endpoints 500'd on missing rows —
 APIRouter) — the 404 branch existed but crashed when taken; the client's
 PUTs showed `500 Internal Server Error` in the console. After adding any
 endpoint that raises HTTPException, verify the import exists and TEST the
 missing-row path (PUT/DELETE a nonexistent id — expect 404, not 500).
 - **deepseek-v4-flash over-surveys open-ended questions.** "Explain a
 concept" cost 17 tool calls (incl. terminal_run abuse + redundant
  content_list_files after course_map). Fixes that worked: (a) new
  `course_map` tool — modules→topics→files (kind + extraction status) in
  ONE call; (b) prompt rules 9-11: course_map first, terminal_run ONLY
  for user-requested file ops (NEVER content — its description was
  rewritten to say so), "be decisive: course_map + at most 2-3 reads,
  5+ calls is too many". Result: 17 → 9 calls, no terminal abuse.
  Below that, the ceiling is the MODEL's tool planning, not the tools —
  further prompt tuning has diminishing returns; the next lever is a
  stronger chat model (bifrost_model in config.yaml) or accepting the
  count on open-ended questions.
- **Sync topic→file linkage (content_node_id) was NULL for all files.**
  The July-era sync never recorded which topic a file came from → UI
  showed "No file attached to this topic." Fixed in
  `_download_topic_file` (look up content_nodes by brightspace_id, pass
  to upsert_file; upsert COALESCEs it on re-sync) + `tools/backfill_
  linkage.py` for old rows (module-scoped prefix match: filename suffix
  is the UNIT number, not part of the title — "Unit Introduction2.html"
  is module 2's "Unit Introduction" topic; match parent dir → module →
  topic title prefix). New syncs also SKIP downloading when the topic
  already has a linked file on disk — the reason syncs went from minutes
  to seconds.
- **crypto.randomUUID only exists in secure contexts (HTTPS/localhost).**
  school.home.lab is plain HTTP, so the frontend threw `TypeError:
  crypto.randomUUID is not a function` on EVERY send — the "can't send
  messages" bug, invisible to the backend (200s in the logs). Fix in
  web/src/chat/ChatContext.tsx: `makeUuid()` falls back to a v4-style
  Math.random uuid. Any browser API gated on secure contexts (randomUUID,
  some clipboard/geolocation APIs) will fail on this deployment — grep for
  them when a UI feature dies silently on HTTP.
- **Playwright ENV order in Dockerfile:** `ENV
  PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` must come BEFORE `RUN
  playwright install chromium`, or browsers land in root's ~/.cache and
  runtime fails with "Executable doesn't exist at
  /opt/ms-playwright/.../chrome-headless-shell". Symptom: auth works on
  the host but `docker exec campus python -m sync auth` dies instantly.
- **sqlite `ON CONFLICT DO UPDATE` + rowcount lies:** `cur.rowcount` is 1
  for BOTH insert and conflict-update, so `upsert_announcement` returned
  is_new=True every sync → `announcements_new: 24` on every run, digest
  re-processed all announcements forever. Fix: select-first
  (`SELECT id ... WHERE brightspace_id=?` → UPDATE returns False /
  INSERT returns True), same as upsert_file/upsert_assignment. Any
  upsert whose is_new flag is derived from rowcount/lastrowid on a DO
  UPDATE upsert is broken.
- **Container process debugging footguns (slim image, cap-drop ALL):**
  - `ps` doesn't exist — scan `/proc/[0-9]*` for cmdline/comm.
  - `grep "sync sync" /proc/*/cmdline` matches the SHELL'S OWN cmdline
    (the pattern is in your script text) → `kill -9` kills the shell,
    exit 137. Match on `$p/comm` (python3) instead. Same trap when
    grepping `--port N` to find a test uvicorn — your own `sh -c` wrapper
    contains the string (bit twice in one session).
  - `pkill`/`kill`/`ss` binaries DON'T exist either (slim image) — kill by
    pid via `docker exec campus python -c "import os; os.kill(PID, 9)"`.
    Find the pid from `/proc/[0-9]*/stat` comm (`python3.12`) or the
    cmdline's `--port`, never by comm alone — the main CMD uvicorn (port
    8000) is also python3.12.
  - root with cap-drop ALL can't readlink another uid's /proc/PID/fd —
    use `docker exec --user 1000:100 campus sh -c ...` to inspect.
  - `process kill` on the host-side `docker exec` wrapper leaves the
    CONTAINER process orphaned and alive — kill by container pid.
  - Sync CLI output is block-buffered when redirected (docker exec >
    file): an EMPTY log ≠ hung process; DB progress (files linked,
    sync_runs) is ground truth. Use `python -u` when redirecting.
- **Test API changes with a throwaway uvicorn INSIDE the container.** The
  ro /app mount serves your host edits (no image rebuild), and the deployed
  uvicorn on 8000 stays untouched. `docker exec -d campus sh -c 'cd /app &&
  uvicorn api.main:app --host 127.0.0.1 --port 8091'` → hit it from inside:
  `docker exec campus curl -s http://127.0.0.1:8091/...` → kill the test pid
  when done (see footguns above). The container python has ALL deps
  (fastapi/uvicorn/httpx/playwright) — the reliable test interpreter even
  when the host `.venv` is broken (its python symlink points at a GC'd nix
  store path; the fallback nix python is minimal, no zlib/pip → pip can't
  even bootstrap). Don't burn time fixing the host venv mid-task; container
  testing is equivalent and read-only against prod state.
- **Find a "stuck" process with faulthandler, not guesswork.** The sync
  hang resisted log inspection for an hour (buffered output + 4 stacked
  bugs). The decisive tool:
  `python -c "import faulthandler, runpy, sys;
  faulthandler.dump_traceback_later(55, exit=True);
  sys.argv=['sync','sync']; runpy.run_module('sync', run_name='__main__')"`
  — dumps the full stack of the live process after 55s, pinpointing the
  blocking call (it was extract_pdf → httpcore socket read). Durable
  recipe: references/debugging-stuck-processes.md.
- **Fact staleness — created_at is NOT content date.** The backfill digest
  (2026-07-31) extracted facts from JANUARY announcements, so their
  created_at was "yesterday" — a TTL on created_at superseded nothing. The
  correct rule is TERM-based expiry: facts from courses whose term has ended
  (Western windows: 2026F = Sep 1–Dec 31; 2027W = Jan 1–Apr 30 of year+1)
  are superseded wholesale; time-sensitive categories (scheduling, exam,
  assignment, logistics, prof-note) additionally expire after 30 days;
  timeless ones (grading, course-policy, general) survive term-end only.
  `supersede_stale_facts()` runs before every card regen.
- **Relative dates are time-bombs in memory.** Digest extracted "install
  Unity before tomorrow's class" VERBATIM; "tomorrow" is false the next day.
  Digest prompt now has TIME RULES: resolve relative dates to absolute,
  convert ephemeral instructions to dated facts, SKIP passed-window facts.
  Card also filters: past-term courses show NO facts; DEADLINES section only
  shows due_at >= now; card STATE reads last COMPLETED sync (status in
  ok/partial), not the newest row (a stale 'running' row reads as current).
- **Honor "stop X" immediately.** When Nate says stop a job ("stop pdf
  parser"), kill it AND anything sharing the resource (the sync's extraction
  queue would have started parsing right after the backfill died) — then
  report exact state (what got killed, what's left unprocessed) and wait for
  new instructions before resuming.
- **Approval-denied commands = he's away, not a ban** (reconfirmed): keep
  working autonomously on approved work, summarize status, don't stall.
  When he returns he says "continue" and the same command is fine.
- **terminal_run tool (Phase 2):** blocklist patterns (sudo/su/docker/
  podman/nixos-rebuild/systemctl/journalctl/shutdown/reboot/mkfs/dd/chmod/
  chown/kill, `rm -rf /`, `\.campus` token paths, `config\.yaml`,
  `python -m sync auth`), write-class ops (rm/mv/cp/touch/tee/truncate/sed/
  echo) denied against `/content/`, workdir bounded under data_root,
  timeout 30s/120s, output cap 10KB, EVERY call audited (audit_log,
  entity=terminal, action=run/blocked/timeout). The container is the real
  security boundary; blocklist+audit are accident prevention + visibility.

## Working with Nate (workflow preferences, learned the hard way)

- **Don't mask a root cause with a synthetic UX effect (2026-08-03).** The
  typewriter reveal made burst-delivered answers look like streams; Nate
  called it out ("isn't this worse?") and had it removed ("remove it"). And
  when he insists the model streams ("there must be something wrong, the
  model streams its response over a good few seconds"), he is usually
  RIGHT — measure the provider directly before concluding the model
 misbehaves, then fix the actual buffer (it was the harness's buffered
 httpx client), not the perception. Same rule applies to his bug
 hypotheses: when he says "i think its an issue with tool calls", he was
 RIGHT (the `intermediate` flag hid every tool-call answer) — verify his
 suspicion with a probe against the real app BEFORE re-theorizing
 server-side.
- **Explain on request; implement on explicit "start"/"go".** Asked "tell me
  how it would work" → agent implemented instead; Nate: "i asked for an
  current implementation". When he asks HOW something works, walk through the
  existing code/design in depth — no code changes. "dont implement anything
  yet just plan" is a hard planning-only signal; "start" is the go word.
- **Major features get a written technical plan FIRST ("plan this out
  technically first", chat v2, 2026-08-03).** For a multi-part feature he
  wants a design doc committed to `docs/` (e.g. docs/chat-v2-plan.md —
  data model, backend contract changes, migration, UI, implementation
  order, risks) and a tight summary in the reply, then he says "start"
  and you build it. Don't skip the doc and go straight to code.
- **The agent harness is the product, not the UI.** Redirect: "what happened
  to the model harness and structuring the models context properly, giving
  it proper tools and actions? thats much more important than the web app."
  Context construction + tool registry + audited actions first; the web app
  is a thin shell over the same loop.
- **Answer design questions head-on, with an opinion** ("is DB vs workspace
  good?" → yes, with 4 concrete refinements; "is notes+facts+memory card too
  much?" → yes, cut notes to files). He wants honest critique of the design,
  not validation. When he asks for options ("what would be the best way to
  handle this? give me all options" — e.g. the lecture-slides-PDF question),
  enumerate the FULL option set with tradeoffs AND state a recommendation —
  he decides, but wants the complete menu first.

## Phase status

- H0 done (schema, seed 14 courses incl. pilot SE 2250B).
- H1 pilot sync: auth ✓, SE 2250B linked (orgUnit 155130) ✓, content/files/
  dropbox/news/syllabus ✓, extract ✓, **digest validated end-to-end**
  (24 announcements → 15 memory_facts + sync log via
  opencode-go/deepseek-v4-flash). Remaining: ntfy delivery confirm, Duo
  re-auth when token expires (1h TTL).
- **Code pushed to public GitHub** 2026-08-01 (`HasNate618/campus`,
  remote `github`, SSH; verified fac7aa5 remote == local).
- **Phase 0 DONE except backfill** (docs/BUILD_PLAN.md = canonical plan; 2026-08-01):
  loop timing 22/24 ✓, trawl web tools (search+read via MCP client) ✓,
  paginated reads ✓, audited file_write (replaces mutate_add_note) ✓,
  cloud-default extraction queue + auto-extract ✓ (engine=local REMOVED —
  its CPU load crashed the host), whole-sync ntfy (start + final
  breakdown; digest no longer pings per-phase) ✓, memory card + regen-on-diff
  hook ✓, class events from course_sessions (needs `term_dates` in config) ✓,
  notes→files migration DONE (notes table dropped from live DB; the one test
  note was lost in a pipe-exit-code mishap and recreated as a file) ✓,
  memory hygiene commit 042b1ca ✓ (details in Pitfalls). **Extraction
 backfill: "stop pdf parser" (2026-08-01) was about the runaway
 600s-inline-loop backfill, NOT a ban on extraction — the detached
 auto-extract path later processed the pilot PDFs and the 148-page
 e-book (2026-08-03) without complaint; run `python -m sync extract`
 freely via the detached queue.** Auth re-done 2026-08-01 (Duo
 approved, 1h TTL).
 - **Phase 1 DONE** (container): NixOS module `ai/campus.nix`, proxy network,
 uid 1000 (cap-drop ALL strips DAC_OVERRIDE — see Container section),
 Caddy school.home.lab stubbed, NO auth per Nate.
 - **Phase 2 DONE** (terminal tool): terminal_run tool verified inside the
 container (blocklist, content/ guard, audit; see Pitfalls).
 - **Frontend merged** (0ff034e): web/ + api/ + multi-stage Dockerfile from
 the workstation repo, history preserved.
 - **Phase 3 backend + deploy DONE** (454fe90, 13607b9): real services
   layer, SSE chat (tool_start/tool_end/token/done), chat persistence
   tables, background sync trigger, raw file serving; uvicorn in the
   container → 127.0.0.1:8087 → school.home.lab (HTTP 200 verified).
 - **2026-08-02 bug-fix marathon (all committed + pushed):** the sync
   "hang" (10min×N PDFs) was the H1 inline extraction loop — now a
   detached process (see Pitfalls); topic→file linkage backfilled 42/42
   (sync records content_node_id + tools/backfill_linkage.py); syncs now
   complete in seconds (skip-download fast path for linked topics);
   announcements_new honest (rowcount upsert quirk); crypto.randomUUID
   frontend fix (makeUuid) + new dist; playwright browsers re-baked at
   the right path (ENV order); auth works from inside the container.
   Open items: frontend session_id wiring, PDF viewer in the UI, Phase 4
   (OneDrive rclone mirror), Phase 5 (recordings), term_dates in config.
 - **2026-08-03 backend fixes (ac4a9f2 + b3e6b2c, deployed + verified):**
   SPA deep-link 404 — StaticFiles mount at "/" 404s non-file paths like
   /courses/1/content/2; replaced with GET / (index.html) + GET /{path:path}
   catch-all (real file under web/dist else SPA shell; /api misses 404;
   resolve+is_relative_to traversal guard). /api/files/{id}/content now
   returns the exact frontend contract {content, format: markdown|html|
   code|pdf|download, rawUrl} — pdf = extracted .md sibling + rawUrl always,
   html raw, code ext map, archives = download. Assignment descriptions:
   Western has NO /assignments/ endpoints; description comes from
   CustomInstructions.{Html,Text} on the dropbox list (see d2l-api.md) —
   populates on the NEXT sync, existing rows stay NULL until then.
   content-tree verified already passing full node rows
   (description/url/topic_type) — no change needed. Deployment after the
   batch: rebuild web/dist only if web changed, `sudo systemctl restart
   campus` (main.py is import-time code), then verify the API contract with
   curl (browser tool can't reach tailnet addresses — school.home.lab is
   private; the user does the visual pass).
 - **2026-08-03 frontend bug-fix pass (8a376b7, web/ only — api/sync are a
   parallel agent's scope):** mobile content viewer (clickable modules →
   sanitized landing-page HTML, link topics → external open button,
   per-format file rendering incl. iframe pdf viewer for unprocessed pdfs,
   kind chips for ALL files, one-pane-at-a-time mobile swap with "All
   topics" back), bottom nav trimmed to Home/Courses/Chat, course-card
   chips wrap at 360px, chat course picker scrollable + centered, announcement
   Show more/less clamp (REMOVED f815211 — full bodies always; the
   overview's announce panel scrolls internally). Patterns: references/frontend-web.md.
 - **2026-08-03 rendering pass (717f64d, 07c87eb, 43d81ab, deployed):**
   html images now render — session cookies captured at auth →
   /api/proxy fetches enforced-content images (Bearer token alone returns
   the app shell); URL-encoded duplicate file rows deduped (fixes the
   Unit 6→Unit 1 "clone" mislink); PDFs default to the original with a
   markdown toggle; content tree collapsible; zen-markdown-viewer
   rendering integrated (marked+highlight.js, .zen-md css). Reference:
   references/content-auth-proxy.md.
 - **2026-08-03 chat UX + tool-efficiency pass (committed, deployed):**
   (1) Mid-turn narration blobs — the model emits CONTENT between tool
   calls ("Let me check the unit intros...") which rendered as fake
   fake assistant answers; ChatContext marks in-flight assistant messages
   `intermediate: true` on tool_start AND ChatView skips any assistant
   message followed by a tool message (positional fallback). **UPDATE
   (a9141ef): `intermediate` is cleared on token/done/error/load — it was
   NEVER cleared before, which hid EVERY tool-call turn's final answer
   (state + DB complete, render skipped); see the Pitfalls entry.**
   is MERGED per turn: a closure buffer accumulates reasoning chunks
   (`turnThinking`), and the final answer's thinking block carries the
   whole turn — ONE "Thought" chip per turn, collapsed by default (click
   to expand; the streaming-auto-open behavior was rejected as noise).
   (3) Tool details were rendering `[object Object]` — the SSE result is
   a raw object; format with JSON.stringify(v, null, 2). (4) Spinner
   shows until the FINAL answer streams (intermediates/tools = still
   thinking). (5) course_map tool + rules 9-11 (see Pitfalls) cut
   open-ended question cost 17 → 9 calls. Open question for Nate: swap
   chat model (bifrost_model) vs accept flash's call count.
 - **2026-08-03 streaming + chat polish (9463595, deployed):** the "no
   streaming" report was REAL — asyncio.Queue.put_nowait from the worker
   thread isn't thread-safe → whole response flushed in one burst (fix +
   verify recipe in Pitfalls). Also: user messages aligned LEFT (missing
   display:flex on the motion wrapper, so align-self:flex-end never
   applied — any flex-item alignment dies when its wrapper isn't flex);
   chat markdown reverted to the site's .md styling (zen rejected in chat);
   MODEL SELECTOR shipped (see SSE-contract section). E-book extraction
   RESOLVED: the sync's fixed 120s PUT timed out on the 148-page VLM job
   and the pdf-extractor DROPPED it when the client disconnected (the
   wait-and-pull-from-/api/jobs attempt found the job gone — and the
   waiter's own docker exec was SIGKILLed by a container restart, 137).
   Real fix: extract_pdf timeout scales by size (3600s >2MB); re-PUT
   extracted the e-book cleanly (~25 min).
- Agent harness validated live (2026-08-01): grounded assignment answers
  with stale-data honesty, outline grading Q answered from extracted PDF
  with line cites, audited note+fact mutation verified in audit_log.
  Loop fixes that mattered: grep must return SNIPPETS (paths alone make the
  model grep forever), read_file .md-sibling fallback, and the "answer now"
  nudge at NUDGE_AT.

## References

- `references/d2l-api.md` — D2L REST endpoint quirks (version discovery format,
  UGRD enrollment codes, news CreatedBy int, filename encoding, pagination)
- `references/ms-entra-sso.md` — Playwright SSO automation (account picker,
  stay-signed-in deadlock, data-onclick, token extraction)
- `references/pdf-extractor-api.md` — pdf-extractor container API + cloud extraction queue (local engine removed 2026-08-01)
- `references/content-auth-proxy.md` — enforced-content auth (session cookies vs API token), /api/proxy, URL-encoded twin dedupe + mislink story
- `references/brightspace-content-file-shapes.md` — the two file shapes in the files table (real PDFs vs Brightspace template HTML shells), the Lecture Slides link-to-PDF pattern + handling options, the course-hub announcements LIMIT 10 cutoff, assignment-description sync status
- `references/zen-pdf-pipeline.md` — the REAL zen-pdf-viewer iframe integration (vendored pdf.js in web/public/zen-pdf/, ?file=&zen=&pageless= URL contract, superseded-port notes)
- `references/chat-v2.md` — the shipped message-tree chat (MsgNode store, fork/rewind/branch chips, reasoning cache per branch, done{answer,model,usage}, zenMd post-process; server-side storage round; the post-launch debug rounds incl. the burst-delivery root cause + typewriter reveal)
- `scripts/stream_probe.py` — Playwright streaming probe for the live app (run inside the container): DOM-timeline mode proves progressive-vs-burst rendering; chunks mode shows transport vs upstream burst patterns (to attribute a burst further, probe the PROVIDER directly — browser→API includes the harness; see chat-v2.md round 4)
