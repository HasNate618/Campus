FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt ./api/
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api/ ./api/
COPY schema.sql ./
COPY seed/ ./seed/
COPY --from=web-build /app/web/dist ./web/dist
ENV HIPPO_DB=/app/data/harness.db
EXPOSE 8000
CMD ["sh", "-c", "python seed/seed.py 2>/dev/null || true; python seed/pilot_data.py 2>/dev/null || true; uvicorn api.main:app --host 0.0.0.0 --port 8000"]
