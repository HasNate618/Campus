# Inline file references — design

**Date:** 2026-10-08
**Status:** draft design, awaiting review

## Problem

The agent can already cite course material inline: it writes `[cite:N]`, the
frontend renders a clickable chip, and clicking it opens the source in the
Content tab. The unified-upload work then moved real files into the course
workspace (`uploads/`, `notes/`, `work/`) and gave the agent tools to read and
write them — but nothing to *hand the user a reference to one*.

Three concrete breaks, each independent:

1. **Nothing to click.** `CitationRegistry.register_from_tool`
   (`agent/citations.py:350`) registers citations for exactly three tools —
   `search_corpus`, `content_read_file`, `content_grep`. `extract_file`,
   `file_write` and `file_edit` register none, so a workspace file cannot
   become a chip at all.
2. **Nothing to resolve.** `resolve_ref` (`agent/citations.py:423`) resolves a
   ref through the `files` and `content_nodes` tables. A workspace file is not
   corpus-indexed, so `_resolve_file` returns no id and `resolve_ref` returns
   `None`.
3. **Nowhere to land.** `openCitation` (`web/src/chat/ChatView.tsx:501`) only
   ever navigates to `/courses/{id}/content/…`. Workspace files live at
   `/courses/{id}/workspace`.

Separately, and reported while scoping this: the Workspace tab cannot download
a text file at all. `WorkspacePage` sets `assetUrl` only for **non-text** files
(`web/src/pages/WorkspacePage.tsx:509`), and the resulting link is
`target="_blank"` — an inline view, not a download. Corpus files got a proper
`<a download>` in the Content page (`ContentPage.tsx:291`); workspace files
never did.

## Goals

- The agent can reference **any** workspace file inline, and the user can click
  it to land on that file.
- Course material keeps the existing rich citation path — PDF page, assignment,
  module landing — unchanged.
- Any file in the Workspace tab can be downloaded, text or binary.
- A reference to something that does not exist degrades to a visible message,
  never a dead control or a broken view.

## Non-goals

- No change to `[cite:N]` syntax, registration, or the Content viewer.
- No server-side reference registry, minted ids, or validation round-trip.
- No eager validation of references at render time.
- Not "attach a file to a message" — that already exists as uploads.
- No new upload capability; that shipped in `2026-10-07-unified-uploads.md`.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Any workspace file (`uploads/`, `notes/`, `work/`) | Closes the gap the upload work opened; the agent writes `notes/` files itself and should be able to point at them |
| Click action | Open in the Workspace viewer | One behaviour; text renders inline, a binary shows the existing open/download link |
| Authoring | A model-written `[[file:path]]` marker, any path | Covers files the agent only saw listed; needs no server state or pre-call |
| Course material | Keeps `[cite:N]` | It resolves to the richer viewer (page, assignment, module) |
| Marker naming course content | Resolve server-side, route to the right tab | The model's choice becomes a hint, not a decision the user is stuck with |
| Testing | `vitest`, scoped to `md.ts` string transforms | A regex that silently stops matching is invisible to `tsc`; see *Testing* |

## Architecture

Two reference kinds, one rendering seam and one click handler:

```text
                       model prose
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
   [cite:N]                              [[file:path]]
   registered by                         written directly,
   corpus tools                          no server state
        │                                       │
        └───────────────┬───────────────────────┘
                        │
   md.ts  renderCitations() + renderFileRefs()   ← raw markdown, pre-parse
                        │
                  marked.parse → DOMPurify
                        │
        <button data-cite-id>   <button data-file-path>
                        │
        ChatView  onClick → onCitationClick  (delegated, closest())
                        │
              resolveRef(courseId, ref)
                        │
        ┌───────────────┴───────────────┐
     corpus hit                      no hit
        │                               │
   Content tab                    Workspace tab
   (file/page/node)               /courses/{id}/workspace?path=…
```

The two kinds share the renderer, the sanitizer allowlist and the click
handler, and diverge only at the routing step.

## Reference syntax

```text
[[file:2026F/CS1100A/uploads/slides.pdf]]
```

- The path is **data-root-relative** — the same form `content_read_file`,
  `extract_file` and the workspace API already use, so a path the agent saw in
  a tool result is directly usable.
