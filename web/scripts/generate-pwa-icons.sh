#!/usr/bin/env bash
# Regenerate PWA launcher icons from favicon.svg with safe-zone padding.
set -euo pipefail
cd "$(dirname "$0")/../public"

BG="#09090c"
SRC="favicon.svg"

gen() {
  local out=$1 size=$2 logo=$3
  magick -background "$BG" -density 300 "$SRC" \
    -resize "${logo}x${logo}" -gravity center -extent "${size}x${size}" "$out"
  echo "wrote $out (${logo}px logo in ${size}px canvas)"
}

# Maskable: keep artwork inside ~66% safe circle (Android adaptive icons).
gen icon-512-maskable.png 512 320
gen icon-512.png 512 384
gen icon-192.png 192 144
