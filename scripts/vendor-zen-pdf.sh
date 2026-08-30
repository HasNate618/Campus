#!/usr/bin/env bash
# Sync zen-pdf-viewer into Campus static assets.
# Usage: scripts/vendor-zen-pdf.sh [path-to-zen-pdf-viewer-repo]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-${ZEN_PDF_VIEWER_ROOT:-$HOME/Projects/zen-pdf-viewer}}"
DEST="$ROOT/web/public/zen-pdf"

if [ ! -f "$SRC/viewer.html" ] || [ ! -d "$SRC/vendor" ]; then
  echo "zen-pdf-viewer not found at $SRC (need viewer.html and vendor/)" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC/viewer.html" "$DEST/"
rm -rf "$DEST/vendor"
cp -r "$SRC/vendor" "$DEST/"
rm -f "$DEST/pdf.min.js" "$DEST/pdf.worker.min.js"

# Campus theme: violet text selection inside the iframe (upstream uses green).
sed -i 's/rgba(74, 222, 127, 0.35)/rgba(161, 121, 240, 0.35)/' "$DEST/viewer.html"

echo "Vendored zen-pdf-viewer from $SRC into $DEST"
echo "Rebuild web/dist (npm run build) and refresh the PWA cache if testing offline."
