"""GET /api/search is the non-model way to search the corpus.

The agent has had the same ranker as a tool for a while, but nothing outside a
model call could reach it. The demo needs it: a stranger with no endpoint
configured should still be able to search the sample course, and that is the
command the handoff's acceptance check runs.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


@pytest.fixture()
def search_env(tmp_path: Path, monkeypatch):
    """A DB with one course, one indexed sentence, and a servable data root."""
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    content = root / "2026F" / "DEMO101" / "content"
    content.mkdir(parents=True)
    (content / "syllabus.md").write_text(
        "# Syllabus\n\nThe late penalty is 10 percent per day.\n", encoding="utf-8")

    conn = sqlite3.connect(db)
    with open("schema.sql") as f:
        conn.executescript(f.read())
    conn.execute(
        "INSERT INTO courses (code, name, term) VALUES ('DEMO 101', 'Sample', '2026F')")
    conn.commit()
    conn.close()

    from sync.config import Config
    from sync.db import DB
    from sync.search import rebuild

    harness = Config(data_root=root, db_path=db)
    db_handle = DB(db)
    rebuild(harness, db_handle)
    db_handle.close()

    import api.db as _db
    import api.services as _svc

    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "cfg", harness)
    return root


def _client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def test_search_returns_the_exact_phrase_hit(search_env):
    r = _client().get("/api/search", params={"q": "10 percent per day"})

    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "10 percent per day"
    assert body["hits"], "an exact phrase from the corpus must return a hit"
    assert any(h["ref"].endswith("syllabus.md") for h in body["hits"])


def test_search_is_empty_for_a_phrase_that_is_not_there(search_env):
    r = _client().get("/api/search", params={"q": "quantum chromodynamics"})

    assert r.status_code == 200
    assert r.json()["hits"] == []


def test_search_requires_a_query(search_env):
    assert _client().get("/api/search").status_code == 422


def test_search_can_be_scoped_to_a_course(search_env):
    courses = _client().get("/api/courses").json()
    course_id = next(c["id"] for c in courses if c["code"] == "DEMO 101")

    hit = _client().get(
        "/api/search", params={"q": "10 percent per day", "course_id": course_id})
    miss = _client().get(
        "/api/search", params={"q": "10 percent per day", "course_id": course_id + 999})

    assert hit.json()["hits"]
    assert miss.json()["hits"] == []
