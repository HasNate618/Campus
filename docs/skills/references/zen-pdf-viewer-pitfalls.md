# Zen PDF viewer + content pane pitfalls (proven 2026-08-04)

## The vendored viewer: shrink never re-fit (skipWhenZoomedIn bug)
`web/public/zen-pdf/viewer.html` (pdf.js, zen + pageless modes) had:
`onWindowResize → adjustScaleToMode({ skipWhenZoomedIn: true })`, and
adjustScaleToMode skipped whenever `state.scale > fitScale + 0.01`.
After a SHRINK the old fit-scale exceeds the new fit-scale → treated as
"user zoomed in" → re-fit skipped → pages keep their size forever (grow
re-fit, shrink never — exactly what the user reported).
Fix (in the vendored file):
- `state.userZoomed = false` in the state object
- `=` / `-` key handlers set `state.userZoomed = true`
- `adjustScaleToMode` clears `state.userZoomed = false` when it applies a
  fit scale (and '0' reset goes through that path)
- resize calls `skipWhenZoomedIn: state.userZoomed`
Result: auto-fit re-fits both directions; a manual zoom survives resizes.

## iframe flex-fill requires a full flex chain
An iframe with `flex: 1` inside a plain block wrapper is IGNORED — the
iframe falls back to its 150px default height. To make a PDF frame fill
the pane, every ancestor must be a flex column with `min-height: 0`:
`.split-viewer.pdf-mode` (flex column) → `.pdf-zen` (flex column,
`flex: 1; min-height: 0`) → `.zen-pdf-frame` (`flex: 1; min-height: 0;
height: auto`). Plus, for the pane to actually have a height:
- `.course-scroll:has(.split-viewer.pdf-mode) { overflow: hidden; }`
- page-col: `height: 100%; max-width: none` (PDF breaks out of the narrow
  780px content column to span the whole course pane — user asked for
  full-width PDFs)
- `.split { height: 100%; grid-template-rows: minmax(0, 1fr);
  align-items: stretch; }` — `align-items: start` (the default the tree
  wants) stops the viewer from stretching into the grid row.

## A toggle that "does nothing" = class-name mismatch
ContentPage emitted `split-mode-${viewMode}` with values `fullWidth` /
`sideBySide` while the CSS defined `split-mode-full` / `split-mode-split`
→ no rule ever matched → always the default two-pane grid, toggle inert.
When a view-mode toggle appears dead, diff the emitted class names against
the CSS selectors FIRST.

## Where controls belong (user's eye)
- The PDF/extracted-text toggle was a stray action row between the viewer
  head and the frame ("looks out of place") — move it INTO the viewer head
  next to the view-mode toggle; lift the `showMd` state to the page and
  reset it per node (`useEffect(() => setShowMd(false), [nid])`).
- Tree-header buttons (collapse-all, view toggle) were unwanted; the
  viewer-header toggle was wanted. Ask which one when removing "the
  toggle" — there may be two.

## Verification
Playwright-in-container (docker cp probes; container /tmp wiped on
restart). Probe pattern that caught the shrink bug: measure the canvas
width INSIDE the iframe (`f.contentDocument.querySelector('canvas')`)
after a viewport change — the iframe element resizing is NOT proof the
pages re-fit. `page.set_viewport_size` (not context).
