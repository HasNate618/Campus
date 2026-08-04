# Campus — Web UI (frontend rules, bug classes, verification)

Frontend of the campus app (repo `~/campus`, `web/` directory): React 19 +
Vite + TS PWA. Consolidates the `campus-web-ui` skill and the frontend
sections of the `campus` skill; verbatim originals in [archive/](archive/),
deep dives in [references/](references/).

## Build / deploy / verify loop

- Build: `cd web && nix-shell -p nodejs_22 --run 'npm run build'` — must end
  "✓ built". TS is strict (unused imports/vars fail the build; `noUnusedLocals`
  + `verbatimModuleSyntax` — use `import type`).
- Deploy: `sudo systemctl restart campus` (container). Backend code is
  import-time; the container is a bind mount of `~/campus` → `/app`, so
  python/tools edits are live immediately, restart only for uvicorn changes.
- Verify: `curl -s http://127.0.0.1:8087/ | grep -o 'assets/index-[^"]*\.js'`
  → the hash MUST change after a rebuild, else you tested a stale bundle.
- **Stale-bundle fingerprint:** compare the CONSOLE's bundle hash to the
  served hash FIRST when a user pastes console output. Caddy sends no
  cache-control and FastAPI StaticFiles serves index.html cacheable → browsers
  can pin a stale index.html. Permanent fix: `Cache-Control: no-store` on
  index.html (hashed assets can stay cached) + a visible build-version marker.
- Playwright is installed INSIDE the container; the browser tool can't open
  tailnet addresses. Probe: `docker cp /tmp/probe.py campus:/tmp/probe.py &&
  docker exec campus python /tmp/probe.py` (container /tmp is wiped on
  restart — always re-copy). API inside the container is on port **8000**
  (host-side 8087).
- A delegated subagent may hit its iteration cap with code written but
  UNbuilt/uncommitted — treat "cut off at the cap" as "uncommitted work in
  the tree": `git status` + read the diffs, finish the remaining items
  yourself, then build/deploy/verify/commit.

## THE user expectation that matters most: literal, minimal UI changes

Nate's UI change requests are LITERAL and MINIMAL. Implement exactly what is
asked — no sibling scope, no reinterpretation of styling intent. One session
lost three full rounds to over-interpretation ("everything was done but all
wrong"):

- "use the same styling as the other panels" → match the panels exactly (same
  bg/blur/shadow), do NOT invent "more transparent".
- "remove the buttons in the content tree" → remove exactly those; do NOT
  also remove the viewer's duplicate of one of them (he asked to restore it).
- "better padding" → he meant the chat viewport's distance from the edges,
  NOT message-bubble padding; reverting the extra changes was required.
- He iterates in fast correction loops: expect a checklist, then point-fixes.
  Each round touches ONLY the named items.
- When he asks "give me all options" (investigation questions), present
  options + a recommendation first; implement only after he picks.
- Layout mental model: the course viewport never scrolls — panels scroll
  internally; the course header stays pinned and is one compact line
  (code · term · name). When Nate asks for a scroll/layout treatment on one
  tab, apply the same pattern across the whole surface the FIRST time — but
  read his intent per-surface (Overview + Assignments fill-and-scroll-
  internally; Content explicitly did NOT need to fill the height).
- Detail-heavy lists = compact rows + click-through detail view: the LIST
  shows only a short line (title · due · status) and a dedicated single-item
  view on click (e.g. `/assignments/:id` route with the full description,
  rubric grid, and Brightspace button). Do NOT inline details into list rows.
- List grouping follows the dropbox CATEGORY TAGS (tags 'Labs', 'Projects',
  and untagged): untagged at the top with NO header, then one section per
  category tag (alphabetical). The team name ("Group 29") appears ONLY as the
  title prefix on group rows — never as a section header.
- Closed assignments: the folder's `Availability.EndDate` (when set and
  passed) marks it closed — that's Brightspace's clickable state. No dates =
  open forever. Closed rows: dimmed (opacity 0.55) + a muted "Closed" chip
  (checked BEFORE overdue); they stay clickable. Layout: closed items sink to
  a "Closed" SECTION at the BOTTOM; open items keep the tag sections above.
