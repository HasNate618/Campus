# Frontend web/ — architecture, contracts, patterns

React/TS PWA at `web/` (Vite + React Router + Tailwind v4 + shadcn-style
tokens). Read this before touching web/. Provenance: 2026-08-03 bug-fix
pass (8a376b7) + content-layout pass (9987cb3).

## Stack & build

- Vite 8, React 19, react-router-dom 7, Tailwind v4 (`@tailwindcss/vite`),
  framer-motion, react-markdown, lucide-react ^1.28.0, cva + tailwind-merge.
- `@/*` → `./src/*` (tsconfig.app.json). `noUnusedLocals` +
  `noUnusedParameters` + `verbatimModuleSyntax` → ALWAYS `import type` for
  type-only imports; any unused import FAILS the build (`tsc -b`).
- `node` is NOT on the host PATH — build with
  `nix-shell -p nodejs_22 --run 'npm run build'` (`tsc -b && vite build`).
- dist/ is gitignored but MUST exist on the homelab for the /app:ro mount
  (see main SKILL "Deploy recipe"). Dev smoke test: `npx vite --port 5199
  --strictPort` in background, curl `/` and a deep route (SPA fallback).

## File map

- `src/App.tsx` — routes: `/` (Today), `/chat`, `/calendar`, `/sync`,
  `/more`, `/courses`, `/courses/:courseId` (CourseLayout),
  `/courses/:courseId/content[/:nodeId]` (ContentPage),
  `/courses/:courseId/assignments`. Calendar/More/Sync have NO bottom-nav
  tab but stay routable by URL — do not delete the routes.
- `components/shell/` — AppShell (Sidebar + AnimatePresence Outlet +
  mobile tabbar; MOBILE_TABS = Home/Courses/Chat), Sidebar (desktop only;
  collapse persisted in localStorage `hc.sidebar.collapsed`; nav label is
  "Home" since the 2026-08-03 polish batch — it was 'Today' before).
- `components/SplitPane.tsx` — draggable left/right split used by the
  course layout (ChatView left, page right); pct persisted
  (`hc.split.course`); hidden ≤860px via CSS (.split-left/.split-divider
  display:none).
- `pages/CourseHubPage.tsx` — CourseLayout (tabs Overview/Content/
  Assignments) + CourseHubPage (announcements/events/assignments/memory).
- `chat/` — ChatContext (localStorage sessions `hc.chat.sessions.v2`,
  makeUuid fallback — see secure-context pitfall in main SKILL),
  ChatView (course picker, history popover, tool chips, stream cursor).
- `api/client.ts` — typed wrapper for every endpoint; `streamChat()` parses
  SSE manually (event:/data: lines; contract: reasoning/tool_start/tool_end/
  token/done — `reasoning {text}` chunks stream before tokens; ChatContext
  buffers them into the assistant message's `thinking`, collapse happens via
  `thinkingDone`).
- `lib/` — format.ts (fmtRelative/fmtDateTime/fmtTime), courses.ts
  (courseColor), sanitize.ts (HTML allowlist sanitizer), useMediaQuery.ts.
- `styles/global.css` — the design system (below).

## Design system (global.css, hand-rolled "dark glass")

- Tokens: `--violet #a179f0`, `--violet-solid`, `--glass-*`, `--text-1/2/3`,
  `--green/--red/--amber`, `--radius-*`.
- Layout/UI classes: `.card(.flush)` `.card-title` `.row(.row-main/
  .row-title/.row-sub)` `.chip(.violet/.green/.red/.amber)` `.btn(-primary/
  -outline/-ghost/-sm)` `.empty(.compact)` `.tabs/.tab-link` `.md`
  `.split(.split-mode-full/.split-mode-split/.has-selection)/.split-tree/
  .split-viewer(.pdf-mode)/.tree-module/.tree-topic/.viewer-*/.pdf-zen/
  .pdf-text-view`
  `.tabbar/.tabbar-tab` `.popover(.left)/.popover-item` `.scope-pill`
  `.chat-*` `.cal-*` `.dash-grid` `.course-card-top/.course-card-chips`
  `.ann-toggle` `.code-view/.pdf-view/.viewer-note/.viewer-actions`.
