"""Per-node chat storage — the two-device bug, encoded.

A conversation used to be one JSON blob per session replaced wholesale on every
save. Whichever device wrote last owned the whole tree, so a phone holding an
18-node cache that PUT before a desktop's 25-node version destroyed seven
messages silently: valid JSON, valid SQL, nothing logged.

These tests pin the property that replaces it: a save can only add or update the
nodes it names. Nothing it has never seen can be removed by it.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent


@pytest.fixture()
def db(tmp_path):
    dbp = tmp_path / "nodes.db"
    conn = sqlite3.connect(dbp)
    conn.executescript((REPO / "schema.sql").read_text())
    conn.commit()
    conn.close()
    from sync.db import DB

    d = DB(dbp)
    yield d
    d.close()


def sid(db, title="t") -> int:
    return db.conn.execute(
        "INSERT INTO chat_sessions (course_id, title) VALUES (NULL, ?)", (title,)).lastrowid


def count(db, session):
    return db.conn.execute(
        "SELECT COUNT(*) FROM chat_nodes WHERE session_id=?", (session,)).fetchone()[0]


def ids(db, session):
    return [r[0] for r in db.conn.execute(
        "SELECT id FROM chat_nodes WHERE session_id=? ORDER BY position", (session,))]


# --- the regression ---------------------------------------------------------

def test_a_stale_device_cannot_delete_turns_it_never_saw(db):
    """Phone has 2 nodes, desktop added a 3rd, phone saves its stale copy."""
    from api import chat_nodes

    s = sid(db)
    a1 = {"id": "a1", "parentId": None, "role": "user", "content": "q1", "children": ["a2"]}
    a2 = {"id": "a2", "parentId": "a1", "role": "assistant", "content": "r1", "children": []}
    chat_nodes.save_nodes(db, s, [a1, a2])

    a3 = {"id": "a3", "parentId": "a2", "role": "user", "content": "q2", "children": []}
    chat_nodes.save_nodes(db, s, [a3])          # desktop's newer turn
    assert count(db, s) == 3

    # the phone now saves what it has: the two nodes it knows about
    chat_nodes.save_nodes(db, s, [a1, a2])
    assert count(db, s) == 3                    # a3 survived the stale save
    assert "a3" in ids(db, s)


def test_only_named_nodes_are_removed(db):
    from api import chat_nodes

    s = sid(db)
    nodes = [{"id": f"n{i}", "parentId": None, "role": "user", "content": str(i)}
             for i in range(4)]
    chat_nodes.save_nodes(db, s, nodes)
    res = chat_nodes.save_nodes(db, s, None, ["n2"])
    assert res["removed"] == 1
    assert ids(db, s) == ["n0", "n1", "n3"]     # exactly one gone
    # a later save that does not mention the deletion cannot resurrect or remove
    chat_nodes.save_nodes(db, s, [{"id": "n9", "parentId": None, "role": "user",
                                   "content": "x"}])
    assert sorted(ids(db, s)) == ["n0", "n1", "n3", "n9"]


def test_an_empty_save_writes_nothing(db):
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "a", "role": "user", "content": "x"}])
    res = chat_nodes.save_nodes(db, s, [])
    assert res == {"added": 0, "updated": 0, "removed": 0, "total": 1}


# --- tree assembly ----------------------------------------------------------

def test_children_order_follows_the_writer(db):
    """Branch order is the client's, not insertion order."""
    from api import chat_nodes

    s = sid(db)
    root = {"id": "r", "parentId": None, "role": "user", "content": "q",
            "children": ["c2", "c1"]}
    chat_nodes.save_nodes(db, s, [root])
    chat_nodes.save_nodes(db, s, [
        {"id": "c1", "parentId": "r", "role": "assistant", "content": "one", "children": []},
        {"id": "c2", "parentId": "r", "role": "assistant", "content": "two", "children": []},
    ])
    tree = chat_nodes.load_tree(db, s)
    by_id = {n["id"]: n for n in tree["nodes"]}
    assert by_id["r"]["children"] == ["c2", "c1"]


