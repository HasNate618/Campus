# Chat v2 — message tree + rendering + tokens (shipped 4a8c2df, 2026-08-03)

Built per docs/chat-v2-plan.md after Nate said "start". Open WebUI-style
history: forks on regenerate, rewind on edit, branch switching.

## Tree data model (web/src/chat/ChatContext.tsx)

```
ChatSession { id, courseId, title, createdAt, updatedAt,
              nodes: MsgNode[], activeNodeId: string | null }
MsgNode { id, parentId: string | null, children: string[],
          role: 'user'|'assistant'|'tool', content, streaming?,
          thinking?, thinkingDone?, intermediate?, model?, tokens?,
          tool?, args?, result?, done?, open?, createdAt }
```

- The DISPLAYED conversation = pathFor(session): walk parentId from
  activeNodeId to root, reverse. Tool nodes never appear on the path.
- localStorage key `hc.chat.sessions.v3`; `hc.chat.sessions.v2` (linear
  messages[]) migrates on load (each msg becomes a node chain; tool msgs
  become children of the last assistant). stripUiFlags drops
  streaming/open on persist, keeps done/intermediate/thinking.
- Context API: send, regenerate(sessionId, nodeId), editMessage(sessionId,
  nodeId, newText), deleteMessage, setActiveBranch, plus the old surface.
- send(): if no active session, creates it INLINE (async newChat would
  drop the message — the streamTurn needs the session id synchronously).
  History sent to the API = path up to (excluding) the new user node,
  user+assistant content only, intermediates excluded.
- regenerate(assistant node): history = path up to the node's user parent;
  streamTurn creates a NEW assistant sibling of the old one → parent now
  has 2 children → fork. Old branch + its tool children fully preserved.
- editMessage(user node): content = newText, collectSubtree(node) removed
  (nodes + descendants + parent children lists), activeNodeId = node,
  auto re-send via streamTurn.
- deleteMessage: collectSubtree removed; if the active node was in the
  subtree, active = target's parentId (null → empty state).
- Branch chips: renderBranchChips — for a path node, its non-tool,
  non-intermediate children; >1 → `v1 v2 …` chips, active highlighted,
  click → setActiveBranch. Intermediate (mid-turn narration) assistants
  are excluded from chips and never rendered.

## Stream handler (streamTurn) — targets nodes BY ID

- Closure state: assistantId (created lazily on first reasoning/token
  event), turnThinking buffer (merged across the whole turn).
- reasoning → ensure assistant node (parent = userNodeId, thinking seed),
  append chunk. token → ensure assistant, append content, thinking =
  turnThinking. tool_start → mark current assistant intermediate + create
  tool node (parent = assistantId). tool_end → find tool node by
  (tool name, !done) → done+result. done → streaming false,
  thinkingDone true, model/tokens from the event.
- All mutations are functional setSessions updates keyed by node id — no
  positional "last message" logic (that was the v2 way and breaks on
  forks).
- busy is a global gate (one turn at a time; busyRef guards re-entry from
  regenerate/edit).

## API contract changes (api/routers/chat.py + agent/chat.py)

- ChatRequest gains `branch: str | None` (the user-node id starting the
  turn). Reasoning cache key = `(session_id or course_id, branch or "")`
  so forks don't cross-contaminate chain-of-thought passback.
- agent/chat.py `_model_call` now returns `(msg, usage)` — usage captured
  from the final stream chunk (`chunk.get("usage")`). run_turn aggregates
  prompt/completion/total across tool rounds; the `done` SSE event is
  now `{answer, model, usage}` (model = override or config default).
  Verified live: `{"model": "opencode-go/deepseek-v4-flash", "usage":
  {"prompt_tokens": 2410, "completion_tokens": 222, "total_tokens": 2632}}`.
