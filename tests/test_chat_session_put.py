"""PUT /api/chat/sessions/{sid} is a partial update.

`nodes` is optional in SessionUpdate, so a caller that omits the tree (a
rename, or any non-bundled client) must leave nodes_json alone. The previous
implementation always wrote `body.nodes or []`, replacing the whole
conversation with an empty tree — irreversibly.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

TREE = {"nodes": [{"id": "n1", "role": "assistant", "content": "hi"}],
        "activeNodeId": "n1"}


@pytest.fixture()
def session_db(tmp_path, monkeypatch):
    """A DB with one chat session, wired into api.routers.chat's Config.load."""
    dbp = tmp_path / "chat.db"
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    conn.executescript((REPO / "schema.sql").read_text())
    sid = conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json, model) VALUES (NULL,?,?,?)",
        ("Old title", json.dumps(TREE), "model-a"),
    ).lastrowid
    conn.commit()
    conn.close()

    from sync.config import Config

    class _Cfg:
        db_path = str(dbp)

    monkeypatch.setattr(Config, "load", classmethod(lambda cls, *a, **k: _Cfg()))
    return dbp, sid


def _row(dbp, sid):
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(
            "SELECT title, nodes_json, model FROM chat_sessions WHERE id=?", (sid,)
        ).fetchone()
    finally:
        conn.close()


def test_title_only_update_preserves_the_tree(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    assert put_session(sid, SessionUpdate(title="Renamed")) == {"ok": True, "id": sid}
    row = _row(dbp, sid)
    assert row["title"] == "Renamed"
    assert json.loads(row["nodes_json"]) == TREE   # the regression under test
    assert row["model"] == "model-a"               # omitted -> kept


def test_explicit_empty_tree_still_clears(session_db):
    """Sending nodes explicitly must remain able to clear the tree."""
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(nodes=[], activeNodeId=None))
    assert json.loads(_row(dbp, sid)["nodes_json"]) == {"nodes": [], "activeNodeId": None}


def test_nodes_update_replaces_the_tree(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    new = {"nodes": [{"id": "z", "role": "user", "content": "q"}], "activeNodeId": "z"}
    put_session(sid, SessionUpdate(nodes=new["nodes"], activeNodeId="z"))
    assert json.loads(_row(dbp, sid)["nodes_json"]) == new


def test_omitted_model_keeps_and_explicit_null_clears(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(model=None))
    assert _row(dbp, sid)["model"] is None
    put_session(sid, SessionUpdate(model="model-b"))
    assert _row(dbp, sid)["model"] == "model-b"
    put_session(sid, SessionUpdate(title="x"))     # omitted -> keeps model-b
    assert _row(dbp, sid)["model"] == "model-b"


def test_updated_at_uses_the_supplied_epoch(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(title="x", updatedAt=1_700_000_000_000))
    conn = sqlite3.connect(dbp)
    got = conn.execute("SELECT updated_at FROM chat_sessions WHERE id=?", (sid,)).fetchone()[0]
    conn.close()
    assert got.startswith("2023-11-14")


def test_missing_session_is_404(session_db):
    from fastapi import HTTPException

    from api.routers.chat import SessionUpdate, put_session

    with pytest.raises(HTTPException) as err:
        put_session(99999, SessionUpdate(title="x"))
    assert err.value.status_code == 404