def test_a_child_the_writer_forgot_is_still_linked(db):
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "r", "parentId": None, "role": "user",
                                   "content": "q", "children": []}])
    chat_nodes.save_nodes(db, s, [{"id": "c", "parentId": "r", "role": "assistant",
                                   "content": "a"}])
    by_id = {n["id"]: n for n in chat_nodes.load_tree(db, s)["nodes"]}
    assert by_id["r"]["children"] == ["c"]      # derived from parentId


def test_active_node_round_trips(db):
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "x", "role": "user", "content": "q"}])
    chat_nodes.set_active_node(db, s, "x")
    assert chat_nodes.load_tree(db, s)["activeNodeId"] == "x"


def test_transient_ui_flags_do_not_round_trip(db):
    """A node stored mid-stream would come back with a spinner stuck on it."""
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "x", "role": "assistant", "content": "q",
                                   "streaming": True, "open": True}])
    node = chat_nodes.load_tree(db, s)["nodes"][0]
    assert "streaming" not in node and "open" not in node


def test_rich_fields_survive(db):
    from api import chat_nodes

    s = sid(db)
    node = {"id": "x", "role": "assistant", "content": "ans",
            "steps": [{"kind": "tool", "name": "search"}],
            "tokens": {"total_tokens": 12}, "model": "m", "thinking": "hmm",
            "citations": [{"title": "t"}], "intermediate": False}
    chat_nodes.save_nodes(db, s, [node])
    got = chat_nodes.load_tree(db, s)["nodes"][0]
    for k in ("steps", "tokens", "model", "thinking", "citations"):
        assert got[k] == node[k]


# --- the broken-stream case -------------------------------------------------

def test_a_turn_persists_without_any_client_save(db):
    """What the chat endpoint does after streaming: write both nodes itself, so
    a cut stream or a closed tab cannot lose the answer."""
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "u1", "parentId": None, "role": "user",
                                   "content": "question", "children": ["a1"],
                                   "createdAt": 1_700_000_000_000}])
    chat_nodes.save_nodes(db, s, [{"id": "a1", "parentId": "u1", "role": "assistant",
                                   "content": "the answer", "children": [],
                                   "createdAt": 1_700_000_001_000}])
    chat_nodes.set_active_node(db, s, "a1")
    tree = chat_nodes.load_tree(db, s)
    assert [n["id"] for n in tree["nodes"]] == ["u1", "a1"]
    assert tree["activeNodeId"] == "a1"
    assert tree["nodes"][1]["content"] == "the answer"


def test_a_shorter_assistant_copy_cannot_overwrite_the_answer(db):
    """The broken-stream case: the server finished the answer, the browser lost
    the stream and wrote a ⚠ notice under the same id. The answer stays."""
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "a1", "role": "assistant",
                                   "content": "the complete answer, long"}])
    chat_nodes.save_nodes(db, s, [{"id": "a1", "role": "assistant",
                                   "content": "⚠ Stream failed"}])
    got = chat_nodes.load_tree(db, s)["nodes"][0]["content"]
    assert got == "the complete answer, long"


def test_a_longer_assistant_copy_still_lands(db):
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "a1", "role": "assistant", "content": "par"}])
    chat_nodes.save_nodes(db, s, [{"id": "a1", "role": "assistant",
                                   "content": "partial answer, now complete"}])
    assert chat_nodes.load_tree(db, s)["nodes"][0]["content"] == "partial answer, now complete"


def test_a_user_message_can_still_be_edited_shorter(db):
    """Only assistant content is append-only. A user edit must go through."""
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "u", "role": "user",
                                   "content": "a long question about compilers"}])
    chat_nodes.save_nodes(db, s, [{"id": "u", "role": "user", "content": "shorter"}])
    assert chat_nodes.load_tree(db, s)["nodes"][0]["content"] == "shorter"


# --- migration --------------------------------------------------------------

