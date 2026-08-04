# pdf-extractor container — API + on-demand pattern

Runs on homelab, published `127.0.0.1:8001` (also reachable as pdf-extractor
on the Docker network, and pdf.home.lab via Caddy).

## Engine state (2026-08-03 — history of flip-flops, check the container)

The engine is set by `PDF_ENGINE` env in the docker run, defined in
`/etc/nixos/modules/server/pdf-extractor.nix`. Timeline:
- Jul: `local` (PP-OCRv6 CPU) — its sustained CPU load contributed to host
  crashes → changed to `cloud`.
- 2026-08-01: `cloud` (VLM via bifrost: `VISION_MODELS=cohere/command-a-
  vision-07-2025,opencode-go/mimo-v2.5`, ~3s/page).
- 2026-08-03: Nate reversed it — "you can change back to local pdf
  extraction" → `PDF_ENGINE=local` (PP-OCRv6 CPU OCR, ~27s/page; big books
  are overnight jobs; no API credits).

**Before assuming which engine is live, check the running container:**
`docker inspect pdf-extractor --format '{{range .Config.Env}}{{println
.}}{{end}}' | grep PDF_ENGINE`. The skill's historical notes have been
wrong twice; the container env is ground truth. Nate reverses this
decision; treat the configured engine as a live fact, not a preference.

Per-request override exists: `PUT /process?engine=auto|local|cloud`
(form field also accepted).

## Endpoints (from /openapi.json)

| Endpoint | Method | Body | Returns |
|----------|--------|------|---------|
| `/process` | **PUT** | raw PDF bytes (no JSON wrapper, no multipart) | JSON `{"page_content": "<markdown>"}` |
| `/api/upload` | POST | multipart/form-data | job id (async flow) |
| `/api/jobs` | GET | — | FINISHED job list only (in-flight jobs do NOT appear here — check `docker logs pdf-extractor` for "Page N/M" progress) |
| `/api/jobs/{id}` | GET | — | job status/result |

`page_content` is VLM-extracted markdown with structure (headers, sections)
— genuinely readable, not OCR soup. The jobs list carries full `content`
for done jobs, but that's a dead-end recovery path: see below.

## Integration pattern (2026-08-03)

- Extraction is a SERIALIZED QUEUE run AFTER the digest (`python -m sync
  extract` as a DETACHED subprocess), never in the sync critical path —
  the worker is single; long files block everything behind them.
- `extract_pdf` PUTs raw bytes to `/process`; on success writes `.md`
  beside the original (same dir, same stem) and marks `files.processed=1`
  (idempotent). Non-PDFs and >max_extract_size (default 20MB) PDFs are
  marked processed (skipped) so the queue drains. Original PDF always kept.
- **PUT timeout SCALES BY FILE SIZE** (`3600s` for >2MB, else `120s`).
  The old fixed 120s timed out the 148-page e-book mid-run, and the
  pdf-extractor DROPS the in-flight job when the requester disconnects —
  the job is GONE from /api/jobs, so the "poll /api/jobs later and pull
  the payload" recovery does NOT work. Re-PUT with a long timeout instead
  (verified: e-book extracted cleanly on retry, ~25 min).
- **`sync extract --file <PATH>` wants the ABSOLUTE path under data_root**
  (relative paths die with "is not in the subpath of
  '/srv/homelab/school'").
- Failures leave `processed=0` so a later run can retry. The worker can
  self-wedge on its 148-page demo file at startup — check
  `docker logs pdf-extractor` before assuming extraction is broken.
- Digest delta carries a bounded excerpt of each extracted .md
  (`digest_pdf_excerpt_chars`, default 2000) so the AI reads content, not
  just paths.

## Notes

- The old assumption that `/process` takes `{"path": ...}` JSON is WRONG —
  it's a raw-bytes PUT. (The earlier sync code posted JSON and silently
  failed; exceptions were swallowed.)
- Memory note: Open WebUI's content-extraction engine config points at this
  service (SQLite `rag.content_extraction_engine`), separate concern.