- Mobile breakpoint: **860px** — sidebar hidden, tabbar fixed bottom,
  `.split` → 1fr, `.page` padding-bottom 96px (tabbar clearance),
  `.chat-input/.popover` get solid bg. 861–1100px: sidebar auto-collapses
  to icons.
- `@layer base/components`; shadcn hsl tokens kept for `ui/*` primitives
  (button/card/input/textarea/separator/scroll-area/badge — rarely used).

## API contracts the frontend builds against (FIXED — do not invent)

- `GET /api/courses/{id}/content-tree` → `{nodes, files}`
  - nodes: `{id, course_id, parent_id, node_type: module|topic,
    topic_type: file|link|html|other, title, description?, url?,
    sort_order}` — modules carry Brightspace landing-page HTML in
    `description`; link topics carry the external `url`.
  - files: `{id, course_id, content_node_id?, path, kind, processed}`
    — kind ∈ slide|reading|handout|assignment|recording|transcript|note|
    other.
- `GET /api/files/{id}/content` → `{content, format, rawUrl}`
  - format ∈ `markdown|html|code|pdf|download`.
  - rawUrl → `/api/files/{id}/raw` (FileResponse, path-guarded to
    SCHOOL_ROOT; usable in an `<iframe>`).
  - pdf: content = extracted markdown if processed else `''`; rawUrl
    always set.
- `GET /api/courses/{id}/hub` → CourseHub {course, announcements, events,
  assignments_upcoming, memory_facts, recent_files, stats}.
- Caveat: the parallel backend agent's checked-in services.py may lag the
  contract (e.g. returning format:'markdown' for everything non-pdf).
  Build to the FIXED contract and degrade gracefully (e.g. a processed pdf
  temporarily shows the iframe viewer until the backend serves text).

## Patterns that fixed real bugs (2026-08-03)

1. **Per-format file rendering** (ContentPage FileBody):
   - markdown → `ZenMarkdown` (lib/ZenMarkdown.tsx — marked +
     highlight.js, scoped `.zen-md` styles in styles/zen.css).
     react-markdown is no longer used for content.
   - html → `sanitizeHtml()` + `dangerouslySetInnerHTML`. React-markdown
     ESCAPES raw HTML — it is NOT a substitute for a sanitizer.
   - code → `<pre class="code-view"><code>` (mono, no markdown).
   - pdf → `PdfViewer` (lib/PdfViewer.tsx — pdf.js canvas; iframes just
     download on Android Chrome) showing the ORIGINAL by default, with a
     "View extracted text" toggle to the extracted markdown via
     ZenMarkdown; amber "extraction pending" note when `processed === 0`.
     NEVER show a dead-end "not processed yet" message for an unprocessed
     pdf. The whole pdf branch sits inside `.pdf-zen` and the split-viewer
     carries `.pdf-mode` (card chrome dropped) — see pattern 12.
   - download → Download button (`href=rawUrl`, `download=filename`).
2. **Kind chips from path extension, for ALL files** (unprocessed pdfs
   included): pdf→`chip red`, html→plain chip, code→`chip violet`,
   zip→`chip amber`, md→`chip green`.
   GOTCHA: check `md`/`markdown` BEFORE the code-ext set or .md files get
   labeled 'code' (bit once in 8a376b7, fixed same commit).
3. **Mobile content viewer = one pane at a time** via `.split.has-selection`
   (tree hidden / viewer shown when a node is selected; viewer carries an
   "All topics" back Link). Since 9987cb3 the swap rules are scoped under
   `.split.split-mode-full` so side-by-side mode keeps both panes on
   desktop; the ≤860px media query collapses BOTH modes to one column
   explicitly (see pattern 11). Without this, tapping a topic left
   tree+viewer stacked and wide content blew the viewport past screen
   width.
