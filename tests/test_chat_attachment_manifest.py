"""An attached file stays visible for the rest of the conversation.

The manifest used to describe only the turn's own attachments. On the next
question the model had no idea the file existed: it answered "the assignment PDF
has no attachment in my harness records" about a PDF sitting in the course
workspace, because it went looking through Brightspace records instead. The user
re-uploaded the file and got the same answer, since a re-upload is a new turn
whose history is again invisible.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

PDF = {"id": "att1", "name": "Submit_Assignment_2.pdf", "mime": "application/pdf",
       "size": 406316, "path": "2026F/SE3310A/uploads/Submit_Assignment_2.pdf"}


@pytest.fixture()
def db(tmp_path):
    dbp = tmp_path / "att.db"
    conn = sqlite3.connect(dbp)
    conn.executescript((REPO / "schema.sql").read_text())
    conn.commit()
    conn.close()
    from sync.db import DB

    d = DB(dbp)
    yield d
    d.close()


def _session(db, title="att") -> int:
    return db.conn.execute(
        "INSERT INTO chat_sessions (course_id, title) VALUES (NULL, ?)", (title,)).lastrowid


def test_a_file_attached_earlier_is_still_listed(db):
    from api import chat_nodes
    from api.routers.chat import _session_attachment_files

    s = _session(db)
    chat_nodes.save_nodes(db, s, [
        {"id": "u1", "parentId": None, "role": "user", "content": "the attached assignment",
         "attachments": [PDF], "children": []},
        {"id": "a1", "parentId": "u1", "role": "assistant", "content": "ok", "children": []},
        {"id": "u2", "parentId": "a1", "role": "user", "content": "walk me through 1.2",
         "children": []},
    ])
    files = _session_attachment_files(db, s)
    assert [f["path"] for f in files] == [PDF["path"]]
    assert files[0]["earlier"] is True
    assert files[0]["original_name"] == PDF["name"]
    assert files[0]["mime_type"] == "application/pdf"


def test_the_same_file_attached_twice_is_listed_once(db):
    from api import chat_nodes
    from api.routers.chat import _session_attachment_files

    s = _session(db)
    chat_nodes.save_nodes(db, s, [
        {"id": "u1", "parentId": None, "role": "user", "content": "a", "attachments": [PDF]},
        {"id": "u2", "parentId": "u1", "role": "user", "content": "b", "attachments": [
            dict(PDF, id="att2")]},
    ])
    assert len(_session_attachment_files(db, s)) == 1


def test_the_manifest_names_the_path_and_the_tool(db):
    from agent.chat import build_attachment_manifest

    text = build_attachment_manifest([
        {"original_name": "a.pdf", "mime_type": "application/pdf", "size": 10,
         "path": "2026F/SE3310A/uploads/a.pdf", "earlier": True},
    ])
    assert "path=2026F/SE3310A/uploads/a.pdf" in text
    assert "extract_file" in text
    assert "earlier in this chat" in text


def test_the_manifest_skips_images_and_empty_input():
    from agent.chat import build_attachment_manifest

    assert build_attachment_manifest([]) == ""
    assert build_attachment_manifest([
        {"original_name": "p.png", "mime_type": "image/png", "size": 1, "path": "p.png"},
    ]) == ""
