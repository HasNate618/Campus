"""Chat attachments live in the course workspace and arrive as a path manifest.

Uploading stores raw bytes in `<course>/uploads/` — nothing is extracted — and
the turn's prompt lists each non-image file as `name (mime, size) path=…` with
an instruction to call `extract_file(path)`. Images keep riding in the message
as `image_url` parts, because vision needs the bytes inline.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parent.parent

# Import the app while api.config can still load a real Config: the per-test
# stub below replaces Config.load, and api.config calls it at import time.
from api.main import app  # noqa: E402

MANIFEST_PATH = "2026F/CS1100A/uploads/deadbeef-notes.txt"


@pytest.fixture()
def chat_env(tmp_path: Path, monkeypatch):
    """A seeded DB + temp data root, wired into api.routers.chat's Config.load."""
    dbp = tmp_path / "harness.db"
    school = tmp_path / "school"
    conn = sqlite3.connect(dbp)
    conn.executescript((REPO / "schema.sql").read_text())
    conn.execute("INSERT INTO courses (code,name,term) VALUES (?,?,?)",
                 ("CS 1100A", "Introduction to Programming", "2026F"))
    conn.commit()
    conn.close()

    # chat_attachments is created by sync.db's migration, not schema.sql.
    from sync.db import DB
    DB(dbp).close()

    from sync.config import Config

    class _Cfg:
        db_path = str(dbp)
        data_root = school

    monkeypatch.setattr(Config, "load", classmethod(lambda cls, *a, **k: _Cfg()))
    # api.config resolves DB_PATH at import, so patching Config.load alone only
    # reaches the router paths that re-load the config per request (chat.py).
    # The course lookup goes through api.services -> api.db, which read the
    # frozen module-level DB_PATH, so point those at this test's DB too. Same
    # pattern as tests/test_assets_api.py.
    import api.config as _cfg
    import api.db as _db
    import api.services as svc

    monkeypatch.setattr(_cfg, "DB_PATH", dbp)
    monkeypatch.setattr(_db, "DB_PATH", dbp)
    monkeypatch.setattr(svc, "DB_PATH", dbp)
    monkeypatch.setattr(svc, "SCHOOL_ROOT", school)
    (school / "2026F" / "CS1100A" / "uploads").mkdir(parents=True)
    return dbp, school


def _client():
    return TestClient(app)


def _row(dbp: Path, aid: str):
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            "SELECT stored_path, size, extracted_text FROM chat_attachments WHERE id=?",
            (aid,),
        ).fetchone()
    finally:
        conn.close()


def test_chat_upload_lands_in_the_course_workspace(chat_env):
    dbp, school = chat_env
    r = _client().post(
        "/api/chat/uploads?course_id=1",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"].startswith("2026F/CS1100A/uploads/")
    assert body["size"] == 11
    assert (school / body["path"]).read_bytes() == b"hello world"
    # The row points at the workspace path, and nothing was extracted.
    row = _row(dbp, body["id"])
    assert row["stored_path"] == body["path"]
    assert row["size"] == 11
    assert row["extracted_text"] is None


def test_chat_upload_rejects_unknown_course(chat_env):
    r = _client().post(
        "/api/chat/uploads?course_id=999",
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert r.status_code == 400


def test_chat_upload_accepts_any_format(chat_env):
    """No allowlist: the workspace takes any bytes; extraction is on demand."""
    r = _client().post(
        "/api/chat/uploads?course_id=1",
        files={"file": ("archive.zip", b"PK\x03\x04", "application/zip")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["mime"] == "application/zip"


def test_load_attachments_returns_workspace_path(chat_env):
    dbp, _ = chat_env
    conn = sqlite3.connect(dbp)
    conn.execute(
        "INSERT INTO chat_attachments (id,original_name,mime_type,stored_path,size,sha256) "
        "VALUES (?,?,?,?,?,?)",
        ("a1", "notes.txt", "text/plain", MANIFEST_PATH, 3, "x"),
    )
    conn.commit()
    conn.close()

    from api.routers.chat import _load_attachments
    from sync.config import Config
    from sync.db import DB

    db = DB(Config.load().db_path)
    try:
        rows = _load_attachments(db, Config.load(), ["a1"])
    finally:
        db.close()
    assert rows[0]["path"] == MANIFEST_PATH
    assert rows[0]["size"] == 3


def test_manifest_lists_paths_and_omits_images():
    from agent.chat import build_attachment_manifest

    block = build_attachment_manifest([
        {"original_name": "notes.txt", "mime_type": "text/plain",
         "size": 11, "path": MANIFEST_PATH},
        {"original_name": "fig.png", "mime_type": "image/png",
         "size": 5, "path": "2026F/CS1100A/uploads/fig.png"},
    ])
    assert "notes.txt" in block
    assert f"path={MANIFEST_PATH}" in block
    assert "extract_file" in block
    assert "fig.png" not in block  # images ride as image_url, not as a path
    # No file *contents* are embedded — only the path manifest.
    assert "hello" not in block


def test_manifest_is_empty_without_non_image_files():
    from agent.chat import build_attachment_manifest

    assert build_attachment_manifest([]) == ""
    assert build_attachment_manifest(
        [{"original_name": "f.png", "mime_type": "image/png", "size": 1, "path": "p"}]
    ) == ""
