#!/usr/bin/env bash
# Build the Campus web UI into web/dist.
#
# The deployment serves web/dist directly (the container mounts the repo at
# /app), so the frontend MUST be rebuilt after any change to web/src — the
# Python-side restarts do NOT rebuild it. Run this (or `make build-web`)
# whenever you touch frontend code.
#
# Uses the node:22-alpine image so no local Node toolchain is required.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"

echo ">> building web UI (npm ci + vite build)"
# Pass the host's commit through: the container mounts only web/, so git is not
# visible inside it and the build stamp would otherwise always be "unknown".
BUILD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
docker run --rm -e BUILD_SHA="$BUILD_SHA" -v "$ROOT/web":/app/web -w /app/web node:22-alpine \
  sh -c "npm ci && npm run build"

echo ">> web/dist rebuilt at $ROOT/web/dist (build stamp: $BUILD_SHA)"
echo "   The running campus container picks it up on next request (no restart needed)."
