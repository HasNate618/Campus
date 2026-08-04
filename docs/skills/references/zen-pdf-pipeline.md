# Zen PDF viewer — iframe integration (replaces the zenPdf.ts port)

Since commit 4b128fb (2026-08-03) the content page embeds Nate's ACTUAL
zen-pdf-viewer instead of a reimplementation. The old port
(`web/src/lib/zenPdf.ts` + `web/src/lib/PdfViewer.tsx`) is DELETED — the
pipeline details below are preserved only as historical reference; the
source of truth is the vendored viewer itself.

## How it's wired (current)

- `web/public/zen-pdf/viewer.html` — a copy of the upstream viewer with
  exactly TWO edits: the `<script src>` and `workerSrc` point at local
  `./pdf.min.js` / `./pdf.worker.min.js` instead of unpkg.
- `web/public/zen-pdf/pdf.min.js` + `pdf.worker.min.js` —
  pdfjs-dist@2.16.105 build artifacts, vendored (no CDN at runtime).
- `web/src/pages/ContentPage.tsx` — `ZenPdfFrame` renders
  `<iframe src="/zen-pdf/viewer.html?file=<abs raw url>&zen=1&pageless=1&t=<file id>">`.
  `file` is the ABSOLUTE same-origin raw URL (`location.origin + rawUrl`).
  The iframe is keyed by file id so switching PDFs remounts it.
- `global.css` — `.zen-pdf-frame` sizes the iframe
  (`height: calc(100dvh - 230px); min-height: 460px; border: 0;
  background: transparent`); `.split-viewer.pdf-mode` drops the card
  chrome; `.pdf-zen` is the surface wrapper + "View extracted text"
  toggle (ZenMarkdown) stays.
- Why an iframe is safe here: the iframe points at an HTML page
  (viewer.html) that renders the pdf ITSELF via pdf.js — an iframe at
  the RAW pdf would trigger a download on Android Chrome. The viewer
  fetches `?file=` same-origin, so no CORS.

## URL contract (params the viewer honors)

`file` (required) · `zen` (1/0, default 1) · `imgcolor` (1/0, default 1 =
hue-preserving) · `dual` (default 0) · `pageless` (default = zen) · `svg`
(default 1, SVG-first with canvas fallback) · `fg` · `bg`. Keyboard:
j/k/h/l scroll, J/K pages, gg/G, r rotate, z zen, c imgcolor, d dual,
p pageless, =/- zoom, 0 fit-width, Esc keybind overlay.

## Historical port details (superseded — kept for tuning context)

The old `zenPdf.ts` port stages (matching viewer.html's canvas path):
1. `detectCanvasBackground` — sample 2% border ring, median r/g/b,
   `isDark = luma < 128`, ≥50% border pixels within `bgRgbTol` (38).
2. `buildBackgroundMask` (pageless) — bg match + 2px low-chroma
   near-luma FRINGE pass (kills anti-aliasing halos).
3. `applyPaperTreatment` — pageless alpha=0 (paper vanishes); paged
   fill `pageShade: 18`.
4. `zenRecolorRgb` — light paper: HSL lightness inversion
   (`hslToRgb255(h, s, 1 - l)`, hue preserved) or luma→255-luma gray;
   dark paper: content untouched.
5. Final: pageless pixels with inverted luma < 14 → alpha=0.

Tuning consts (live in viewer.html now): `paperLumaMin 232`,
`paperChromaMax 16`, `haloLumaMin 205`, `haloChromaMax 32`,
`bgEdgeCoverageMin 0.5`, `bgRgbTol 38`, `bgLumaTol 32`, `bgFringeLuma 44`.

## Updating the vendored viewer

Copy the upstream viewer.html, re-apply the two local-path edits, keep
pdf.min.js/pdf.worker.min.js at the same 2.16.105 version, rebuild
(`nix-shell -p nodejs_22 --run 'npm run build'`), `sudo systemctl
restart campus`. Vite copies web/public verbatim; the FastAPI SPA
catch-all serves real files before the shell fallback.
