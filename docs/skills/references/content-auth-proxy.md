# Brightspace content auth, the image proxy, and file-twin dedupe

Session 2026-08-03 findings — the "html images don't render" + "unit 6 is a
clone of unit 1" bug family.

## Why images inside html content don't render

Brightspace html content references images via the *enforced content* web
path:

```
https://westernu.brightspace.com/content/enforced/155130-UGRD_1259_3178/Images/2250%20Unit%201.png
```

These paths require the **browser session** (cookie). The sync's Bearer API
token only authorizes `/d2l/api/*`:

- Bearer header → HTTP 200 but the **app shell HTML** (SPA index page), not
  the image
- Bearer + `-L` → redirect chain lands on `/d2l/login` (302)
- token as `?token=` query → 302 login
- Bearer + Referer → 302 login

The browser has no Brightspace cookies at all, so `<img>` tags 401/invisible.
"Embedded links missing" had the same root: image-buttons (`<a><img></a>`)
render as nothing when the image 401s.

## The fix: capture session cookies at auth, proxy through the API

1. `sync/auth.py` gained `_save_session_cookies(context, cfg)` — called on
   every successful auth path. Writes `~/.campus/cookies.json`:
   `{"captured_at": ..., "cookies": [{name, value, domain}, ...]}` filtering
   `d2l*` names on `brightspace.com` domains (d2lSessionVal,
   d2lSecureSessionVal, d2lSameSiteCanaryA/B). 442 bytes, 4 cookies.
2. `api/routers/data.py` `GET /api/proxy?url=<brightspace-url>`:
   - host allowlist: `westernu.brightspace.com`, `s.brightspace.com`
   - if cookies.json exists → build `Cookie: name=value; ...` (domain
     suffix-match against the URL host) → plain `httpx.get(..., follow_redirects=False)`
   - no cookies → fall back to Bearer via D2LClient._auth_headers
   - 30x with `login` in Location → 502 "session expired — run auth";
     non-200 → pass through status; content-type passed back verbatim
3. `web/src/lib/sanitize.ts` `proxifyUrl()` — img srcs on the two hosts are
   rewritten to `/api/proxy?url=${encodeURIComponent(src)}`. Anchors stay
   external (Brightspace will 401 them too, but they're visible; user opens
   them in a logged-in browser).

Re-auth refreshes cookies SILENTLY when the persisted playwright profile
(storage-state / browser-data) still has a live session — the auth flow
hits `/d2l/home` directly, no Microsoft/Duo round-trip. So refreshing the
sidecar is free; only a full session expiry needs a Duo push.

Verified: proxy returned a real 1200x400 PNG (925,962 bytes, image/png)
for the Unit 1 image URL after cookie capture.

## URL-encoded filename twins → duplicate rows + mislinks

The July-era sync saved files under raw `%20`-encoded names; the current
sync unquotes filenames. Result: two rows for the same bytes
(`.../Lecture%20Slides.html` and `.../Lecture Slides.html`, identical
sha256). Worse, a mislink followed: Unit 1's `Lecture%20Slides.html` row
ended up with `content_node_id` pointing at Unit 6's topic (node 29) — the
UI showed Unit 6's "Lecture Slides" with Unit 1's content ("unit 6 is a
clone of unit 1").

Fix: `tools/dedupe_files.py` — for every row with `instr(path, '%') > 0`,
unquote the path, find the decoded twin, and DELETE the encoded row when
sha256 matches (else keep). Ran it: 15 deleted, 27 files remain, 0 encoded
rows left. After that, per-topic linkage was clean (node 9 → Unit 1 file,
node 29 → Unit 6 file).

SQLite footgun: `path LIKE '%\%%'` does NOT match a literal `%` — there is
no default ESCAPE clause in SQLite. Use `instr(path, '%') > 0`.

Prevention going forward: the sync writes only decoded names (unquote in
`_download_topic_file`), so the twins are historical. If they reappear,
re-run the tool; the tool is hash-verified so it never deletes content
that has no decoded copy.

## Zen rendering integration (the other half of the pass)

`zen-markdown-viewer` (github.com/HasNate618/zen-markdown-viewer) is a
standalone marked.js viewer — single viewer.html with inline GitHub-dark
CSS, marked/highlight.js/mermaid/katex from CDNs. Ported into the PWA as:

- `web/src/lib/ZenMarkdown.tsx` — `marked.parse` → dangerouslySetInnerHTML
  in a `.zen-md` div + a useEffect running `hljs.highlightElement` over
  `pre code` blocks; imports `highlight.js/styles/github-dark.css`
- `web/src/styles/zen.css` — the zen typography (GitHub-dark vars defined
  LOCALLY on `.zen-md` so they never clash with the app theme; headings,
  code, tables, blockquote, hr, img) — no mermaid/katex/overlays/polling
- deps: `npm install marked highlight.js` (types ship with both)

PDF viewing policy (Nate): original PDF first (iframe of rawUrl), markdown
behind a "View extracted text" toggle. The old markdown-first default was
his explicit correction.