4. **Grid blowout guards** (the "panel wider than screen" class of bug):
   `.split > * { min-width: 0 }` (grid children default `min-width:auto`),
   `.md { overflow-wrap: break-word }`, `.md table { display:block;
   max-width:100%; overflow-x:auto }`, `.md img { max-width:100% }`.
5. **sanitize.ts** — zero-dep allowlist sanitizer: DOMParser →
   rebuild only allowlisted tags/attrs; strips script/iframe/style/on*;
   scrubs javascript:/data:/vbscript: URLs (case-insensitive); forces
   `rel="noreferrer noopener"` + `target=_blank` on links. Brightspace
   HTML is semi-trusted; this is accident prevention, not DOMPurify.
6. **Course cards** (CoursesPage): `.course-card-top` (dot + title) +
   `.course-card-chips` (flex-wrap row) so chips never squeeze the title
   at 360px.
7. **Chat course picker**: rows show `code` + term (full name in title
   attr); popover `.course-picker { left:50%; transform:translateX(-50%);
   max-height:min(60vh,420px); overflow-y:auto; max-width:min(320px,
   calc(100vw - 32px)) }`.
8. **Announcements**: `.row-sub` with `WebkitLineClamp: 3` + Show
   more/less toggle when body > 180 chars (clamp style applied only when
   NOT expanded).
9. **lucide-react 1.28.0**: verify an icon exists before importing —
   `node_modules/lucide-react/dist/esm/icons/<name>.mjs` (Home,
   ExternalLink, Download, Link2, FileText, Sunrise all present).

10. **Content page view modes** (9987cb3): `.split` carries
    `split-mode-full` (default) or `split-mode-split`; state persisted in
    localStorage `hc.content.viewMode` (try/catch-guarded lazy init +
    effect write; invalid values fall back to fullWidth). fullWidth = tree
    XOR content with the grid ALWAYS `minmax(0,1fr)` so the tree spans the
    whole row when nothing is selected — the OLD bug was a
    `300px minmax(0,1fr)` grid with the viewer `display:none`, leaving an
    empty gutter beside the tree. split = `300px minmax(0,1fr)` with an
    empty-state hint in the viewer when nothing is selected.
11. **Mode-class specificity vs the mobile media query**: `.split-mode-full`
    (0,2,0) beats the bare `.split { grid-template-columns: 1fr }` (0,1,0)
    media rule, so the ≤860px block must override BOTH modes explicitly
    (`.split.split-mode-full, .split.split-mode-split { grid-template-
    columns: minmax(0,1fr) }`). Any new mode class needs the same
    treatment in the mobile block.
