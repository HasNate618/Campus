"""Campus FastAPI application."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from api.auth import require_auth
from api.auth import router as auth_router
from api.db import db_available, ensure_wal
from api.routers import chat, courses, data, digest, sync

ensure_wal()  # WAL so API readers never block the sync writer

app = FastAPI(title="Campus", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Single-password web auth: the auth router is registered before the data
# routers so /api/auth/* resolves before the catch-all SPA route below. Each
# data router is gated through require_auth, which is a no-op when
# cfg.web_password is empty (open demo mode). /api/auth/*, /api/health,
# /api/config and all static SPA assets stay public.
app.include_router(auth_router)
app.include_router(courses.router, dependencies=[Depends(require_auth)])
app.include_router(data.router, dependencies=[Depends(require_auth)])
app.include_router(sync.router, dependencies=[Depends(require_auth)])
app.include_router(digest.router, dependencies=[Depends(require_auth)])
app.include_router(chat.router, dependencies=[Depends(require_auth)])


@app.get("/api/health")
def health():
    return {"status": "ok", "db": db_available()}


# ── SPA serving ─────────────────────────────────────────────────────────
# A StaticFiles mount at "/" swallows every path and 404s non-file routes
# (e.g. /courses/1/content/2 on a hard reload). Instead: serve the built
# PWA with explicit routes — /api/* keeps passing through the routers
# registered above; every other GET serves a real static file when it
# exists under WEB_DIST, otherwise the index.html shell (client routing).
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


# Cache policy (2026-08-03, stale-bundle killer):
#   - index.html (the SPA shell) MUST NEVER be cached: it references the
#     hashed bundle names, so a cached shell = a stale bundle forever.
#     FileResponse alone sends no Cache-Control → browsers heuristically
#     cache the shell → the user's browser ran index-CSYD4hz4.js while the
#     server served index-aSputqFv.js. no-store makes that impossible.
#   - Hashed assets under /assets/ (Vite content-hashes them) are safe to
#     cache immutably.
_NO_STORE = {"Cache-Control": "no-store"}
_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


def _index_response(index: Path):
    return FileResponse(index, headers=_NO_STORE)


@app.get("/")
def spa_index():
    index = WEB_DIST / "index.html"
    if index.is_file():
        return _index_response(index)
    return JSONResponse({"detail": "Frontend not built"}, status_code=404)


@app.get("/{path:path}")
def spa_fallback(path: str):
    # API misses must 404, not fall through to the SPA shell.
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    dist = WEB_DIST.resolve()
    if not dist.exists():
        return JSONResponse({"detail": "Frontend not built"}, status_code=404)
    # path traversal guard: only serve files actually under WEB_DIST
    candidate = (dist / path).resolve()
    if candidate.is_relative_to(dist) and candidate.is_file():
        rel = candidate.relative_to(dist).as_posix()
        headers = _IMMUTABLE if rel.startswith("assets/") else None
        return FileResponse(candidate, headers=headers)
    index = dist / "index.html"
    if index.is_file():
        return _index_response(index)
    return JSONResponse({"detail": "Not Found"}, status_code=404)
