"""HippoCampus FastAPI application."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.db import db_available, ensure_wal
from api.routers import chat, courses, data, digest, sync

ensure_wal()  # WAL so API readers never block the sync writer

app = FastAPI(title="HippoCampus", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses.router)
app.include_router(data.router)
app.include_router(sync.router)
app.include_router(digest.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "db": db_available()}


# Serve built frontend in production
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="static")