- Chosen over reusing `[cite:N]` because a citation is a *server-minted*
  identity: the model cannot invent one, which is exactly why it cannot
  reference a file it merely saw listed.
- Verified against the installed `marked`: `[[file:x]]` is **not** CommonMark
  link syntax and stays literal text, including inside emphasis
  (`**[[file:x.md]]**` → `<strong>[[file:x.md]]</strong>`). The marker is
  therefore available to the post-processing pass, which is where the existing
  citation replacement already runs.
- An incomplete marker mid-stream (`[[file:abc`) does not match and renders as
  literal text until complete — the same behaviour `[cite:N]` has today.
- The chip label is the basename; the full path goes in the `title` tooltip.

## Frontend

### `web/src/lib/md.ts` — rendering

`renderCitations` (`md.ts:135`) runs on the **raw markdown before**
`marked.parse` (`md.ts:185`), injecting `<button>` markup that DOMPurify then
sanitizes against an allowlist. The new pass goes in the same place:

```ts
export function parseMarkdown(content: string, citations?: Record<number, CitationMeta>): string {
  const body = renderFileRefs(renderCitations(content ?? '', citations))
  const html = (marked.parse(balanceFences(renderFootnotes(body))) as string) || ''
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}
```

`renderFileRefs` mirrors `renderCitations`:

- match `/\[\[file:([^\]]+)\]\]/g`;
- reject a path containing `..` (leave the marker literal rather than emit a
  control that cannot work);
- `escapeHtml` the path into `data-file-path` and the basename into the label;
- emit `<button type="button" class="file-chip" data-file-path="…" title="…">`.

`SANITIZE_CONFIG.ADD_ATTR` (`md.ts:177`) gains `data-file-path`. It stays a
closed allowlist: the attribute is a path string, and `ALLOW_DATA_ATTR: false`
continues to drop every other `data-*`.

### `web/src/chat/ChatView.tsx` — routing

`onCitationClick` (`ChatView.tsx:551`) gains a second `closest()` branch for
`[data-file-path]`. The resolve-and-navigate body currently inside
`openCitation` is extracted into one helper, so both kinds share it:

```ts
async function navigateToRef(cid: number, ref: string, page?: number) {
  const resolved = await api.resolveRef(cid, ref)   // null for a workspace path
  if (resolved?.fileId != null || resolved?.nodeId != null) {
    /* existing Content-tab navigation, unchanged */
  } else {
    navigate(`/courses/${cid}/workspace?path=${encodeURIComponent(ref)}`)
  }
}
```

A corpus hit keeps today's exact behaviour, including the
`campus:goto-citation` event for an already-open PDF. Only the miss path is new.

### `web/src/pages/WorkspacePage.tsx` — landing on `?path=`

The page reads no query params today. It gains:

- `useSearchParams()`; on mount and whenever `path` changes, resolve the node
  via the existing `findNode(tree.nodes, path)`;
- expand the node's ancestor directories into `openDirs` so it is visible in the
  tree, then select and load it with the existing `openNode`;
- if the path is absent from the tree, set the existing `notice` state
  ("That file isn't in this workspace.") rather than failing silently.

Ordering matters: the tree loads asynchronously (`loadTree`), so the selection
must run after `tree` is populated, not on mount alone.

### `web/src/pages/WorkspacePage.tsx` — download

The editor header gains a Download control for the selected file:

```tsx
<a className="icon-btn" href={assetUrl ?? undefined} download={current.name} title="Download">
  <Download size={12} />
</a>
```

This requires computing `assetUrl` for **all** files, not only non-text ones
(today it is set in the `!viewable` branch). `/api/assets/{path}`
(`api/routers/data.py:72`) already serves any file under the data root and
needs no change: the `download` attribute on a same-origin link supplies the
`Content-Disposition: attachment` behaviour, and `download={current.name}`
gives a sane filename. The existing "open in new tab" link for binaries stays.

## Prompt

The split has to be taught, or the model will reach for whichever marker it
saw first. `build_system_prompt` (`agent/chat.py`) gains one rule alongside the
existing citation guidance:

- course material — lecture files, assignments, announcements, modules — is
  cited with `[cite:N]`, as today;
