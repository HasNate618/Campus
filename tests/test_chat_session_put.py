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
            "SELECT title, nodes_json, model, rev FROM chat_sessions WHERE id=?", (sid,)
        ).fetchone()
    finally:
        conn.close()


def test_title_only_update_preserves_the_tree(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    res = put_session(sid, SessionUpdate(title="Renamed"))
    assert res["ok"] is True and res["id"] == sid
    assert res["added"] == 0 and res["removed"] == 0   # nothing touched the tree
    row = _row(dbp, sid)
    assert row["title"] == "Renamed"
    assert json.loads(row["nodes_json"]) == TREE   # the regression under test
    assert row["model"] == "model-a"               # omitted -> kept


def test_an_empty_node_list_clears_nothing(session_db):
    """`nodes: []` used to wipe the conversation.

    It now means "no nodes to write". Removal has to name the node, which is
    what stops a stale device from destroying turns it never saw. This is a
    deliberate contract change, not an accident.
    """
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(nodes=[]))
    tree = json.loads(_row(dbp, sid)["nodes_json"])
    assert [n["id"] for n in tree["nodes"]] == ["n1"]   # still there
    assert tree["activeNodeId"] == "n1"


def test_naming_the_node_is_what_removes_it(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    res = put_session(sid, SessionUpdate(nodes=[], deletedNodeIds=["n1"]))
    assert res["removed"] == 1
    assert json.loads(_row(dbp, sid)["nodes_json"])["nodes"] == []


def test_nodes_update_upserts_and_keeps_the_rest(session_db):
    """A save adds what it names; it does not replace the tree with it."""
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    new_node = {"id": "z", "role": "user", "content": "q", "parentId": "n1"}
    put_session(sid, SessionUpdate(nodes=[new_node], activeNodeId="z"))
    tree = json.loads(_row(dbp, sid)["nodes_json"])
    ids = [n["id"] for n in tree["nodes"]]
    assert ids == ["n1", "z"]            # the node it never mentioned survived
    assert tree["activeNodeId"] == "z"
    assert tree["nodes"][0]["children"] == ["z"]   # linkage derived from parentId


def test_a_dangling_active_node_is_repaired_not_stored(session_db):
    """A pointer at a node that does not exist must not survive a save.

    The client builds the transcript by walking parents up from active_node_id,
    so a dangling one renders an empty conversation on every device (the nodes
    are all still there). Both halves are covered here: the save repairs the
    row, and the compatibility snapshot is rebuilt so a rollback path cannot
    resurrect the bad pointer.
    """
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    # adopt the legacy blob into rows first (a node save is what does that)
    put_session(sid, SessionUpdate(nodes=[{"id": "n1", "role": "assistant",
                                           "content": "hi"}]))
    put_session(sid, SessionUpdate(activeNodeId="ghost"))
    blob = json.loads(_row(dbp, sid)["nodes_json"])
    assert blob["activeNodeId"] == "n1"          # the only node: the fallback
    assert blob["activeNodeId"] != "ghost"


def test_clearing_the_pointer_on_a_populated_chat_resolves_to_a_node(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(nodes=[{"id": "n1", "role": "assistant",
                                           "content": "hi"}]))
    put_session(sid, SessionUpdate(activeNodeId=None))
    assert json.loads(_row(dbp, sid)["nodes_json"])["activeNodeId"] == "n1"


def test_a_metadata_save_does_not_touch_a_legacy_blob(session_db):
    """Repairing must not run on a session that still lives in the blob.

    There are no rows to validate against, and the repair rebuilds nodes_json
    from the rows — for a not-yet-migrated session that is an EMPTY list, so a
    rename would have destroyed the conversation.
    """
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(title="Renamed"))
    assert json.loads(_row(dbp, sid)["nodes_json"]) == TREE


def test_omitted_model_keeps_and_explicit_null_clears(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(model=None))
    assert _row(dbp, sid)["model"] is None
    put_session(sid, SessionUpdate(model="model-b"))
    assert _row(dbp, sid)["model"] == "model-b"
    put_session(sid, SessionUpdate(title="x"))     # omitted -> keeps model-b
    assert _row(dbp, sid)["model"] == "model-b"


def test_updated_at_ignores_the_client_epoch(session_db):
    """The server's clock orders the list, not whichever device saved last.

    This used to adopt the client's epoch, which made freshness a wall-clock
    race: a phone a few seconds fast stamped the near future, and every later
    desktop save landed "before" it, so the phone's cached stamp stayed newer
    forever and it never refreshed again.
    """
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    put_session(sid, SessionUpdate(title="x", updatedAt=1_700_000_000_000))
    conn = sqlite3.connect(dbp)
    got, now = conn.execute(
        "SELECT (SELECT updated_at FROM chat_sessions WHERE id=?), datetime('now')",
        (sid,)).fetchone()
    conn.close()
    assert not got.startswith("2023-11-14"), "the client epoch must not reach the column"
    assert got[:13] == now[:13], f"expected the server's hour, got {got} vs {now}"


def test_rev_advances_only_when_something_is_written(session_db):
    """rev is the cross-device freshness signal, so it must track real writes."""
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    before = _row(dbp, sid)["rev"]

    res = put_session(sid, SessionUpdate(activeNodeId="n1"))   # UI state only
    assert res["rev"] == before, "switching branch is not a content change"

    res = put_session(sid, SessionUpdate(nodes=[
        {"id": "n2", "parentId": "n1", "role": "user", "content": "hey"}]))
    assert res["rev"] == before + 1
    assert _row(dbp, sid)["rev"] == before + 1

    res = put_session(sid, SessionUpdate(title="Renamed"))
    assert res["rev"] == before + 2, "a rename is a change other devices should see"


def test_rev_is_monotonic_across_put_calls(session_db):
    from api.routers.chat import SessionUpdate, put_session

    dbp, sid = session_db
    revs = []
    for i in range(3):
        revs.append(put_session(sid, SessionUpdate(nodes=[
            {"id": f"n{i}", "role": "user", "content": "x"}]))["rev"])
    assert revs == sorted(revs) and len(set(revs)) == 3


def test_missing_session_is_404(session_db):
    from fastapi import HTTPException

    from api.routers.chat import SessionUpdate, put_session

    with pytest.raises(HTTPException) as err:
        put_session(99999, SessionUpdate(title="x"))
    assert err.value.status_code == 404
