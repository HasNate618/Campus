"""The session list is an INDEX; a conversation's messages are fetched per chat.

The full list endpoint carried every message tree and measured 42.6 MB for 75
sessions — 13.4 MB for a single course. On a phone that is a download which
routinely does not finish, so the device stayed behind for days while the
desktop looked current. `GET /chat/sessions?summary=1` returns metadata only
(15 KB for the same history) and `GET /chat/sessions/{id}` carries one tree.

Two identity rules are asserted here too, because they are what stopped one chat
appearing as several:
  * the list collapses sessions holding the SAME node-id set, whatever their
    legacy blob looks like;
  * creating a session with a `client_key` is idempotent, so a device that lost
    its server id adopts the existing row instead of making a copy.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent


def _tree(*ids: str) -> dict:
    return {
        "nodes": [
            {"id": i, "role": "assistant" if n % 2 else "user", "content": i,
             "parentId": ids[n - 1] if n else None,
             "children": [ids[n + 1]] if n + 1 < len(ids) else [],
             "createdAt": 1000 + n}
            for n, i in enumerate(ids)
        ],
        "activeNodeId": ids[-1],
    }


@pytest.fixture()
def db(tmp_path, monkeypatch):
    dbp = tmp_path / "sessions.db"
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    conn.executescript((REPO / "schema.sql").read_text())
    conn.commit()
    conn.close()

    from sync.config import Config

    class _Cfg:
        db_path = str(dbp)

    monkeypatch.setattr(Config, "load", classmethod(lambda cls, *a, **k: _Cfg()))
    return str(dbp)


def _add_session(dbp: str, title: str, nodes: list[str], updated: str = "2026-11-01 10:00:00") -> int:
    """Insert a session the way the app does: rows ARE the tree."""
    from sync.db import DB

    conn = DB(dbp).conn
    sid = conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json, updated_at) "
        "VALUES (NULL,?,?,?)", (title, json.dumps(_tree(*nodes)), updated)).lastrowid
    conn.commit()
    conn.close()
    from api import chat_nodes

    db = DB(dbp)
    chat_nodes.save_nodes(db, sid, _tree(*nodes)["nodes"])
    chat_nodes.set_active_node(db, sid, nodes[-1])
    db.close()
    return sid


def test_summary_carries_no_trees(db):
    from api.routers.chat import list_sessions

    sid = _add_session(db, "a chat", ["n1", "n2"])
    out = list_sessions(summary=1)
    got = [s for s in out if s["id"] == sid][0]
    assert "nodes" not in got, "the index must not ship message trees"
    assert got["nodeCount"] == 2
    assert got["title"] == "a chat"


def test_full_list_still_carries_trees(db):
    """Old clients (a cached bundle) must keep working."""
    from api.routers.chat import list_sessions

    sid = _add_session(db, "a chat", ["n1", "n2"])
    got = [s for s in list_sessions() if s["id"] == sid][0]
    assert [n["id"] for n in got["nodes"]] == ["n1", "n2"]


def test_one_session_can_be_fetched_on_its_own(db):
    from api.routers.chat import get_session

    sid = _add_session(db, "a chat", ["n1", "n2", "n3"])
    one = get_session(sid)
    assert [n["id"] for n in one["nodes"]] == ["n1", "n2", "n3"]
    assert one["activeNodeId"] == "n3"


def test_sessions_holding_the_same_nodes_are_listed_once(db):
    """The fingerprint is the node-id set, not the bytes of the old blob.

    One device re-created the same chat on every load; the database still holds
    thirty-five rows of it. They differ only in incidental blob detail, so a
    byte digest listed some of them and every device showed a different copy.
    """
    from api.routers.chat import list_sessions

    a = _add_session(db, "same chat", ["x1", "x2"], updated="2026-11-02 09:00:00")
    b = _add_session(db, "same chat", ["x1", "x2"], updated="2026-11-01 09:00:00")
    ids = [s["id"] for s in list_sessions(summary=1)]
    kept = [i for i in ids if i in (a, b)]
    assert kept == [a], "the newest copy of a conversation is the one listed"


def test_different_conversations_with_the_same_title_both_list(db):
    """A genuine second conversation is NOT a duplicate: different nodes."""
    from api.routers.chat import list_sessions

    a = _add_session(db, "same title", ["p1", "p2"])
    b = _add_session(db, "same title", ["q1", "q2"])
    ids = [s["id"] for s in list_sessions(summary=1)]
    assert {a, b} <= set(ids)


def test_create_with_a_client_key_is_idempotent(db):
    """A device that lost its server id must not fork the conversation."""
    from api.routers.chat import SessionCreate, create_session

    body = SessionCreate(course_id=None, title="my chat", client_key="uuid-1")
    first = create_session(body)
    assert first.get("created") is True
    second = create_session(SessionCreate(course_id=None, title="my chat again",
                                          client_key="uuid-1"))
    assert second["id"] == first["id"], "the same key must resolve to the same row"
    assert second.get("created") is False

    count = sqlite3.connect(db).execute(
        "SELECT COUNT(*) FROM chat_sessions WHERE client_key='uuid-1'").fetchone()[0]
    assert count == 1


def test_create_without_a_key_still_creates(db):
    """Older clients send no key; they must not be rejected."""
    from api.routers.chat import SessionCreate, create_session

    a = create_session(SessionCreate(course_id=None, title="t"))
    b = create_session(SessionCreate(course_id=None, title="t"))
    assert a["id"] != b["id"]
