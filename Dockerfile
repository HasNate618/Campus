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
# playwright chromium system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ripgrep curl ca-certificates antiword \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

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

ENV CAMPUS_DB=/app/data/harness.db
EXPOSE 8000
# seed only when the DB is missing (prod data comes from sync, not seeds);
# pilot_data.py is a dev-only mock, never run here
CMD ["sh", "-c", "test -f $CAMPUS_DB || python seed/seed.py 2>/dev/null || true; uvicorn api.main:app --host 0.0.0.0 --port 8000"]
