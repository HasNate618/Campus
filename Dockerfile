# Campus runtime image — multi-stage: build the React PWA, then run the
# FastAPI backend (api/) + harness (agent/, sync/) with Playwright for auth.
# Runs as uid 1000 (matching the mounted data/token owner): cap-drop ALL
# strips CAP_DAC_OVERRIDE, so the container must run as the owner of the
# mounted paths, not root.

# ── Stage 1: build the React/TS PWA ─────────────────────────────────────
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────────────
FROM python:3.12-slim
# Runtime + the infrastructure the APP needs: the Playwright chromium for the
# Brightspace auth flow, poppler for extraction, and the handful of utilities
# every sync/agent path touches. AGENT TOOLING does NOT belong here — it is
# provisioned on the host and mounted in (see modules/server/ai/campus.nix):
#   /opt/toolbelt  read-only Nix buildEnv, curated per deployment
#   /opt/mytools   writable, persisted, for per-user additions
# Baking tooling into this image makes every user pay for every other user's
# diagrams and costs a full rebuild per addition, so extend the toolbelt list
# instead of this RUN.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ripgrep curl ca-certificates antiword \
        graphviz poppler-utils jq imagemagick \
        unzip zip file qpdf librsvg2-bin xxd \
        libreoffice-impress libreoffice-writer \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
        fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/lib/libreoffice/user \
    && chown -R 1000:100 /usr/lib/libreoffice/user

RUN useradd -u 1000 -g 100 -m -s /bin/bash campus || true

WORKDIR /app
COPY requirements.txt ./
COPY api/requirements.txt ./api/requirements.txt
# must be set BEFORE playwright install — browsers land in /opt/ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pip install --no-cache-dir -r requirements.txt -r api/requirements.txt
RUN playwright install chromium
RUN playwright install-deps chromium || true

# code mounts from the repo (ro) in the homelab deployment — these copies
# make the image self-contained for other environments
COPY schema.sql ./
COPY seed/ ./seed/
COPY api/ ./api/
COPY agent/ ./agent/
COPY sync/ ./sync/
COPY --from=web-build /app/web/dist ./web/dist

# Run as uid 1000, the owner of the mounted data/token paths. cap-drop ALL
# (docker-compose.yml) strips CAP_DAC_OVERRIDE, so root inside the container
# could not write the mounted volume anyway; starting as root only widened the
# blast radius for no benefit. /app/data is created and owned here so a fresh
# named volume inherits uid 1000 instead of root. The Playwright browsers are
# written as root during install and must stay readable and executable.
RUN mkdir -p /app/data && chown -R 1000:100 /app/data /opt/ms-playwright
USER 1000:100

ENV CAMPUS_DB=/app/data/harness.db
EXPOSE 8000
# seed only when the DB is missing (prod data comes from sync, not seeds);
# pilot_data.py is a dev-only mock, never run here.
# The seed failure used to be hidden by `2>/dev/null || true`, so a broken
# seed started uvicorn against an empty DB with no indication why. `exec`
# also makes uvicorn PID 1 so it receives SIGTERM from docker stop.
CMD ["sh", "-c", "if [ ! -f \"$CAMPUS_DB\" ]; then python seed/seed.py || echo 'WARNING: seed failed (see above) - starting with an empty DB'; fi; exec uvicorn api.main:app --host 0.0.0.0 --port 8000"]