- Chat input spec (settled after iteration): shadcn-style — textarea on top,
  separate bottom toolbar row INSIDE the input container:
  [spacer][ctx-meter][model pill, popover expands UP + searchable][paperclip
  stub][send]. Context meter shows the REAL model window from bifrost's
  `context_length` (only ~42/136 models report one; deepseek does NOT — show
  `used/MAX` when known, `used` alone otherwise — never invent a limit).
- Design system = hand-rolled "dark glass" classes in src/styles/global.css
  (`.card/.chip/.btn/.split/.tree-*/.md/.tabbar/…`), NOT shadcn components —
  read global.css before writing UI. `@/*` → src/*.

## Chat message-tree bug classes (details in references/chat-frontend-edges.md)

1. **`intermediate` flag invisibility**: `tool_start` hid the assistant node
   as mid-turn narration and nothing cleared it → every tool-call answer was
   invisible while present in state/DB. Clear `intermediate` in ALL terminal
   paths (token/done/error/zombie-normalize); and never hide the node during
   tools or its chips hide too — render tool chips ABOVE the content.
   **Final state (b776db4): the hide-on-tool_start marking was REMOVED
   entirely** — the assistant node stays visible during the tool phase so
   each tool chip renders LIVE (running spinner → done checkmark; parallel
   calls collapse to the "N tool calls" chip once all done; since d89815c the
   chips render ABOVE the answer text — chronological). The clears on
   token/done/error/load stay as defense for old persisted nodes.
2. **Edit-rewind ghost parent**: `collectSubtree` includes the root → the
   rewind deleted the user message itself and the re-send streamed into a
   ghost parent (session collapsed to only the assistant reply). Fix:
   `doomed.delete(nodeId)`. Whenever a subtree helper is shared between
   delete and rewind paths, check which side keeps the root.
3. **Delete = REJOIN, not subtree-delete**: deleting a message removes that
   message; user/assistant children re-parent to the parent (middle-user-
   message deletes must not wipe later history); tool/intermediate children
   die with the node; deleting the active regenerated branch falls back to
   the remaining sibling (v1); deleting the last message removes the session.
4. **New chat = empty state, not a session**: activeMap sentinel `''`,
   session materializes on first message; persist/load drop empty sessions.
   Session title set when the session has ZERO nodes, not `isNew` (b776db4).
5. **Reasoning-content 400**: provider validation is stateful/transient —
   retry model calls 3× (1/2/3s backoff); on final failure emit a visible ⚠
   error node (never a silent status line).
6. **Zombie nodes** (mid-turn reload): normalize on load — stop streaming,
   mark done, append a visible "cut short" notice. A node with
   `thinking && !thinkingDone` is a zombie, not a live stream.
7. **TSX/CSS class-name contract**: components emitting `split-mode-fullWidth`
   while CSS defines `split-mode-full` silently disable the feature. Grep the
   CSS for the exact class names you emit — a toggle that 'does nothing' →
   verify emitted class names match stylesheet rules FIRST.
8. **zen-pdf-viewer shrink-refit**: vendored viewer.html `skipWhenZoomedIn`
   blocks re-fit after a shrink (old fit > new fit). Use a `userZoomed` flag
   set only by manual zoom keys.
9. **PDF iframe stuck at 150px = broken flex chain**: `flex: 1` on the frame
   is ignored unless EVERY ancestor is flex (`split-viewer` flex column →
   `.pdf-zen` flex column → frame `flex:1; min-height:0; height:auto`). Also:
   `align-items: start` on the `.split` grid stops items stretching into
   their row (pdf-mode needs `stretch` + `grid-template-rows: minmax(0,1fr)`).
10. **Full-width PDF breakout**: `.course-scroll:has(.split-viewer.pdf-mode)
    > .page-col { max-width: none }` + `overflow: hidden` — the `:has()`
    scoping pattern lifts the 780px column while a PDF is open. Probe
    `canvas.width` INSIDE the iframe to distinguish element-resize from
    content-resize. Full code-level detail: references/zen-pdf-viewer-pitfalls.md.

## Streaming / SSE facts (backend + frontend interplay)

- **SSE contract (in order):** `tool_start {tool, args}` · `tool_end {tool,
  result}` · `token {text}` · `done {answer}`. **Since 43a5abd:** gained
  `reasoning {text}` — chain-of-thought chunks emitted BEFORE tokens each
  iteration (bifrost streams it as `delta['reasoning']`, deepseek native as
  `reasoning_content`; agent/chat.py `_model_call` accumulates both into
  msg['reasoning'] AND msg['reasoning_content'] — the latter is the provider
  passback requirement, the former feeds the API reasoning cache and the UI
  thinking block). The `done` event grew to `{answer, model, usage}` (bifrost
  streams `usage` in the final chunk).
- Frontend: assistant msgs carry `thinking`/`thinkingDone`; tool msgs carry
  `turnId` for per-turn collapse; UI shows an expandable Thinking block
  (ONE "Thought" chip per turn, collapsed by default — the streaming-auto-
  open behavior was rejected as noise), a busy spinner, 'N tool calls'
  summary rows.
- **CRLF frames:** sse-starlette emits `\r\n\r\n` — split on `/\r?\n\r?\n/`.
- **Streaming-killer check order:** parser frame-splitting → runner exception
  → queue thread-safety → reverse-proxy buffering (Caddy `flush_interval
  -1`). Caddy cold-start burst = artifact, not regression.
- **Never fail silently (bdca860):** a stream failure or a stream that ends
  WITHOUT a `done` event renders a visible ⚠ message with the actual error
  (the `done` event sets a `receivedDone` flag checked in `.finally`);
  `streamChat` logs read failures to the console.
- **Unguarded localStorage writes on the critical path kill sends SILENTLY
  (84ff6ee):** send() → localStorage.setItem with NO try/catch; the per-token
  persist effect filled the ~5MB quota → QuotaExceededError → no POST ever
  left the browser, spinner forever, NO error node. Fixes: (a) try/catch
  around EVERY localStorage write; (b) persist effect skips while a stream
  is running (`if (busyRef.current) return` — server is the live store now);
  (c) stream call comes before anything non-critical can throw. DB
  fingerprint: session tree has the USER node only.
- **Busy flag must reset in `.finally`** (b8e0326) — the busy flag was set at
  send but NEVER reset (missing `.finally` on streamTurn) → Thinking spinner
  stuck on ALL chats. Rule: any async stream turn must reset its busy state
  in `.finally`, not in a success path.
- **Persist the active-session map** (bdca860) — after reload, sending
  created a FRESH session with no history; persist `hc.chat.active`
  alongside sessions.
- **Server-side sessions (2a71c8a + cac54b6):** message tree lives in
  `chat_sessions.nodes_json` (SQLite); localStorage (`hc.chat.sessions.v3`)
  is demoted to an offline cache (v2 → v3 migration automatic on load).
  Two empty-chat bugs followed: (a) first save loop SWAPPED the session id
  (uuid → server id) mid-stream — sessions carry a stable uuid plus a
  separate `serverId?: number`; (b) GET /chat/sessions list returned only
  id/title/updated but the client used it as the restore source → every chat
  reloaded empty. Rule: the client's LOAD path must receive everything the
  RENDER path needs; never change the identity an in-flight stream targets.
- **Model selector (9463595):** chat header model picker chip (CPU icon) —
  GET /api/chat/models proxies bifrost /v1/models (136 models); selection
  persisted in localStorage `hc.chat.model`, sent as `model` on every
  /api/chat request (ChatRequest.model → run_turn; null = config default).
  The picker lives in the chat INPUT (shadcn-style — textarea on top, its
  OWN `.input-toolbar` bottom row INSIDE the same container,
  `.chat-input` is `flex-direction: column`).
- **`crypto.randomUUID` only exists in secure contexts (HTTPS/localhost)** —
  school.home.lab is plain HTTP → `TypeError: crypto.randomUUID is not a
  function` on EVERY send ("can't send messages" bug, invisible to backend).
  Fix: `makeUuid()` falls back to a v4-style Math.random uuid. Any browser
  API gated on secure contexts will fail on this deployment.

## Zen rendering (markdown + PDF) — do not conflate the two repos

- **Nate's zen repos are TWO separate projects** (2026-08-03 gotcha: a
  subagent ported the wrong one):
  - `zen-markdown-viewer` (github.com/HasNate618/zen-markdown-viewer) =
    MARKDOWN rendering: marked + highlight.js, GitHub-dark typography
    (headings w/ border-bottom, blockquotes, tables, task lists), ported as
    `.zen-md` in styles/zen.css, transparent bg inside the app.
  - `zen-pdf-viewer` (github.com/HasNate618/zen-pdf-viewer) = PDF VIEWER:
    pdf.js PAGELESS CONTINUOUS SCROLL, transparent `.pageShell` wrappers,
    minimal dark toolbar, and the signature **Zen mode: a per-pixel
    luma-inversion pipeline** (dark-on-light → light-on-dark; paper detected
    per-page and dropped to TRANSPARENCY in pageless mode).
  When Nate says "zen rendering", ask WHICH repo if the target (markdown vs
  PDF) is ambiguous. **Nate rejects lookalike reimplementations** — use the
  real viewer/engine (embed the actual viewer.html with vendored deps + URL
  params, or port the exact pipeline with the reference's threshold
  constants and behavior); read the repo's AGENTS.md + viewer.html first.
- **PDF viewer policy (REVISED 4b128fb): original PDF by DEFAULT**, rendered
  by embedding the ACTUAL zen-pdf-viewer in an iframe —
  web/public/zen-pdf/viewer.html (pdfjs-dist@2.16.105 vendored locally, NO
  CDN) served statically at /zen-pdf/; ContentPage's `ZenPdfFrame` iframes
  it with src `/zen-pdf/viewer.html?file=<abs raw url>&zen=1&pageless=1&t=
  <file id>`. The old canvas reimplementation (PdfViewer.tsx + zenPdf.ts) is
  DELETED. "View extracted text" toggle renders the markdown via ZenMarkdown.
  PDFs render full-bleed on a TRANSPARENT zen surface (`.pdf-zen`) — the
  github-dark `#0d1117` background was removed at Nate's request. See
  web/public/zen-pdf/README.md for the vendoring + param contract.
- **Markdown rendering = ZenMarkdown** (web/src/lib/ZenMarkdown.tsx +
  styles/zen.css). **Since 4a8c2df BOTH chat ChatMd and content ZenMarkdown
  run the shared `zenMd.tsx` post-process** (web/src/lib/zenMd.tsx): mermaid
  fences → lazy-imported dark-theme SVGs with click-to-zoom overlay; code
  blocks get a `.code-header` bar with a copy button; elements tagged
  `data-zen-processed` so per-token streaming re-runs never duplicate.
  **Streaming-smoothness fix:** the heavy DOM scanning inside
  useZenPostProcess is trailing-debounced (~250ms) — decoration work must
  never run at render frequency during token streaming. Amendment (d89815c):
  the effect runs after EVERY render (no deps array — the internal 250ms
  debounce keeps it cheap) so re-renders that RESET the message DOM get
  re-decorated.
- **Chat markdown uses the SITE's `.md` styling (ChatMd, marked-based) — NOT
  ZenMarkdown.** Nate rejected zen in chat ("assistant markdown no longer
  styled like the rest of the site"); zen is CONTENT-VIEWER only.
- **User-reported .md regressions fixed in global.css (d89815c):** headers
  render at normal weight — `.md h1-h4` needs explicit `font-weight: 700`;
  bullets vanish — a global `list-style: none` reset kills them, so `.md ul
  { list-style: disc }` / `.md ol { list-style: decimal }` must be set
  explicitly; tables stretch full-width — `width: auto; display:
  inline-table; max-width: 100%`. Any future .md restyle must keep these
  three. react-markdown is no longer used for content.

## Content tree / viewer state (settled after many reversals)

- Content tree is COLLAPSIBLE: per-module chevron collapse
  (`.tree-module.collapsed`). **REMOVED ENTIRELY (0fc4e32): the content view
  has NO view toggle and NO collapse-all buttons in the TREE header** — it
  is FIXED single-pane (`split-mode-full` always; per-module chevrons still
  collapse modules). **BUT the VIEWER header (next to "All topics") KEEPS its
  view-mode toggle** (Columns2/Maximize2 icon, title="Show the content tree
  beside the viewer") with viewMode state + `hc.content.viewMode`
  persistence (0025eee — Nate: "you removed the other toggle view button,
  not just the one in the content tree. restore the other."). Rules: (a) a
  control that changes the content view must live in always-visible chrome,
  not in a panel that the mode hides; (b) when Nate asks to REMOVE a
  control, check EVERY instance of it first. `.split-mode-full` = single
  panel (grid ALWAYS `minmax(0,1fr)` so the tree spans the row when nothing
  is selected — no empty gutter); `.split-mode-split` = 300px tree + viewer
  side-by-side. The old Hide-tree button + `.split.tree-hidden` CSS are GONE.
- Content tree endpoint: `/api/courses/{id}/content-tree` → `{nodes, files}`:
  modules carry `description` (Brightspace landing-page HTML — render
  sanitized), link topics carry `url` (external open button).
- Brightspace HTML is raw → sanitize before dangerouslySetInnerHTML
  (src/lib/sanitize.ts, zero-dep DOMParser allowlist; react-markdown ESCAPES
  raw HTML, it is not a sanitizer). Brightspace html `<img>` srcs are
  rewritten through `/api/proxy?url=…` (proxifyUrl) — direct img tags 401
  without a Brightspace session.
- Mobile content viewer = one pane at a time: `.split.has-selection` swap
  (list ↔ viewer + "All topics" back link), scoped under
  `.split.split-mode-full` so side-by-side mode keeps both panes on desktop.
  The ≤860px media query forces one column for BOTH modes (the mode class
  (0,2,0) beats a bare `.split` rule (0,1,0)). Grid blowout guard:
  `.split > * { min-width: 0 }`, `.md table {display:block; overflow-x:auto}`.
- Per-kind chips derive from file PATH extension, shown for ALL files (pdf
  shows even unprocessed). GOTCHA: check md/markdown BEFORE the code-ext set
  or .md files get labeled 'code' (bit once in 8a376b7).
- Bottom nav = exactly Home/Courses/Chat (MOBILE_TABS in AppShell);
  Calendar/More/Sync have no tab but stay routable by URL — don't delete
  their routes. Sidebar: Home entry (was 'Today'), Recent Chats section with
  per-session delete buttons (session-delete, stopPropagation).
- Course SplitPane (0fc4e32): left = the content PAGE, right = ChatView.
  Course page header row = course code + term chip + tabs INLINE
  (Overview/Content/Assignments); header PINNED — only `.course-scroll`
  scrolls; TRANSPARENT (border-bottom only) and ONE LINE (code · term · name
  inline, ellipsis).
- Overview has NO page scroll: `.overview-body` > `.announce-card` >
  `.announce-scroll` (overflow-y: auto); announcement Show-more/less clamp is
  GONE — full bodies always (`white-space: pre-wrap`).
- Tab + content-switch animations (0025eee): CourseLayout wraps `<Outlet />`
  in `<motion.div key={pathname}>` (opacity 0→1 + y 6px, ~0.16s); content
  viewer wraps ViewerBody in `<motion.div key={nid ?? 'none'}>` (~0.15s
  fade). BOTH wrappers must carry `style={{ flex: 1, minHeight: 0, display:
  'flex', flexDirection: 'column' }}` or flex-filling children stop filling
  the pane (display:contents also breaks framer-motion's opacity).

## Backend/sync data shape (what the UI renders)

- Brightspace descriptions are {Text, Html} — store the Html (tables,
  banners, hyperlinks only survive there). Image srcs in content are
  RELATIVE `/content/enforced/...` paths — cache_images must resolve them
  against `cfg.base_url`. Assignment descriptions only exist for ~8/20
  dropbox folders (CustomInstructions) — a data ceiling, not a bug.
- Unit banners: Brightspace keeps them inside the Unit Introduction topic —
  surface ONLY the extracted `<img>`s inline on the module page; rendering
  the whole intro clones its text into the section (user-reported bug).
- Assignments rows: each row carries a Brightspace dropbox ExternalLink
  (`url` field); sort dated-first, no-due LAST (localeCompare on '' put
  no-due on top).
- Assignment rubrics: D2L ships the FULL rubric inside each folder's
  `Assessment.Rubrics` (15/20 folders have one). Sync stores `rubrics_json`,
  API parses to `rubrics`, the assignment DETAIL view renders a
  levels-as-columns grid (the old per-row "Rubric" toggle was removed — the
  grid lives only on `/assignments/:id`).
- Folder metadata beyond rubrics: `CategoryId` → /dropbox/categories/ names;
  `GroupTypeId` → lp groupcategories names (use `client.lp()` — absolute
  URLs silently break); `Attachments` [{FileId, FileName, Size}] —
  **downloaded during sync** to `course/Assignments/<folder name>/<file>` and
  served via `/api/assets`; `Assessment.ScoreDenominator` = points (matches
  gradebook MaxPoints); `Availability`. All synced into
  category/group_category/points/attachments_json/availability_json and
  shown on the assignment DETAIL page (list stays compact). The user's TEAM
  name ("Group 29") comes from `lp /groupcategories/{id}/groups/` matched
  against `lp /users/whoami` — **whoami Identifier is a STRING, group
  Enrollments are INTs: stringify both sides or the match silently fails**
  (course_groups stays empty, zero errors). Per-user scores/completion are
  instructor-gated (submissions 403, grade values 403) — say so instead of
  chasing them. **When auditing what an API provides, dump the FULL object —
  a filtered key list once made the operator miss all of this.**
  Detail: references/brightspace-sync-data-shape.md.
- `/api/files/{id}/content` contract: `{content, format, rawUrl}`, format ∈
  markdown|html|code|pdf|download; rawUrl → `/api/files/{id}/raw` (usable in
  an `<iframe>`). pdf: content = extracted markdown if processed else ''.
- AI access to assignments (content parity): `harness_list_assignments`
  returns full metadata (description, points, category, group + team name,
  closed, rubric names, attachment names+local paths, url) + an
  `assignment_id` detail mode; downloaded attachments are registered in
  `files` (kind='assignment') so the AI lists them and PDFs extract →
  readable via content_read_file.
- Sync ops: `/api/sync/trigger` does NOT re-auth — run
  `docker exec campus python -m sync.auth` first (Duo push), then trigger;
  check `sync_runs` for the real outcome. DB is `/app/data/harness.db`
  (standalone scripts resolve a nonexistent /srv path — pass it explicitly).
- **Why Duo pushes stop appearing** (`sync/auth.py`): the flow uses
  `launch_persistent_context(user_data_dir=cfg.browser_profile_dir)` +
  `storage-state.json`, clicks Microsoft's "Stay signed in?", and the profile
  carries the SSO + Duo remember-me cookies — so every auth after the first
  reuses the session and MFA auto-completes with NO push. This is the
  FEATURE that makes unattended syncs work, not a bug. To force a real push:
  wipe the auth profile dir, or test in a private window. Answer "why no
  Duo?" with this — don't chase a broken Duo app.
- Token/cookies live at `~/.hippocampus/` (verified: auth writes
  `/home/nate/.hippocampus/token.json`) — the operations doc's `~/.campus/`
  is the older naming; the `~/.hippocampus` path is the truth (renaming it
  breaks Duo auth state).

## Verification habits

- Computed-style probes (`getComputedStyle`) beat text probes for layout bugs.
- Headless Chromium reports `backdrop-filter: none` even when the rule
  applies — compare the same property on a known-good sibling (e.g. `.card`).
- `.msg-actions` is a SIBLING of `.msg-user`/`.msg-assistant`, not a child —
  selectors must use `parentElement`.
- Hidden flex elements keep width unless `flex: 0 0 0; min-width: 0` (the
  collapsed-sidebar "just now" times probe).
- If the user reports the chat showed "thinking then nothing": check the
  message-tree flags first (intermediate/streaming/thinkingDone), then the
  provider retry logs, then the render path — in that order.
- **Prove streaming/render behavior with a Playwright probe INSIDE the
  container** (scripts/stream_probe.py): (1) DOM timeline — open /chat, click
  `button[title="New chat"]` (fresh sessions!), type a LONG prompt, sample
  `.msg-assistant .md` textContent every ~300ms → progressive growth proves
  rendering, one jump proves a burst; (2) raw chunk timing — `fetch('/api/chat')`
  + `res.body.getReader()` recording `[t, bytes]` per read → isolates
  TRANSPORT buffering from MODEL burst delivery. Gotchas: `wait_until=
  'networkidle'` NEVER settles on this app (keep-alive/SSE) — use
  'domcontentloaded' + fixed sleep; the main chat textarea has NO className
  (locate `.chat-input textarea`); a fresh browser profile has no
  localStorage → the chat tab auto-picks courses[0]. **NEVER run destructive
  probes (delete/edit/rewind clicks) against the USER'S real sessions** — a
  repro of the delete/edit flows corrupted Nate's real 'Hi' chat; always
  `button[title="New chat"]` first. Probe sessions pollute the DB — delete
  chat_sessions rows matching your probe markers afterward. Console capture
  (`page.on('console')` + `page.on('pageerror')`) is free and proves JS
  exceptions aren't the cause. When the DOM disagrees with the state,
  temporarily render a `data-debug` attribute with `{sid, activeNodeId,
  nNodes, path}` — remove before committing.
- Probe TZ pitfall: headless Chromium inside the container runs UTC — due
  dates render as UTC wall-clock in probes and look off-by-hours; the user's
  browser converts to local correctly. Judge by `new Date(s)` semantics, not
  the probe's rendered text.
- Server-streams-but-UI-shows-nothing diagnosis order: (1) container logs
  (`sudo docker logs campus --tail 30 | grep -v 'GET /'`) confirm the 200;
  (2) reproduce with `curl -N` against the SAME host the browser uses; (3)
  confirm the SERVED bundle is the current build (hash + dist mtime); (4)
  the site is plain `http://` per the Caddyfile so HTTP/2 is NOT in play.
  If all server checks pass, the failure is client-side and SILENT — make it
  visible (⚠ error nodes, receivedDone flag, console errors). Never debug a
  silent client failure by guessing: instrument first.

## Parallel subagents on the shared repo (issue-dump → deploy)

Nate's flow for a multi-bug batch: he drops an ISSUE DUMP → wants a plan
FIRST ("plan out before starting working on them. Use subagents where
useful") → then "start". The plan must be grounded in actual code reads
before proposing fixes (reading the data layer up front shrank a backend
scope to nearly zero). Present the plan, wait for "start".

When dispatching parallel subagents on ONE shared repo:

1. **Lock the contract first.** The API response shapes the frontend builds
   to must be fixed before dispatch. Both briefs reference the exact same
   contract text; neither agent may change it.
2. **Split by directory, never by file.** Agent A owns api/ + sync/, Agent B
   owns web/. Both briefs say: `git add <your paths>` — NEVER `git add -A`
   (sweeps the other agent's uncommitted work into your commit); `git status
   --short` to confirm nothing outside scope staged; push after each commit,
   and on push rejection `git pull --rebase github main && push`
   (concurrent pushes WILL collide).
3. **Briefs must be self-contained** (subagents have no session memory): the
   FULL brief text must be inlined — "see full brief in context" is a
   failure mode. Include repo path, git identity flags, scope + forbidden
   paths, the exact contract, the bug list verbatim, local verification
   commands (`.venv/bin/uvicorn` on 8090 for A — kill stale via ss first;
   `nix-shell -p nodejs_22 --run 'npm run build'` for B), and "the main agent
   deploys — do NOT restart the container yourself".
   **"'Same as X' means match X EXACTLY"** — when a brief says "same as X /
   like the other panels", verify against the ACTUAL styled element (browser
   probe comparing computed styles) before committing; when a brief is
   ambiguous about WHERE a control goes, check whether a component already
   implements that concept; on a "everything was wrong" report, re-read each
   item against the live UI rather than defending the previous
   interpretation.
4. **Subagents hit iteration caps — check for leftovers.** After the batch:
   `git status --short`, REVIEW the actual diff (`git diff` — summaries are
   self-reports), then commit + push the leftovers yourself. Harder variant:
   the subagent hit the cap with NOTHING committed (working tree held
   modified files, build/deploy/verify/commit all undone) — on any cap
   report: `git status --short` + `git diff` first, then finish the remaining
   items yourself (build → restart → verify bundle hash → commit web only →
   push), re-dispatch only if the work genuinely isn't in the tree.
5. **Deploy + verify is the parent's job.** Rebuild web/dist if web changed,
   `sudo systemctl restart campus`, then verify the API contract via curl
   against 127.0.0.1:8087. The browser tool refuses private/tailnet
   addresses, so school.home.lab UI verification is curl-level + the user's
   click-through.
6. Keep each agent's brief scoped so neither touches shared contract files
   mid-flight (types.ts lives with web/, services.py with api/).
7. **A subagent that reports TIMEOUT may still have finished the work.** On
   timeout: check `git log --oneline -3` + `git status --short` + the served
   bundle hash FIRST; verify the work with curl and only re-dispatch if the
   commit genuinely isn't there.

## Frontend architecture map

Vite 8 + React 19 + react-router-dom 7 + Tailwind v4 + framer-motion +
react-markdown; `@/*` → src/*. Full architecture, contracts, and patterns:
references/frontend-web.md. When working web/ only: `git add web` (NEVER
`git add -A`), commit describing only your scope, `git push github main`.
Nate owns frontend scope; api/ + sync/ belong to a parallel agent.
