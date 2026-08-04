# Phase 3 backend + bug-fixing lessons (2026-08-03)

The Phase 3 wiring (chat SSE over run_turn, real services layer, deploy) and
the follow-up bug marathon produced these hard-won lessons. All verified live.

## Hung-process diagnosis (the breakthrough technique)

When a process "hangs" with no output, do NOT theorize — dump the stack:

```bash
docker exec campus sh -c 'cd /app && timeout 75 python -c "
import faulthandler, runpy, sys
faulthandler.dump_traceback_later(55, exit=True)
sys.argv = [\"sync\", \"sync\"]
runpy.run_module(\"sync\", run_name=\"__main__\")
" 2>&1 | grep -E "File \"/app"'
```

The dump shows the EXACT frame. In this session it ended ~4 hours of guessing:
the sync hung in `extract_pdf` (a 600s httpx PUT to pdf-extractor queued behind
its single VLM worker). Root cause chain: an H1-era inline extraction loop
inside the course loop was never removed when the "background queue" was added —
the inline loop blocked BEFORE the digest AND before the new background spawn.
When adding a background job to a CLI, grep for the OLD inline call site and
delete it; don't assume the new code path is the only one.

## DeepSeek thinking mode: reasoning_content passback (400s)

`opencode-go/deepseek-v4-flash` runs with thinking enabled. Every subsequent
call in a conversation MUST carry the assistant's `reasoning_content` back,
else bifrost 400s with "The `reasoning_content` in the thinking mode must be
passed back to the API."

- In the streaming loop, accumulate `delta["reasoning_content"]` and attach it
  to the assistant message appended to history (tool rounds AND final).
- The browser's localStorage history can't carry it → the API keeps a
  per-course reasoning cache, injects it into the last assistant message of
  each request, stores it after each turn.
- A streamed/rebuilt assistant message must include `"role": "assistant"` —
  the non-streaming API response includes role, your rebuilt dict won't.
  Missing role = 400 `missing field 'role'`.

## SSE over fetch(): CRLF frames break naive parsing

sse-starlette emits frames with CRLF line endings (`event: x\r\ndata: {...}\r\n\r\n`).
A frontend that splits the buffer on `'\n\n'` NEVER matches `\r\n\r\n` →
zero events parsed while the server happily streams (user sees the model work
in bifrost, UI shows nothing). Fix:

```ts
const parts = buffer.split(/\r?\n\r?\n/)   // CRLF-aware
// per line: part.split(/\r?\n/)
// collect ALL data: lines (join with '\n'), not just the last one
```

## crypto.randomUUID needs a secure context

`crypto.randomUUID` is undefined on plain-HTTP pages (LAN homelab apps!).
Use a v4-style fallback:

```ts
function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
```

## Dockerfile silent-failure traps (all hit this session)

1. `RUN pip install ... && playwright install chromium || true` — the trailing
   `|| true` swallows pip failures; the build "succeeds" with no deps and the
   container crash-loops at runtime (uvicorn: not found). Split RUNs; only
   `|| true` on genuinely best-effort steps.
2. Multi-source `COPY requirements.txt api/requirements.txt ./` misbehaved
   (pip couldn't open api/requirements.txt at RUN time). Use one COPY per file.
3. `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` MUST come BEFORE the
   `playwright install` RUN — browsers land in the default cache otherwise and
   runtime can't find them ("Executable doesn't exist at /opt/...").
4. Verify a fresh image actually has what the CMD needs before deploying:
   `docker run --rm --entrypoint sh IMG -c 'which uvicorn; python -c "import fastapi"'`.

## Orphaned processes hold ports (docker exec / background shells)

`process kill` on a background wrapper often kills the SHELL, not the child
(uvicorn, docker exec's container-side python). Symptom: port stays bound,
new process dies with "address already in use", and you keep testing stale
code. Always check the real owner:

```bash
ss -tlnp | grep 8090          # who actually holds it
ps aux | grep -E 'uvicorn'    # compare start times
kill <real-pid>
```

Same for docker exec: killing the host-side exec leaves the container process
running (check /proc inside the container; match on `comm` == python3 to avoid
the grep matching your own shell's cmdline and killing yourself).

## SQLite upsert is_new detection

`INSERT ... ON CONFLICT(...) DO UPDATE` + `cur.rowcount > 0` returns 1 for
UPDATES too → every sync counts all rows as "new" (24 announcements "new"
every run; digest re-processed them all). Use select-first:

```python
existing = conn.execute("SELECT id FROM t WHERE key=?", (k,)).fetchone()
if existing: conn.execute("UPDATE ..."); return False
conn.execute("INSERT ..."); return True
```

Also: SQLite LIKE has NO default escape — `LIKE '%\%%'` matches nothing useful;
use `WHERE instr(path, '%') > 0`.

## Brightspace enforced-content needs the SESSION cookie, not the Bearer token

`/content/enforced/<orgUnit>/...` (images, PDFs referenced inside html topics)
returns the app shell (or 302 → login) with a Bearer API token. Fix: at auth
time, also capture the browser session cookies (d2lSessionVal etc.) into a
sidecar `~/.campus/cookies.json` (playwright `context.cookies()`), and
have the proxy/sync send `Cookie:` for those hosts. Detect redirect-to-login
and report "session expired — run auth". Re-auth with a persisted browser
profile is SILENT (no Duo) until cookies actually die.

## Filename URL-encoding creates duplicate rows + mislinks

The old sync saved files under raw `%20`-encoded names; after the unquote fix
the same files landed again decoded. Duplicate rows, and the encoded twin can
carry a WRONG content_node_id (Unit 1's file linked to Unit 6's topic → the
UI showed Unit 6 with Unit 1's content = "why is this a clone"). Fix:
`tools/dedupe_files.py` — delete encoded rows that have a decoded twin with
the same sha256 (`urllib.parse.unquote` + compare). Tool at
`/home/nate/campus/tools/dedupe_files.py`.

## Background jobs: detached process, not daemon thread

A daemon thread dies when the CLI exits. Extraction after a sync must survive
the sync process: `subprocess.Popen([sys.executable, "-u", "-m", "sync",
"extract"], cwd=repo_root, stdout=logfile, start_new_session=True)`.

## Other working pieces (already deployed)

- SPA fallback: never `app.mount("/", StaticFiles(html=True))` — it 404s deep
  links. Explicit routes: `/` → index.html; `/{path:path}` → file if exists
  else index.html (resolve + is_relative_to guard); /api misses 404.
- PDFs on Android: iframes download (no built-in viewer) → pdf.js
  (`pdfjs-dist`, `getDocument({url})`, render `{canvas, viewport}`, loading
  task `.destroy()` in cleanup, worker via `?url` import). Transparent canvas.
- Content tree single-panel mode: `.split.has-selection { grid-template-columns:
  1fr }` + hide the tree panel; `.split:not(.has-selection) .split-viewer
  { display:none }` — tree XOR content, URL-driven.
- Image pipeline: `tools/cache_images.py` downloads westernu img srcs (via
  session cookies) into `{course}/_assets/`, rewrites html files + DB module
  descriptions to `/api/assets/...`; API route `/api/assets/{path}` path-guarded.
  Hooked into the sync (best-effort). `/api/proxy` remains the fallback.
- zen-markdown-viewer (github.com/HasNate618) = standalone marked+highlight.js
  viewer. Port only the rendering: `marked.parse` + `hljs.highlightElement`
  post-pass + scoped `.zen-md` CSS (GitHub-dark vars defined locally).
