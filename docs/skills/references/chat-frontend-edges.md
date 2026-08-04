# Chat + frontend edge cases (2026-08-03 session record)

Full detail behind the SKILL.md bug classes. All paths under `web/src/`.

## The tool-call invisibility bug (user diagnosed it)
- `tool_start` marked the assistant node `intermediate: true` (mid-turn
  narration) but NOTHING ever cleared it — the renderer SKIPS intermediate
  assistant nodes, so every tool-call turn's final answer (which streams into
  that same node) was invisible: thinking + tool chips, then nothing. The
  complete answer sat in state + DB the whole time.
- FIX: clear `intermediate` in ALL terminal paths — token events, `done`,
  the error branch, and zombie normalization on load.
- Second act: hiding the node ALSO hid its tool chips (they render inside the
  assistant branch) → chips only appeared when the answer began. FIX: never
  hide the node on tool_start; render tool chips ABOVE the content
  (chronological — they ran before the answer).
- Diagnosis path that worked: instrument streamTurn with console.debug on
  each event + finally (receivedDone/assistantId/lastEvent) → proved the
  stream + state were perfect → the render was the lie. Dump the persisted
  session from localStorage (`hc.chat.sessions.v3`) to prove state integrity.

## Edit-rewind ghost parent
- `editMessage` computed `doomed = collectSubtree(nodes, nodeId)` — the set
  INCLUDES the root, so the rewind deleted the user message ITSELF, then the
  re-sent turn streamed into a ghost parent. Result: session collapsed to
  only the new assistant response (user: "deleting a message makes the whole
  session disappear except for the assistant's last message").
- FIX: `doomed.delete(nodeId)` — the user node survives (rewritten), only its
  descendants die. Verified: edit → re-send → `[EDITED question, Thought…]`.

## Delete semantics = REJOIN, not subtree-delete
- User expectation: deleting a message removes THAT message; later messages
  survive and re-parent to the deleted node's parent (deleting a middle user
  message must NOT wipe all later history — the old behavior forced deleting
  the assistant reply first).
- Implement: direct user/assistant children re-parent to the parent; tool +
  intermediate children are artifacts and die with the node.
- Deleting the ACTIVE branch (a regenerated v2) falls back to the remaining
  sibling (v1) — else the path dangles and v1 stays hidden until a new
  message "revives" it (confusing ghost behavior).
- Deleting the last message removes the now-empty session entirely (server
  DELETE + local removal).
- Edge-case probe recipe: build a 3-turn chat, delete middle user msg, delete
  after regenerate, delete everything — assert the message list after each.

## "New chat" must NOT create a session
- `newChat(courseId)` used to `makeSession()` — empty 'New chat' drafts
  accumulated in memory + the session list. User: only sessions with messages
  should exist.
- FIX: `newChat` sets an activeMap sentinel (`''`) → `activeFor` returns null
  → blank chat screen; `send()` materializes the session inline on first
  message (titled from it). Persist + load both drop empty sessions.
- Also hide the New chat button when the chat is already empty.

## Reasoning-content 400 (provider-side, transient)
- Provider (Console Go / deepseek thinking mode) requires `reasoning_content`
  passback that MATCHES what it generated — validation is stateful and
  intermittently 400s a perfectly-formed request; identical messages succeed
  on re-send. Turns with tool calls are the usual victims (the follow-up call
  carries the passback).
- FIX: retry failed model calls 3× with 1/2/3s backoff in `run_turn`; on
  final failure emit an `error` SSE event AND render it as a visible ⚠ node
  in the chat (appended to partial content) — never a silent status line.
- Repro note: fake reasoning_content in a direct `_model_call` test 400s;
  genuine passback from a real first call succeeds. The provider validates
  against its own per-conversation cache.
- The ORIGINAL "Test chat" symptom (thinking + tools then nothing, persists
  across reload) was this 400 + the invisible-error UX + the intermediate
  flag — three stacked causes, each needed its own fix.

## Zombie nodes (mid-turn reload/close)
- A page reload mid-turn persists a half-built assistant node
  (`streaming: true` or `thinking && !thinkingDone`) — renders as an eternal
  "Thinking…" spinner. Normalize on load: streaming false, thinkingDone true,
  intermediate false, and append a visible "cut short" notice when empty.

## Class-name contract between TSX and CSS
- ContentPage emitted `split-mode-fullWidth`/`split-mode-sideBySide` but the
  CSS defines `split-mode-full`/`split-mode-split` — no rule ever matched →
  the view toggle silently did nothing (always two-pane). ALWAYS grep the
  CSS for the exact class names a component emits.

## zen-pdf-viewer shrink-refit bug (vendored web/public/zen-pdf/viewer.html)
- `onWindowResize` used `adjustScaleToMode({ skipWhenZoomedIn: true })` —
  skips re-fit when current scale > new fit scale. After a SHRINK the old
  fit-scale is bigger than the new fit → treated as "zoomed in" → never
  re-fits. Grows worked (fit grows), shrinks kept the old page size + clipped.
- FIX: add `state.userZoomed` set ONLY by the `=`/`-` zoom keys (and cleared
  when the fit scale is applied); resize uses `skipWhenZoomedIn: state.userZoomed`.
- Verify by measuring the iframe's canvas width before/after a viewport
  shrink (canvas must re-render to the new width, no clipping).
- PDF full-width: while a PDF is open, `:has(.split-viewer.pdf-mode)` lifts
  the page-col max-width + suppresses course-scroll; the viewer/`.pdf-zen`/
  frame form a filling flex chain (viewer fills the pane, frame fills the
  viewer) — missing any link in the chain leaves the iframe at its default
  150px height.

## Context meter: real model windows, never invented limits
- bifrost `/v1/models` includes `context_length` for only ~42/136 models
  (gemini etc., NOT deepseek). Pass it through `/api/chat/models` as a
  `contexts` map; the UI shows `used/MAX` when known, `used` alone when the
  provider doesn't report one. User: "actual max content instead of just 200k".

## Playwright-in-container verification recipes
- Probes must be `docker cp`'d in (container /tmp wiped on restart). Run:
  `docker exec campus python /tmp/probe.py`.
- Pitfalls: `.msg-actions` is a SIBLING of `.msg-user`/`.msg-assistant`, not a
  child (selectors must use parentElement); collapsible/hidden elements keep
  flex width unless `flex: 0 0 0; min-width: 0` is set (collapsed sidebar
  times probe showed 22px "hidden" titles); inside the container the API is
  on port 8000, host-side 8087.
- Computed-style probes (`getComputedStyle`) beat text probes for layout
  bugs; headless Chromium reports `backdrop-filter: none` even when the rule
  applies — compare the SAME property on a known-good sibling (e.g. .card).
- Viewport resize probes: use `page.set_viewport_size` (not
  `context.set_viewport_size` — that method doesn't exist in this Playwright
  build).
- A probe navigating to several URLs in one run can show stale viewer state —
  if the content doesn't match the URL, navigate fresh in a separate run.