- a file in the workspace (something under `uploads/`, `notes/` or `work/`,
  including a file just written) is referenced as `[[file:<path>]]`, using the
  exact path from the tool result.

The rule is guidance, not a contract: a model that ignores it produces either a
working citation or no chip at all — never a broken control.

## Error handling

| Case | Behaviour |
| --- | --- |
| Marker names a nonexistent workspace file | Chip renders; click lands on the Workspace tab with a "not in this workspace" notice |
| Marker names a corpus file | `resolveRef` hits; routes to the Content tab with page/node — the intended outcome |
| Marker contains `..` | Left literal at render time; never becomes a control |
| Path escapes the data root by any other route | Server `_resolve_workspace` raises and the workspace read reports it; `/api/assets/` is path-guarded to `SCHOOL_ROOT` |
| Marker half-typed while streaming | Regex does not match; renders as literal text, then becomes a chip when complete |
| Tree still loading when `?path=` arrives | Selection runs when `tree` is populated, not on mount |
| Download of a very large file | `<a download>` streams from `/api/assets/`; no client buffering |

## Security

- **XSS.** The marker is model-authored text that becomes markup. The path is
  `escapeHtml`-escaped into the attribute, and `SANITIZE_CONFIG` remains a
  closed allowlist — adding `data-file-path` does not open `data-*` generally.
- **Traversal.** Refused twice: at render time (`..`) and at read time by
  `_resolve_workspace`, with `/api/assets/` independently guarded.
- **No new endpoints**, so no new auth surface; `/api/assets/` already sits
  behind the optional password gate like every other `/api/*` route.

## Testing

The reference feature is almost entirely client-side, and this repo has no JS
test runner. `tsc` and `oxlint` cannot see a regex that stopped matching, so
this design adds **`vitest`, scoped to `md.ts`'s pure string transforms** — no
component tests, no DOM, no runner for the rest of the app. Adding the
dev-dependency is an install, and will be confirmed separately before it
happens.

Cases for `renderFileRefs` / `parseMarkdown`:

- `[[file:a/b.md]]` → a chip carrying `data-file-path="a/b.md"` and label `b.md`
- a path containing `..` stays literal text
- a half-typed marker stays literal text
- a marker inside emphasis still becomes a chip
- the path is escaped (a path containing `<`, `"` or `&` cannot break out of
  the attribute)
- `[cite:N]` and `[[file:…]]` in the same message both render
- an unrelated `[x](y)` markdown link is untouched

Python-side, one cheap test in the existing suite: `/api/assets/{path}` serves a
workspace upload and refuses a traversal path. This is the download path's only
server-side dependency.

Not automatically testable, and to be checked by hand in a browser: the
delegated click handler, the Content-versus-Workspace routing, the `?path=`
landing, and the download control.

## Risks

- **Prompt compliance.** The model may not adopt the marker. Impact is bounded:
  the answer reads normally, minus a chip. If it proves unreliable in use, the
  mitigation is to register citations for the workspace tools as well — a
  server-side change this design deliberately avoids for now.
- **Regex versus markdown.** Verified for the installed `marked` today; a
  future `marked` upgrade could change how `[[…]]` is tokenized. The vitest
  cases above pin the behaviour.
- **Introducing a test runner.** `vitest` is new to this repo. Kept to one
  dependency and one test file, but it is a precedent, and the alternative
  (ship a parser with no test) is worse.
- **`?path=` deep link.** A stale or hand-edited path shows a notice rather than
  selecting anything — acceptable, and the reason the notice exists.

## Open questions

- Should the chip carry a file-kind icon (PDF, image, markdown)? Nice to have;
  deferred, since it needs the mime and the chip is built from the path alone.

Resolved during review: the Download control shows for **any** selected file,
read-only `content/` files included. `/api/assets/` already serves them, the
control is the same one line either way, and gating it on `writable` would
mean a file you can read but not download for no stated reason.

## Out of scope / follow-ups

- Downloading directly from the chat chip. The agreed click action is
  open-in-Workspace; download lives there.
- Migrating or deleting legacy `data/chat_uploads/` bytes (noted in the
  unified-uploads plan).
- Making uploads corpus-searchable.
