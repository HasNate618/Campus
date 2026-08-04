# Archived original skill body — consolidated into campus-web-ui.md
# Source: Hermes homelab profile skill `campus-web-ui` (homelab/campus-web-ui), archived 2026-08-04


# Campus Web UI

Frontend of the campus app (repo `~/campus`, `web/` directory). The cross-profile
`campus` skill covers the whole system; THIS skill holds the frontend-specific
rules, the user's UI expectations, and the recurring bug classes — so any UI
session starts already knowing them.

## Build / deploy / verify loop
- Build: `cd web && nix-shell -p nodejs_22 --run 'npm run build'` — must end
  "✓ built". TS is strict (unused imports/vars fail the build).
- Deploy: `sudo systemctl restart campus` (container).
- Verify: `curl -s http://127.0.0.1:8087/ | grep -o 'assets/index-[^"]*\.js'`
  → the hash MUST change after a rebuild, else you tested a stale bundle.
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
  (code · term · name). PDFs in full-width mode span the whole course pane.
- Detail-heavy lists = compact rows + click-through detail view: when a list
  item carries lots of content (descriptions, rubrics, links), Nate wants
  the LIST to show only a short line (title · due · status) and a dedicated
  single-item view on click (e.g. `/assignments/:id` route with the full
  description, rubric grid, and Brightspace button). Do NOT inline details
  into list rows.
- List grouping follows the dropbox CATEGORY TAGS (Nate corrected the
  group-vs-individual split — "not really what i was expecting. there are
  tags 'Labs', 'Projects', and those without group tag"): untagged
  assignments at the top with NO header, then one section per category tag
  (Labs, Project — alphabetical). The team name ("Group 29") appears ONLY
  as the title prefix on group rows ("Group 29: Project Task 1", list AND
  detail) — never as a section header.
- Closed assignments: the folder's `Availability.EndDate` (when set and
  passed) marks it closed — that's Brightspace's clickable state. No dates
  = open forever (Lab 2 was the only open lab). Closed rows: dimmed
  (opacity 0.55) + a muted "Closed" chip (checked BEFORE overdue); they
  stay clickable — the detail view still holds the rubric. Layout: closed
  items sink to a "Closed" SECTION at the BOTTOM of the list; the open
  items keep the tag sections above it (untagged → Labs → Project →
  Closed).
- Chat input spec (settled after iteration): shadcn-style — textarea on top,
  separate bottom toolbar row INSIDE the input container:
  [spacer][ctx-meter][model pill, popover expands UP + searchable][paperclip
  stub][send]. Context meter shows the REAL model window from bifrost's
  `context_length` (only ~42/136 models report one; deepseek does NOT — show
  `used/MAX` when known, `used` alone otherwise — never invent a limit).

## Chat message-tree bug classes (details in references/chat-frontend-edges.md)
1. **`intermediate` flag invisibility**: `tool_start` hid the assistant node
   as mid-turn narration and nothing cleared it → every tool-call answer was
   invisible while present in state/DB. Clear `intermediate` in ALL terminal
   paths (token/done/error/zombie-normalize); and never hide the node during
   tools or its chips hide too — render tool chips ABOVE the content.
2. **Edit-rewind ghost parent**: `collectSubtree` includes the root → the
   rewind deleted the user message itself and the re-send streamed into a
   ghost parent (session collapsed to only the assistant reply). Fix:
   `doomed.delete(nodeId)`.
3. **Delete = REJOIN, not subtree-delete**: deleting a message removes that
   message; user/assistant children re-parent to the parent (middle-user-
   message deletes must not wipe later history); tool/intermediate children
   die with the node; deleting the active regenerated branch falls back to
   the remaining sibling (v1); deleting the last message removes the session.
4. **New chat = empty state, not a session**: activeMap sentinel `''`,
   session materializes on first message; persist/load drop empty sessions.
5. **Reasoning-content 400**: provider validation is stateful/transient —
   retry model calls 3× (1/2/3s backoff); on final failure emit a visible ⚠
   error node (never a silent status line).
6. **Zombie nodes** (mid-turn reload): normalize on load — stop streaming,
   mark done, append a visible "cut short" notice.
7. **TSX/CSS class-name contract**: components emitting `split-mode-fullWidth`
   while CSS defines `split-mode-full` silently disable the feature. Grep the
   CSS for the exact class names you emit.
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

## Backend/sync data shape (parked here — campus skills are cross-profile
## read-only from this profile; curator may relocate)
- Brightspace descriptions are {Text, Html} — store the Html (tables,
  banners, hyperlinks only survive there). Image srcs in content are
  RELATIVE `/content/enforced/...` paths — cache_images must resolve them
  against `cfg.base_url`. Assignment descriptions only exist for ~8/20
  dropbox folders (CustomInstructions) — a data ceiling, not a bug.
