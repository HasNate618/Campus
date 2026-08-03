# Chat v2 — Technical Plan

Scope: make the chat a real product. Streaming (finally), Open WebUI-style
message tree (fork/regenerate/edit/delete), mermaid, tables, copy buttons,
context/token info. Several pieces come from the user's zen-markdown-viewer
(the parts the zen port deliberately excluded).

## 0. Streaming — root cause FOUND and fixed

- Verified: the API streams correctly (451 token events over 9s on
  127.0.0.1:8087 — thread-safe emit fix landed earlier).
- Verified: school.home.lab delivered 636 token events in 0.01s → **Caddy
  buffered the whole SSE response**. The route lacked `flush_interval -1`
  (other routes have it). FIXED in proxy.nix; nixos-rebuild applying.
- Frontend already CRLF-tolerant; auto-scroll + cursor exist. Nothing more
  needed on the client — the user should see live text after the rebuild.

## 1. Message tree (Open WebUI-style history)

### Data model (client-side, localStorage)

```
ChatSession {
  id, courseId, title, createdAt, updatedAt
  nodes: MsgNode[]              // flat store; tree via parentId/children
  activeNodeId: string          // tail of the displayed path
}
MsgNode {
  id: string                    // makeUuid()
  parentId: string | null       // null = root (a user message)
  children: string[]            // ordered
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string             // assistant only (merged per turn)
  model?: string                // assistant only (what produced it)
  tokens?: { prompt, completion, total }   // assistant only (from usage)
  tool?: string; args?: unknown; result?: unknown; done?: boolean  // tool nodes
  createdAt: number
}
```

- The visible conversation is the **path from root → activeNodeId**.
- **Send**: user node (parent = activeNodeId, becomes active) → assistant
  node (parent = user node) → tool nodes (children of the assistant node,
  grouped/collapsed as today).
- **Regenerate** (assistant message): new assistant node with the same
  parent as the old one → parent now has 2 children = fork. New node becomes
  active. Old branch fully preserved (nodes stay; just not on the path).
- **Edit** (user message): rewrite content, delete the node's entire
  descendant subtree, set activeNodeId = the edited node, auto re-send.
  That is the "rewind" (Open WebUI behavior).
- **Delete** (any node): remove node + subtree. If on the active path, the
  path re-roots at the nearest surviving ancestor.
- **Branch switcher**: a message with >1 child shows sibling chips
  (`v1 v2` — click to make that child's path active). Rendered next to the
  parent message, exactly like Open WebUI's "branch" controls.
- Tool nodes never appear in the path (they're children of assistant nodes,
  revealed via the existing "N tool calls" chip).

### Backend contract

- The chat POST already takes `history` (user/assistant content) — the
  client builds it from the ACTIVE PATH. Add one field:
  `branch: string | null` (the user node id that starts the turn).
- **Reasoning cache keying**: currently `(session_id,)` or `(course_id,)`.
  Forks share the course key → the wrong branch's reasoning could be
  injected. Change the key to `(course_id, branch)` (or session_id+branch).
  `_store_reasoning`/`_inject_reasoning` already take a key tuple.
- Tool results keep flowing as `tool_start/tool_end` SSE; the assistant node
  accumulates them.

### Migration

- `hc.chat.sessions.v2` (linear `messages[]`) → v3: each message becomes a
  node chain (user→assistant, tools as assistant children). One-time
  on-load migration, then write v3.

## 2. Rendering upgrades (shared `zenMd` post-process)

New `web/src/lib/zenMd.ts` used by BOTH `ChatMd` (chat) and `ZenMarkdown`
(content) — a single marked post-processing pass that upgrades rendered HTML:

1. **Mermaid**: `pre > code.language-mermaid` → dynamic-import `mermaid`
   (lazy, dark theme), render to SVG in place, wrap in `.mermaid-wrap`
   (zoom-on-click overlay ported from zen-markdown-viewer:
   `#mermaid-overlay`, `.m-scale`, `.m-close` + its CSS). Render errors fall
   back to the raw code block.
2. **Copy buttons**: wrap each `pre > code` in a `.code-header` bar (lang
   label + copy button) — the zen viewer's exact markup/CSS
   (`.code-header .lang`, `.copy-btn`), `navigator.clipboard` with
   execCommand fallback.
3. **Tables**: zen table treatment for chat `.md` tables too — bordered,
   header background, horizontal-scroll wrapper (`overflow-x: auto`), zebra
   rows. (The `.zen-md` table CSS exists; extend the same rules to chat.)

Dependencies: `mermaid` npm package (new). Everything else is markup/CSS.

## 3. Context window / tokens info

- **Backend**: bifrost streaming returns `usage` in the final chunk.
  `_model_call` captures it per model call; `run_turn` aggregates;
  the `done` SSE event becomes
  `{ answer, model, usage: { prompt_tokens, completion_tokens, total_tokens } }`.
- **Frontend**: assistant node stores `tokens` + `model`. UI:
  - a slim context bar above the input dock: `model · Xk tokens this turn ·
    ~Yk context / Zk window` (window from a per-model map, e.g.
    deepseek-v4-flash 64k; fallback 32k).
  - per-message hover: token count for that assistant message.

## 4. History manipulation UI

- Hover actions on message bubbles:
  - user: ✏️ edit, 🗑 delete
  - assistant: ↻ regenerate, 🗑 delete
- Branch chips (`v1 v2 …`) on parents with multiple children.
- Regenerate: optimistic new node + stream into it; busy state per branch.

## Implementation order

1. Streaming fix deploy (done — verify after rebuild).
2. `zenMd.ts`: mermaid + copy + tables; wire into ChatMd + ZenMarkdown.
3. Tokens: usage capture (backend) + context bar + per-message info.
4. Tree: v3 data model + migration + path rendering + send/regenerate/
   edit/delete + branch chips + `branch` field + reasoning-cache keying.
5. Build, deploy, verify with curl (SSE timing through school.home.lab
   must now show a real spread), commit.

## Risks

- Mermaid bundle size (lazy import keeps the main chunk lean).
- The tree migration must be lossless for v2 sessions (strip-ui-flags logic
  already exists — reuse).
- `done` event shape change is additive (new fields) — old clients fine.
