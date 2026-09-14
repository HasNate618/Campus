# Zen PDF Viewer (vendored)

Campus embeds upstream [zen-pdf-viewer](https://github.com/HasNate618/zen-pdf-viewer)
from `/zen-pdf/viewer.html` in a full-bleed iframe on the content page.

```
/zen-pdf/viewer.html?file=<absolute raw pdf url>&zen=1&pageless=1&embed=1&t=<file id>
```

| Param | Campus value | Purpose |
|-------|----------------|---------|
| `file` | `{origin}/api/files/{id}/raw` | Same-origin PDF bytes for pdf.js |
| `zen` / `pageless` | `1` | Transparent inverted pageless reading |
| `embed` | `1` | Escape/Tab `postMessage` to parent; cookies on fetch |
| `t` | file id | Cache-bust / iframe remount per document |

Optional upstream params: `page`, `fit=full`, `zen=0`, `pageless=0`, etc. See upstream README.

## Layout

- `viewer.html` — synced from zen-pdf-viewer (one-line Campus patch: violet `::selection` color)
- `vendor/pdf.min.js` + `vendor/pdf.worker.min.js` — PDF.js **2.16.105**, offline-safe

## Updating

From the Campus repo root (with zen-pdf-viewer checked out nearby):

```bash
./scripts/vendor-zen-pdf.sh ~/Projects/zen-pdf-viewer
cd web && npm run build
```

Or set `ZEN_PDF_VIEWER_ROOT` to the zen-pdf-viewer path. The script copies `viewer.html` and `vendor/`, removes legacy root-level `pdf.min.js` files, and applies the selection-color patch.

Vite copies `web/public/*` into `web/dist`; the service worker cache-first rule covers `/zen-pdf/*`. PDF API routes are not cached.

## Parent integration

`ContentPage.tsx` listens for:

| Message | Action |
|---------|--------|
| `zenpdf-escape` | Return keyboard zone to sidebar |
| `zenpdf-tab` | Blur iframe, focus tree |

Parent → viewer (Campus citations):

| Message | Action |
|---------|--------|
| `zenpdf-goto-page` `{ page: N }` | Scroll to page N without reloading |

Listener validates `e.origin` and `e.source === pdfFrameRef.current?.contentWindow`.
