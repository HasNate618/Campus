# Zen PDF Viewer (vendored)

This directory is the Campus-embedded copy of Nate's
[zen-pdf-viewer](https://github.com/HasNate618/zen-pdf-viewer) single-file
viewer, served statically from `/zen-pdf/*` and embedded by the content page
in an `<iframe>`:

```
/zen-pdf/viewer.html?file=<absolute raw pdf url>&zen=1&pageless=1&t=<file id>
```

The viewer is designed to be driven entirely by URL params (`file`, `zen`,
`pageless`, `dual`, `imgcolor`, `svg`, `fg`, `bg`) — see the upstream
README's "URL Parameters" table. The app pins `zen=1&pageless=1` so the PDF
gets the full zen experience (pageless transparent inverted pages, text
selection, zoom, keyboard nav) with no approximation.

## Vendored PDF.js (2.16.105)

`pdf.min.js` + `pdf.worker.min.js` are the exact `pdfjs-dist@2.16.105` build
artifacts, vendored so nothing depends on a CDN (the homelab's web client
may be offline/air-gapped). `viewer.html` references them as
`./pdf.min.js` / `./pdf.worker.min.js` — the only two deviations from the
upstream file (the upstream script tag + `workerSrc` point at unpkg).

## Updating

```bash
curl -sSL -o pdf.min.js https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.min.js
curl -sSL -o pdf.worker.min.js https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js
```

Keep both files and `viewer.html` on the same PDF.js version. To sync
viewer.html itself, copy the upstream file and re-apply the two local-path
edits above. Vite copies `web/public/*` verbatim into `web/dist`, and the
FastAPI SPA catch-all serves real files under `web/dist` before falling
back to the shell — no backend change needed.
