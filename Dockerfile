# HippoCampus runtime container — sync engine + agent harness + (later) web app.
# Code runs from the /app mount (ro) so image rebuilds aren't needed on code
# changes; the image is just the runtime + deps. Auth (playwright + chromium)
# lives here too — the Debian base sidesteps the NixOS playwright problem.
FROM python:3.13-slim

# build deps for playwright chromium + system libs it needs at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ripgrep curl ca-certificates \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && playwright install chromium \
 && playwright install-deps chromium || true

# container idles; CLI via `docker exec hippo python -m sync ...`
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
CMD ["sleep", "infinity"]