def test_migration_expands_the_blob_exactly_once(db):
    from api import chat_nodes

    legacy = {"nodes": [
        {"id": "n1", "parentId": None, "role": "user", "content": "hi", "children": ["n2"]},
        {"id": "n2", "parentId": "n1", "role": "assistant", "content": "yo", "children": []},
    ], "activeNodeId": "n2"}
    s = db.conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json) VALUES (NULL, 'old', ?)",
        (json.dumps(legacy),)).lastrowid
    db.conn.commit()

    assert chat_nodes.migrate_session(db, s) == 2
    assert chat_nodes.migrate_session(db, s) == 0      # idempotent
    assert count(db, s) == 2
    tree = chat_nodes.load_tree(db, s)
    assert [n["id"] for n in tree["nodes"]] == ["n1", "n2"]
    assert tree["activeNodeId"] == "n2"


def test_unmigrated_session_still_reads_from_the_blob(db):
    """The API must stay correct during the rollout window."""
    from api import chat_nodes

    legacy = {"nodes": [{"id": "n1", "parentId": None, "role": "user", "content": "hi"}],
              "activeNodeId": "n1"}
    s = db.conn.execute(
        "INSERT INTO chat_sessions (course_id, title, nodes_json) VALUES (NULL, 'old', ?)",
        (json.dumps(legacy),)).lastrowid
    db.conn.commit()
    tree = chat_nodes.load_tree(db, s)
    assert [n["id"] for n in tree["nodes"]] == ["n1"]
    assert tree["activeNodeId"] == "n1"


def test_the_compatibility_snapshot_tracks_the_rows(db):
    from api import chat_nodes

    s = sid(db)
    chat_nodes.save_nodes(db, s, [{"id": "a", "parentId": None, "role": "user",
                                   "content": "one", "children": ["b"]}])
    chat_nodes.save_nodes(db, s, [{"id": "b", "parentId": "a", "role": "assistant",
                                   "content": "two"}])
    snapshot = json.loads(db.conn.execute(
        "SELECT nodes_json FROM chat_sessions WHERE id=?", (s,)).fetchone()[0])
    assert [n["id"] for n in snapshot["nodes"]] == ["a", "b"]
    assert snapshot["nodes"][0]["children"] == ["b"]


def test_a_citation_is_served_with_the_pdf_that_now_exists(db_path):
    """A stored chip must open the page the label promises.

    Citations minted before a deck had a PDF point at the extracted markdown, so
    "p.12" opened a file with no pages. Repairing the rows is not enough — a
    browser holding the old copy saves it back — so the target is corrected when
    the conversation is read.
    """
    from api import chat_nodes
    from sync.db import DB

    db = DB(str(db_path))
    cur = db.conn.execute(
        "INSERT INTO chat_sessions (course_id, title) VALUES (1, 'cite test')")
    sid = cur.lastrowid
    for path in ("2026F/CS1100A/content/Week 1/deck.md",
                 "2026F/CS1100A/content/Week 1/deck.pdf"):
        db.conn.execute(
            "INSERT INTO files (course_id, content_node_id, path, kind, source, sha256, "
            "size, synced_at, processed, created_at) VALUES "
            "(1, NULL, ?, 'slide', 'manual', ?, 10, datetime('now'), 1, datetime('now'))",
            (path, path))
    db.conn.commit()
    pdf_id = db.conn.execute(
        "SELECT id FROM files WHERE path LIKE '%.pdf'").fetchone()[0]

    chat_nodes.save_nodes(db, sid, [{
        "id": "a1", "parentId": None, "role": "assistant", "content": "answer",
        "children": [], "createdAt": 1,
        "citations": [{"id": 1, "ref": "2026F/CS1100A/content/Week 1/deck.md",
                       "page": 12, "fileId": 999999}],
    }])
    tree = chat_nodes.load_tree(db, sid)
    cite = tree["nodes"][0]["citations"][0]
    assert cite["page"] == 12
    assert cite["fileId"] == pdf_id
    db.close()
