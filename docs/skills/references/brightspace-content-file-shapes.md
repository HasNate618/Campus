# Brightspace content file shapes + announcements cutoff (2026-08-03 investigation)

## The files table holds TWO fundamentally different shapes

`SELECT f.id, cn.title, f.path, f.kind FROM files f LEFT JOIN content_nodes cn …`
— SE 2250B has 27 files, all `processed=1`:

- **kind='slide'** = REAL downloaded PDFs: e-book (6.8MB), Lab 1–3, Project
  description, Course Outline. Extracted to .md, viewable in the PDF viewer.
- **kind='other'** = Brightspace template HTML topic pages: "Lecture Slides"
  (Units 1–6), "Unit Introduction", "Instructor Contact", "Terminal Setup",
  "Midterm Location", "Teaching Assistants". These are raw Brightspace HTML
  template shells (Bootstrap + Western template CSS from
  `westernu.brightspace.com/shared/HTML-Template-Library/…`).

### The "Lecture Slides" family = a shell with ONE meaningful link

A Lecture Slides.html file is ~2.5KB of template boilerplate whose actual
content is a single anchor, e.g.:

```html
<a href="https://westernu.brightspace.com/content/enforced/155130-UGRD_1259_3178/Lectures/Version-Control-and-Git.pdf?isCourseFile=true" target="_blank">1</a>: Git
```

So "the PDF is sometimes a link" is literally true: the real slides PDF is
NOT downloaded — it lives on Brightspace at `/content/enforced/<orgUnit>-<code>/…`.
The images in these pages ARE cached locally (rewritten through
`/api/assets/…` by the sanitizer). The Unit Introduction / Instructor
Contact / Terminal Setup pages have REAL content (text + images) — only the
Lecture Slides family is a pure link-page.

### Auth note

`/content/enforced/…` URLs need the browser SESSION cookies
(`~/.campus/cookies.json` via `/api/proxy?url=…`), NOT the D2L API token
(token returns the app shell HTML / a login redirect). Same rule as the
image proxy — see references/content-auth-proxy.md.

## Announcements "cut off" root cause: the hub endpoint LIMIT 10

All 24 announcements ARE in the DB (SE 2250B, Jan 11 → Apr 5 2026). The
course overview page looks truncated because `course_hub()` in
`api/services.py` runs `ORDER BY posted_at DESC LIMIT 10` — the 10th newest
happened to be March 10 ("Make Up Midterm"). The standalone
`GET /api/announcements` endpoint already supports `?limit=` up to 100.
Fix when the user reports a cutoff: raise the hub limit (or have the hub
use the full endpoint) — never re-sync; nothing was lost.

## Assignment descriptions

`assignments.description` and `notes` are NULL for ALL 20 pilot rows — the
dropbox-folder sync never populated them. Western has no `/assignments/`
endpoints; descriptions come from `CustomInstructions.{Html,Text}` on the
dropbox folder list, which populates on the NEXT sync (existing rows stay
NULL until then — known, documented in the skill's Phase-3 section). The
UI shows title/due/weight/status + a Brightspace dropbox URL per row
(`a.url` — all 20 have one); there was no click-for-details view.

## Handling options for the HTML-link-to-PDF files (user asked for ALL)

- **A. Sync-time link-following (permanent fix):** during sync/extract,
  parse the HTML topic pages for `/content/enforced/…pdf` links and
  DOWNLOAD the linked PDFs into the same content folder (the captured
  session cookies cover them), then extract like the rest. The lecture
  slides become first-class PDFs: extracted, searchable, viewable in the
  PDF viewer. Cost: needs a re-sync (Duo), link-pattern parsing.
- **B. Serve-time link surfacing (works with today's data, no re-sync):**
  a small endpoint that parses links out of an HTML file
  (`GET /files/{id}/links`); the viewer shows a prominent
  "Lecture slides (PDF)" button next to the rendered page, opening through
  `/api/proxy` (session cookies) → in-app PDF viewer or download. Also
  worth doing regardless: classify link-pages (template shell + one
  external enforced link) vs content pages so shells render as a clean
  button instead of a broken-looking template.
- **C. Hybrid (recommended):** B now for instant value, A on the next sync
  so slides become native files permanently.
- **D. Status quo:** the extracted text of the HTML already contains the
  URLs, so the AI digest can cite them, but the UI stays poor.

## Frontend batch dispatched same session (deleg_5ad78bb5)

11-item checklist (sidebar zen transparency, Today→Home, RECENT CHATS +
row delete buttons, sidebar width 264→176px, split/full-width toggle hidden
on mobile, assignments full content + .md styling, course tabs in header,
pinned course header, chat input dock: drop status line → bottom row with
context XK/200K + searchable model selector + paperclip upload stub).
Verify per the standard recipe: nix-shell build → restart campus → new
bundle hash on 127.0.0.1:8087.