- Unit banners: Brightspace keeps them inside the Unit Introduction topic —
  surface ONLY the extracted `<img>`s inline on the module page; rendering
  the whole intro clones its text into the section (user-reported bug).
- Assignments rows: each row carries a Brightspace dropbox ExternalLink
  (`url` field — the rows previously had NO way to reach the folder);
  sort dated-first, no-due LAST (localeCompare on '' put no-due on top).
- Assignment rubrics: D2L ships the FULL rubric inside each folder's
  `Assessment.Rubrics` (criteria groups, levels, per-level cell feedback —
  15/20 folders have one). Sync stores `rubrics_json`, API parses it to
  `rubrics`, and the assignment DETAIL view renders a levels-as-columns grid
  (the old per-row "Rubric" toggle was removed when the list went compact —
  the grid lives only on `/assignments/:id` now). Detail:
  references/brightspace-sync-data-shape.md.
- Folder metadata beyond rubrics (all verified live): `CategoryId` →
  /dropbox/categories/ names; `GroupTypeId` → lp groupcategories names (use
  `client.lp()` — absolute URLs silently break); `Attachments`
  [{FileId, FileName, Size}] — **downloaded during sync** to
  `course/Assignments/<folder name>/<file>` and served via `/api/assets`
  (the detail-page attachment chips become real links; endpoint + storage
  layout in references/brightspace-sync-data-shape.md); `Assessment.ScoreDenominator`
  = points (matches gradebook MaxPoints); `Availability`. All synced into
  category/group_category/points/attachments_json/availability_json and
  shown on the assignment DETAIL page (list stays compact). The user's TEAM
  name ("Group 29") comes from `lp /groupcategories/{id}/groups/` matched
  against `lp /users/whoami` — **whoami Identifier is a STRING, group
  Enrollments are INTs: stringify both sides or the match silently fails**
  (course_groups stays empty, zero errors). Per-user
  scores/completion are instructor-gated (submissions 403, grade values
  403) — say so instead of chasing them. **When auditing what an API
  provides, dump the FULL object — a filtered key list once made me miss
  all of this ("why haven't you discovered these?").**
- Sync ops: `/api/sync/trigger` does NOT re-auth — run
  `docker exec campus python -m sync.auth` first (Duo push), then trigger;
  check `sync_runs` for the real outcome. DB is `/app/data/harness.db`
  (standalone scripts resolve a nonexistent /srv path — pass it explicitly).
- **Why Duo pushes stop appearing** (`sync/auth.py`): the flow uses
  `launch_persistent_context(user_data_dir=cfg.browser_profile_dir)` +
  `storage-state.json`, clicks Microsoft's "Stay signed in?", and the
  profile carries the SSO + Duo remember-me cookies — so every auth after
  the first reuses the session and MFA auto-completes with NO push (the log
  shows "Waiting for MFA approval… Login successful" in the same second).
  This is the FEATURE that makes unattended syncs work, not a bug. Manual
  logins skip Duo for the same reason (browser "stay signed in" + Duo
  remember-me ~7 days). To force a real push: wipe the auth profile dir, or
  have the user test in a private window. Answer "why no Duo?" with this —
  don't chase a broken Duo app.
- Container is a bind mount of `~/campus` → `/app`: python/tools edits are
  live immediately; restart the campus service for uvicorn changes.
  Details: references/brightspace-sync-data-shape.md.
- AI access to assignments (content parity): `harness_list_assignments`
  returns full metadata (description, points, category, group + team name,
  closed, rubric names, attachment names+local paths, url) + an
  `assignment_id` detail mode; downloaded attachments are registered in
  `files` (kind='assignment') so the AI lists them and PDFs extract →
  readable via content_read_file. Details in
  references/brightspace-sync-data-shape.md.
- Token/cookies live at `~/.hippocampus/` (verified: auth writes
  `/home/nate/.hippocampus/token.json`) — the cross-profile `campus` skill
  still says `~/.campus/` and cannot be edited from this profile; the
  `~/.hippocampus` path is the truth (renaming it breaks Duo auth state).

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
- Probe TZ pitfall: headless Chromium inside the container runs UTC — due
  dates render as UTC wall-clock in probes ("Sat, Jan 24 · 4:59 AM") and
  look off-by-hours; the user's browser converts to local correctly. Judge
  by `new Date(s)` semantics, not the probe's rendered text.