- Frontend context bar (above the input dock) reads the last
  non-intermediate assistant node's model/tokens: `model · Xk out · Yk
  this turn`.

## zenMd post-process (web/src/lib/zenMd.tsx)

Shared by ChatMd (chat, `.md` class) and ZenMarkdown (content, `.zen-md`):
- Mermaid: `pre > code.language-mermaid` → lazy `import('mermaid')`
  (initialize dark, startOnLoad false, securityLevel loose) → render →
  wrap in `.mermaid-wrap`; click → fullscreen zoom overlay
  (`.mermaid-overlay`). Render failure → raw code fallback.
- Code headers: every `pre > code` gets `.code-header` (lang label +
  copy button; clipboard + execCommand fallback; "Copied" feedback).
- `data-zen-processed` guards re-runs (per-token streaming re-runs the
  effect on every content change — without the guard, copy buttons and
  mermaid would duplicate).
- Note: hljs highlighting must run BEFORE the post-process (ZenMarkdown
  has its own useEffect for it; the hook does not highlight).
- mermaid's `.render()` returns a RenderResult — use `res.svg`, not the
  object itself (TS error TS2345 if you type it as string).
- CSS lives in styles/zen.css (`.code-header`, `.mermaid-wrap`,
  `.mermaid-overlay`) + global.css `.md` table treatment (borders,
  header bg, zebra) — the zen table CSS is `.zen-md`-scoped, so chat
  tables needed the parallel `.md` rules.

## ChatView (web/src/chat/ChatView.tsx)

- Renders pathFor(session); hover actions on messages (`.msg-actions`,
  opacity 0 → 1 on row hover): user = edit (inline textarea → Save &
  re-send) + delete; assistant = regenerate (only when idle + done) +
  delete. Tool rows render under the assistant when expanded or live.
- Spinner: `busy && !answerStreaming` where answerStreaming = the last
  non-intermediate assistant on the path is streaming.
- Editing uses `.chat-input-area` textarea + `.branch-chips`/`.branch-chip`
  CSS (global.css).

## Server-side storage (2a71c8a, 2026-08-03) — Nate: "why are chats browser side they should be server side"

- `chat_sessions` gained `nodes_json TEXT` (the whole tree: `{nodes,
  activeNodeId}`). `chat_messages` stays as the linear audit log (the API's
  session_id path still inserts per turn). Schema change required applying
  schema.sql to the LIVE DB explicitly (see the SKILL.md pitfall — the
  chat tables had never been created).
- CRUD in api/routers/chat.py (all open a fresh `DB(cfg.db_path)`):
  GET /api/chat/sessions?course_id= (**returns the FULL TREE per session —
  the client's on-mount load restores chats from this list; see the
  light-list pitfall below**) · POST (create, returns {id, courseId,
  title, nodes: [], activeNodeId: null}) · GET /{sid} (full tree from
  nodes_json) · PUT /{sid} {title?, nodes, activeNodeId} (writes
  nodes_json) · DELETE /{sid}.
- Frontend sync (ChatContext): on mount, GET all sessions and MERGE into
  state (server rows replace matching ids; server-only rows appended —
  this is how a second device's sessions appear). Debounced save: 900ms
  after any sessions change, `saveSessions()` runs (savingRef guards
  re-entry; sessionsRef reads current state): session has `serverId` → PUT
  it; no serverId → POST create → set ONLY the `serverId` field in state
  (the client uuid id NEVER changes — see the id-promotion pitfall) → PUT
  the tree. Empty sessions (0 nodes) are NEVER persisted — a fresh "New
  chat" draft stays local until it has content. deleteSession DELETEs
  server-side via the session's serverId. localStorage is now just an
  offline cache; serverReadyRef gates saves until the initial load
  completes (so a stale localStorage snapshot can't clobber server truth).

## Post-launch debug round (cac54b6) — the two "still shows nothing" bugs

Both surfaced the day server-side storage shipped, each producing a
distinct empty-chat symptom. Root causes + the durable rules:

1. **Id promotion mid-stream silently drops every later event.** The first
   save loop POSTed the session and swapped the client id
   (uuid → String(serverId)) IN STATE — while the response was still
   streaming. Every stream event after the swap targeted the old uuid,
   which no longer existed in state, so the `ss.map(x => x.id !== old ? x :
   …)` updates matched NOTHING and were silently discarded. Hard evidence
   (session 13): the tree had the USER node but no assistant node and no
   error — the API log showed `POST /api/chat 200` and multiple successful
   PUTs. **Rule: NEVER change the identity a stream targets. Sessions keep a
   permanent client uuid; `serverId?: number` is a separate field.**
2. **A "light list" endpoint can't double as the restore source.** The
   initial GET /chat/sessions returned only {id, courseId, title,
   updatedAt} (built for the history popover) — but the client's on-mount
   load used it to reconstruct sessions, so every restored chat had
   `nodes: []` → ALL chats appeared as the blank new-chat screen after a
   reload, while the DB held the full trees. **Rule: the client's LOAD
   path must receive everything the RENDER path needs.** Either ship the
   full tree in the list or fetch per-session on open — never let a
   popover-optimized shape be the restore contract.

Diagnosis sequence that nailed both: read the DB (`SELECT id, title,
length(nodes_json) FROM chat_sessions`) to see what was ACTUALLY stored,
then grep the container logs for the user's POST/PUT lines (access log
shows 200s even when the client drops everything), then check the served
bundle hash. Server-side data + server 200s + empty UI = client-side
state bug, not a network one.

## Post-launch debug round 2 (84ff6ee) — the localStorage quota kill + stale bundle

Third \"still doesn't work\" report, same day. The user pasted console
evidence (`PUT /api/chat/sessions/14 → 500` + the save-failure stack) —
two more root causes, both with hard fingerprints:

1. **Unguarded localStorage on the critical path.** `send()` called
   `setLastCourse` (→ `localStorage.setItem`, NO try/catch) between
   appending the user node and calling streamTurn. The persist effect ran
   on EVERY sessions change (every streamed token) and the server-loaded
   trees had filled the ~5MB quota → setItem threw QuotaExceededError →
   send() aborted → streamTurn never ran → NO `POST /api/chat` in the
   container logs (exactly ONE in the whole log — the user's many sends
   never left the browser) → busy stuck true (spinner forever) → no error
   node (nothing ever threw in the stream path). DB fingerprint: session
   tree = user node only. Fixes: try/catch on EVERY localStorage write;
   persist skips while busyRef (server is the live store); stream call
   moved before any non-critical write. **Rule: browser-storage writes
   never sit unguarded on a critical path — a quota error must degrade to
   a cache miss, not kill the feature.**
2. **The 500 was `HTTPException` not imported in chat.py** — the session
   endpoints' missing-row branch (`raise HTTPException(404, …)`) crashed
   with NameError instead of returning 404. Test the missing-row path on
   any new endpoint.
3. **Stale bundle fingerprint (the meta-bug):** the user's console stack
   referenced `index-CSYD4hz4.js`; the server served `index-aSputqFv.js`.
   index.html has no cache-control (Caddy sends none, FastAPI StaticFiles
   doesn't add it) → the browser pinned the OLD index.html → old bundle →
   \"still doesn't work\" even after the fixes deployed. When a user pastes
   a console trace, compare its asset hash to the served one FIRST; the
   permanent fix is no-store on index.html + a visible build-version
   marker in the UI.

The follow-up subagent brief (deleg_dced6a92) encodes the durable pattern:
kill stale bundles (no-store + version marker), reproduce the client's
exact request sequence with curl (GET sessions → POST → PUT → POST /chat
SSE — verify shapes + progressive delivery), and add a SELF-REPORTING
stream status to the UI (phase idle/loading/connecting/streaming/done/
error + last event + error text) so the NEXT failure is diagnosable in one
glance instead of another debugging round.
- Streaming proof + smoothness (same commit): the context bar shows a LIVE
  `⟳ streaming N chars…` counter while the answer streams (visible proof of
  progressive delivery — if it climbs, tokens are landing; if it jumps at
  the end, something upstream buffers). ChatMd renders are rAF-throttled
  (content updates coalesce to one marked-parse per frame instead of one
  per token — per-token re-parsing is O(n²) and makes long answers janky).

## Post-launch debug round 3 (ed23cf4) — burst-delivery MISDIAGNOSIS + typewriter reveal (SUPERSEDED by round 4 below)

Fourth "streaming still doesnt work / get results all at once" report. The
server, parser, and proxy were all verified good (curl timing tests showed
progressive delivery: 654 events over 8.6s HTTP, 612 over 6.58s HTTPS), so
this round was driven by a REAL browser — a Playwright probe run inside the
campus container (it has playwright/chromium for Duo auth; the browser tool
can't reach tailnet addresses). See scripts/stream_probe.py.

Evidence chain:
1. DOM-timeline probe (sample the last `.msg-assistant .md` textContent
   length every ~300ms while a long answer generates): 12s of NOTHING
   (0 chars, status never left idle — even the `⟳ streaming` counter never
   appeared), then the FULL 1461-char answer + done-state in one sample.
   Conclusion: the token events never produced an intermediate render.
2. Raw chunk-timing probe (`fetch('/api/chat')` + `res.body.getReader()`,
   record `[t, bytes]` per read): 7 chunks — [2244ms, 3372B], [2245ms,
   2644B], [5033ms, 2831B], [5037ms, 2870B], [5056ms, 325B], [5072ms,
   224B], **[9248ms, 13215B]** — the reasoning streams progressively over
   2-5s, then the ENTIRE answer lands as one 13KB chunk. That's not a
   transport buffer: bifrost's prompt cache (identical course context
   every turn) makes answer generation near-instant, so all answer tokens
   hit the wire in <100ms and the browser coalesces them into one read.
3. React then batches the whole synchronous dispatch loop (all token
   patchNodes + the done event) into ONE render — the assistant node is
   NEVER observed with `streaming: true`, so a reveal keyed to the
   streaming flag can never engage. The done handler's
   "nothing streamed → create node with the full answer" branch is what
   actually renders the text.

Fix (ChatView.tsx, committed ed23cf4): a ONE-SHOT typewriter reveal keyed
to the ARRIVAL of a new assistant message (its node id), independent of the
streaming flag:
- `revealId` state set when `lastAssistant.id` changes (effect on
  `[lastAssistant?.id]`), `revealed` reset to 0.
- rAF loop animates `revealed` 0 → `lenRef.current` (ref always holds the
  current content length so a genuinely slow stream extends the animation
  naturally), speed = `Math.max(700, len/2.2)` chars/s (~2.2s for any
  answer).
- The message renders `content.slice(0, revealed)` while `isRevealing(id,
  len)` (`revealId === node.id && revealed < len`), plus the pulsing
  stream-cursor; the context bar shows `⟳ streaming N / total chars…`.
- Done state (streaming false) does NOT stop the reveal — it runs to
  completion, then snaps to full text. Regenerate/edit change the node id
  or content → fresh reveal.
- Verified in the probe: chars climbed 97 → 302 → 512 → 717 → 937 → 1146
  → 1310 over ~2s with the counter tracking.

Durable rules (REVISED by round 4): (a) a browser chunk probe CANNOT
attribute a burst — it measures browser→API, harness included; probe the
PROVIDER directly (urllib streaming POST, per-delta timestamps) to
separate model behavior from harness buffering; (b) "all at once"
diagnosis order: short answer → proxy cold-start burst → decoration-jank
(zenMd debounce) → the four classic killers (parser/runner/queue/proxy)
→ harness HTTP-client buffering (httpx.post without stream=True) → only
then consider genuine model behavior; (c) when the server demonstrably
streams and the UI still jumps, instrument the browser probe AND the
provider before touching UI code; (d) synthetic reveals mask root causes
— Nate rejected the typewriter reveal ("isn't this worse?" → "remove
it").

## Post-launch debug round 4 (156219d) — the REAL root cause: httpx.post buffering

Fifth "streaming" report, and the user had it right: "there must be
something wrong. the model streams its response over a good few seconds
and i can see words being typed out. this apps shows everything at once."
The round-3 'model burst' conclusion was an artifact of WHERE it was
measured. The decisive instrument: a DIRECT provider probe (urllib
streaming POST to bifrost /chat/completions, timestamp each delta):

- bifrost direct: **208 content deltas over 2.45s** (first 2.64s, last
  5.08s) + 98 reasoning deltas — the model streams progressively.
- The API's SSE (curl through school.home.lab, per-event timestamps):
  ALL ~220 token events at 8.85s in one burst. The reasoning phase
  streamed (per-call bursts), the answer arrived as one blob.

Root cause: `agent/chat.py _model_call` called `httpx.post(...)` with
`stream: True` only in the REQUEST BODY. httpx without `stream=True` on
the call itself reads the ENTIRE response into memory, so
`r.iter_lines()` yields every line at once and on_token fires in bursts
(reasoning per model-call; the whole answer as one blob). The browser
then coalesces the burst into one ~13KB read and React batches it into
one render — which is exactly what round 3 observed, and misattributed
to the model.

Fix (156219d): `with httpx.stream("POST", f"{cfg.bifrost_url}/chat/completions",
json={...}, timeout=300) as r:` + the same loop inside — deltas process
as they arrive. Verified end-to-end: API tokens now spread over 2.72s
(10 bursts of ~20 tokens), and the Playwright DOM probe shows the
message growing 139 → 280 → 376 → 500 → 635 → 781 → 891 → 1002 → 1121
→ 1248 → 1322 chars over ~3.2s — GENUINE progressive rendering, no
animation.

The typewriter reveal was then REMOVED (7d6e893) at Nate's direction —
"isn't this worse?" → "remove it". A synthetic reveal made the symptom
look fixed; the lesson is to find the buffer. The one true insight from
round 3 survived: React batches a synchronous dispatch loop (tokens +
done in one burst) into ONE render, so a burst + done in the same tick
renders once — but with the harness fixed, bursts are the exception, not
the norm.

Layer-isolation recipe (the reliable way to find an SSE buffer):
1. Provider probe (urllib streaming, timestamp deltas) — is the MODEL streaming?
2. API SSE timing (curl -N through the SAME host the browser uses, per-event stamps) — is OUR backend emitting progressively?
3. Browser raw fetch (`res.body.getReader()` chunk timing) — does the BROWSER receive progressively? (includes Caddy/harness)
4. DOM timeline (Playwright probe) — does the UI render progressively?
The first layer that fails the "progressive" test is where the buffer
is; if only layer 4 fails while 1-3 pass, it's a render/React problem.
