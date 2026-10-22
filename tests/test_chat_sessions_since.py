"""The session list can be asked for a delta.

`GET /api/chat/sessions` returns every session with its whole tree — ~27 MB once a
few long conversations exist. A phone cannot reliably pull that on a mobile
connection, so it sat behind for days while the desktop stayed current. `since`
(epoch seconds) returns only the sessions touched after that moment.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

TREE = {"nodes": [{"id": "n1", "role": "assistant", "content": "hi",
                   "createdAt": 1}], "activeNodeId": "n1"}


def _epoch(y: int, mo: int, d: int, h: int = 0) -> int:
    return int(datetime(y, mo, d, h, tzinfo=timezone.utc).timestamp())


@pytest.fixture()
def two_sessions(tmp_path, monkeypatch):
    """One chat from October 1st, one from October 22nd."""
    dbp = tmp_path / "sessions.db"
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    conn.executescript((REPO / "schema.sql").read_text())
    old = conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json, model, updated_at) "
        "VALUES (NULL, ?, ?, ?, '2026-10-01 10:00:00')",
        ("old chat", json.dumps(TREE), "m"),
    ).lastrowid
    new = conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json, model, updated_at) "
        "VALUES (NULL, ?, ?, ?, '2026-10-22 10:00:00')",
        ("new chat", json.dumps(TREE), "m"),
    ).lastrowid
    conn.commit()
    conn.close()

    from sync.config import Config

    class _Cfg:
        db_path = str(dbp)

    monkeypatch.setattr(Config, "load", classmethod(lambda cls, *a, **k: _Cfg()))
    return old, new


def test_since_returns_only_the_sessions_touched_after_it(two_sessions):
    from api.routers.chat import list_sessions

    old, new = two_sessions
    out = list_sessions(since=_epoch(2026, 10, 20))
    ids = [s["id"] for s in out]
    assert new in ids
    assert old not in ids, "a session untouched since the cutoff must not be resent"


def test_since_still_carries_the_full_tree_of_what_it_does_return(two_sessions):
    from api.routers.chat import list_sessions

    _, new = two_sessions
    out = list_sessions(since=_epoch(2026, 10, 20))
    got = [s for s in out if s["id"] == new][0]
    assert got["nodes"] and got["nodes"][0]["id"] == "n1"


def test_no_since_still_returns_everything(two_sessions):
    """A device with no local history (a fresh browser) needs the lot."""
    from api.routers.chat import list_sessions

    old, new = two_sessions
    ids = [s["id"] for s in list_sessions()]
    assert {old, new} <= set(ids)


def test_since_cannot_hide_a_session_renamed_after_the_cutoff(two_sessions):
    """A rename bumps updated_at, so the delta picks it up like any other change."""
    from api.routers.chat import list_sessions

    old, new = two_sessions
    cutoff = _epoch(2026, 10, 20)
    assert old not in [s["id"] for s in list_sessions(since=cutoff)]

    from sync.config import Config
    conn = sqlite3.connect(Config.load().db_path)
    conn.execute("UPDATE chat_sessions SET updated_at='2026-10-22 11:00:00' WHERE id=?",
                 (old,))
    conn.commit()
    conn.close()

    assert old in [s["id"] for s in list_sessions(since=cutoff)]
