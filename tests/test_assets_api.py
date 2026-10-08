"""GET /api/assets/{path} is the download path for workspace files.

No server change accompanies this feature — the route already serves anything
under the data root — but the new Download control depends on it, so pin the
two properties that matter: it serves a workspace upload, and it cannot be
walked out of the data root.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


@pytest.fixture()
def asset_env(tmp_path: Path, monkeypatch):
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    with open("schema.sql") as f:
        conn.executescript(f.read())
    conn.execute(
        "INSERT INTO courses (code,name,term) VALUES (?,?,?)",
        ("CS 1100A", "Introduction to Programming", "2026F"),
    )
    conn.commit()
    conn.close()
    import api.config as _cfg
    import api.db as _db
    import api.services as _svc
    monkeypatch.setattr(_cfg, "DB_PATH", db)
    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "SCHOOL_ROOT", root)
    up = root / "2026F" / "CS1100A" / "uploads"
    up.mkdir(parents=True)
    (up / "notes.txt").write_text("hello from the workspace")
    return root


def _client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def test_asset_route_serves_a_workspace_upload(asset_env):
    r = _client().get("/api/assets/2026F/CS1100A/uploads/notes.txt")
    assert r.status_code == 200
    assert r.text == "hello from the workspace"


def test_asset_route_serves_a_path_with_spaces(asset_env):
    """The path the old raw-interpolated href could not express."""
    d = asset_env / "2026F" / "CS1100A" / "content" / "Course Overview"
    d.mkdir(parents=True)
    (d / "outline.md").write_text("outline")
    r = _client().get("/api/assets/2026F/CS1100A/content/Course%20Overview/outline.md")
    assert r.status_code == 200
    assert r.text == "outline"


def test_asset_route_refuses_traversal(asset_env):
    # Encoded so the client does not normalise it away before it is sent.
    r = _client().get("/api/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd")
    assert r.status_code in (400, 403, 404)
    assert "root:" not in r.text


def test_asset_route_404s_a_missing_file(asset_env):
    r = _client().get("/api/assets/2026F/CS1100A/uploads/nope.txt")
    assert r.status_code == 404