12. **PDF zen full-bleed** (9987cb3): to break a child out of the glass
    card, the CARD gets the modifier — `.split-viewer.pdf-mode { padding:0;
    background:transparent; border:none; box-shadow:none;
    backdrop-filter:none }` (+ `.viewer-head` padding restored) — and the
    content provides its own surface: `.pdf-zen { background:#0d1117;
    border:1px solid #30363d; border-radius:var(--radius-card) }` spanning
    the full column. `.pdf-zen .btn-outline` gets github-dark chrome
    (white 5% bg, #30363d border, hover #484f58). The pdf.js canvas keeps
    its inline `background:transparent` and floats via `.pdf-viewer
    canvas { box-shadow: 0 8px 30px rgba(0,0,0,.45); border-radius:4px }`
    — pages sit on the zen surface, never on a white box.
13. **`.split` grid class ownership**: only ContentPage uses `.split` (the
    tree layout). The chat split is `.split-pane/.split-left/.split-right`
    (SplitPane.tsx) — changing `.split` never affects chat.
    `.split.tree-hidden` is DEAD CSS (no component references it; the
    Hide-tree button was removed in 8a376b7).

## Multi-agent repo discipline (api/ + sync/ owned by a parallel agent)

- Stage ONLY your scope: `git add web` — `git add -A` sweeps the other
  agent's uncommitted api/sync changes into your commit.
- Commit message describes only your scope; confirm with `git status
  --short` that nothing outside web/ got staged.
- Push after every commit: `git push github main` (remote `github`,
  git@github.com:HasNate618/campus.git).
- Do not block on their uncommitted work — build to the fixed contract and
  let the UI degrade gracefully where the checked-in backend lags.

## 2026-08-03 UI-polish batch: sidebar, course page, assignments

Design decisions from the polish batch (global.css header comment is the
authoritative design intent):

- **"Zen transparency" = the ZEN BROWSER, not the zen markdown/pdf
  viewers.** global.css header: "Page background is transparent so Zen
  browser transparency shows through" — the user's browser is the Zen
  browser (Glass mod), and a "zen transparency" issue means the browser's
  wallpaper/acrylic not showing through the app. Fix pattern for a
  blocking panel: drop the page-level `backdrop-filter` + `box-shadow`,
  cut the tint. The sidebar now uses a near-clear `rgba(255,255,255,0.02)`
  with no blur/shadow — page-level backdrop-filter over a transparent
  backdrop smears/blackens and reads as an opaque panel.
- **Sidebar:** `--sidebar-w: 176px` (was 264; collapsed stays 62px); the
  861–1100px media query auto-collapses. Recent-chat rows use
  `.session-item > .session-btn + .session-delete` — that CSS existed
  since bc74ecc with NO markup behind it. Lesson: orphaned/styled-but-
  unused CSS classes are a hint that the brief's intended markup already
  has a design — grep global.css for them to infer what a terse brief
  item means. Delete calls `deleteSession` from ChatContext.
- **Course page pinned header** (CourseLayout in CourseHubPage.tsx):
  `.page.course-page` (padding:0, overflow:hidden, flex column) wraps
  `.course-head` (translucent blur bg, z-index 5, flex-wrap — title AND
  tabs in one row) + `.course-scroll` (flex:1, overflow-y:auto) so ONLY
  content scrolls. Split/full toggle sits in the header (`.desktop-only`
  hides it ≤860px), persisted `hc.course.viewMode` split|full (default
  split = existing SplitPane chat+page; full = page alone). Specificity
  gotcha: `.split-right .page` (0,2,0) re-adds padding — override with
  `.split-right .page.course-page { padding: 0 }`; mobile paddings for
  `.course-head`/`.course-scroll` live in the ≤860px block (the bare
  `.page` mobile rule loses to `.page.course-page`).
- **Assignments (2026-08-04 redesign):** the list is COMPACT rows
  (title · due · status only) that link to a dedicated detail route
  `/courses/:courseId/assignments/:assignmentId` (AssignmentDetailPage —
  full description, points, category/group chips, attachments, rubric grid).
  Sectioning rules Nate corrected twice — LOCKED: group by the dropbox
  CATEGORY TAG (Labs, Project — alphabetical), with UNTAGGED assignments at
  the top (no header); the group name ("Group 29:") appears ONLY as a title
  prefix on group work, never as a section header (an "Individual vs Group
  work" split was rejected); CLOSED assignments (availability EndDate passed
  — API `closed` flag) sink to a "Closed" section at the bottom, dimmed
  (opacity .55) with a muted "Closed" chip. Do NOT re-invent the section key:
  "grouping" in a Nate brief about assignments means the category tag, not
  group-vs-individual. Detail page: `sanitizeHtml(description)` → ZenMarkdown
  (descriptions are CustomInstructions HTML; marked passes raw HTML through);
  attachments render as chips that become `/api/assets/{encoded local}` links
  when downloaded; the rubric is a criteria×levels table (level names+points
  as columns, per-cell Description.Text).
- **Chat context meter:** the `done` SSE event's usage lands on the
  assistant node as `tokens: {prompt_tokens, completion_tokens,
  total_tokens}`; "context XK/200K" reads prompt_tokens (the context
  actually sent to the model = cumulative conversation size) against the
  model's 200k window — not the per-turn delta.
