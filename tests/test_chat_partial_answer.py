"""A turn that dies must still leave what it already wrote.

The assistant node used to be written only after run_turn returned, so a provider
that stalled for ten minutes and then a restart lost the whole answer while the
tool steps survived — one real turn ended up as ten tool rows and no report.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO = Path(__file__).resolve().parent.parent

from api.main import app  # noqa: E402


@pytest.fixture()
def chat_env(tmp_path: Path, monkeypatch):
    dbp = tmp_path / "harness.db"
    school = tmp_path / "school"
    conn = sqlite3.connect(dbp)
    conn.executescript((REPO / "schema.sql").read_text())
    conn.execute("INSERT INTO courses (code,name,term) VALUES (?,?,?)",
                 ("CS 1100A", "Intro to Programming", "2026F"))
    conn.commit()
    conn.close()
    from sync.db import DB
    DB(dbp).close()

    # A REAL Config instance (defaults and all): the endpoint reaches for many
    # attributes, and a hand-rolled stub turns every one it forgot into an
    # AttributeError that looks like a product failure.
    from sync.config import Config

    real = Config()
    real.db_path = str(dbp)
    real.data_root = school
    real.llm_model = "test-model"
    real.terminal_enabled = False
    real.demo = False
    monkeypatch.setattr(Config, "load", classmethod(lambda cls, *a, **k: real))
    import api.config as _cfg
    import api.db as _db
    import api.services as svc

    # api.auth captures its Config at import, so the session gate would still
    # demand the real deployment's password (401) no matter what Config.load
    # returns later.
    import api.auth as _auth

    monkeypatch.setattr(_auth, "cfg", real)
    monkeypatch.setattr(_cfg, "DB_PATH", dbp)
    monkeypatch.setattr(_db, "DB_PATH", dbp)
    monkeypatch.setattr(svc, "DB_PATH", dbp)
    monkeypatch.setattr(svc, "SCHOOL_ROOT", school)
    school.mkdir(parents=True, exist_ok=True)
    return dbp


def _session(dbp: Path) -> int:
    conn = sqlite3.connect(dbp)
    try:
        return conn.execute(
            "INSERT INTO chat_sessions (course_id, title) VALUES (1, 'partial')"
        ).lastrowid
    finally:
        conn.commit()
        conn.close()


def _assistant_node(dbp: Path, sid: int, nid: str):
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT content, data_json FROM chat_nodes WHERE session_id=? AND id=?",
            (sid, nid),
        ).fetchone()
        if not row:
            return None
        return row["content"]
    finally:
        conn.close()


def test_a_turn_that_raises_still_stores_the_text_it_streamed(chat_env, monkeypatch):
    dbp = chat_env
    sid = _session(dbp)
    import agent.chat as agent_chat

    def fake_run_turn(cfg, db, message, **kw):
        emit = kw["emit"]
        emit("token", {"text": "The report text is written: lab5-report.md. "})
        emit("token", {"text": "y" * 700})
        raise RuntimeError("provider stalled")

    monkeypatch.setattr(agent_chat, "run_turn", fake_run_turn)

    payload = {
        "message": "write the report",
        "course_id": 1,
        "session_id": sid,
        "user_node_id": "u1",
        "assistant_node_id": "a1",
    }
    with TestClient(app) as client:
        with client.stream("POST", "/api/chat", json=payload) as r:
            for _ in r.iter_lines():
                pass

    content = _assistant_node(dbp, sid, "a1")
    assert content is not None, "the partial answer was never written"
    assert content.startswith("The report text is written: lab5-report.md.")
    assert len(content) > 700


def test_a_finished_turn_clears_the_streaming_flag(chat_env, monkeypatch):
    dbp = chat_env
    sid = _session(dbp)
    import agent.chat as agent_chat

    def fake_run_turn(cfg, db, message, **kw):
        emit = kw["emit"]
        emit("token", {"text": "done properly"})
        return "done properly", [{"role": "assistant", "content": "done properly"}]

    monkeypatch.setattr(agent_chat, "run_turn", fake_run_turn)

    payload = {
        "message": "hi",
        "course_id": 1,
        "session_id": sid,
        "user_node_id": "u2",
        "assistant_node_id": "a2",
    }
    with TestClient(app) as client:
        with client.stream("POST", "/api/chat", json=payload) as r:
            for _ in r.iter_lines():
                pass

    content = _assistant_node(dbp, sid, "a2")
    assert content == "done properly"
