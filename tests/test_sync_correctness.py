"""Regression tests for correctness bugs found during the code review.

Each test here pins behaviour that was silently broken, so the specific
regression cannot come back unnoticed.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


# ── auth() must always receive its token store ──────────────────────────


def test_auth_requires_a_token_store():
    """auth() persists the token with store.save(store.build(...))."""
    from sync.auth import auth

    params = inspect.signature(auth).parameters
    assert "store" in params
    assert params["store"].default is inspect.Parameter.empty


def test_every_auth_call_site_passes_a_store():
    """The auto-reauth path was silently broken.

    Four call sites (the CLI's expired-token reauth, both D2LClient
    on_auth_error callbacks, and the API's mid-sync retry) called auth(cfg)
    with no store, so reauthentication raised TypeError. The CLI swallowed
    it in `except Exception` and exited 1; the API swallowed it too. Nothing
    caught it because no test drives Playwright login.
    """
    offenders = []
    for rel in ("sync/sync.py", "api/services.py", "sync/auth.py"):
        tree = ast.parse((REPO / rel).read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else getattr(fn, "attr", None)
            if name not in ("auth", "_auth", "do_auth"):
                continue
            if len(node.args) < 2:
                offenders.append(f"{rel}:{node.lineno} {name}()")
    assert not offenders, "auth() needs the token store: " + ", ".join(offenders)


# ── every active memory fact must be indexed ────────────────────────────


class _Cfg:
    def __init__(self, root: Path):
        self.data_root = root


def test_every_active_fact_gets_its_own_ref(db_path, tmp_path):
    """Facts used to share a single ref per course, and rebuild() deletes by
    ref before inserting — so only the last fact of each course stayed in the
    index, silently gutting the corpus search_corpus reads from.
    """
    from sync.db import DB
    from sync.search import _corpus

    db = DB(db_path)
    cid = db.conn.execute("SELECT id FROM courses LIMIT 1").fetchone()["id"]
    for i in range(3):
        db.conn.execute(
            "INSERT INTO memory_facts (course_id, fact, category, source, is_active)"
            " VALUES (?,?,?,?,1)",
            (cid, f"fact number {i}", "general", "user"),
        )
    db.conn.commit()

    refs = [i["ref"] for i in _corpus(_Cfg(tmp_path), db) if i["ref"].startswith("fact/")]
    assert len(refs) == 3, refs
    assert len(set(refs)) == 3, f"fact refs must be unique, got {refs}"


# ── sync must not clobber user assignment status ────────────────────────


def test_sync_does_not_reset_user_assignment_status(db_path):
    """`status` holds user state (graded/submitted/in_progress/extended).
    Sync has no LMS status to apply, yet it forced everything back to 'open'
    on every run, so those states never stuck and the rows silently dropped
    out of the open-assignment counts.
    """
    from sync.db import DB

    db = DB(db_path)
    cid = db.conn.execute("SELECT id FROM courses LIMIT 1").fetchone()["id"]
    aid, is_new = db.upsert_assignment(
        cid, {"title": "Essay 1", "brightspace_folder_id": "f-1", "due_at": None})
    assert is_new
    db.conn.execute("UPDATE assignments SET status='graded' WHERE id=?", (aid,))
    db.conn.commit()

    db.upsert_assignment(
        cid, {"title": "Essay 1 (renamed)", "brightspace_folder_id": "f-1", "due_at": None})

    row = db.conn.execute(
        "SELECT status, title FROM assignments WHERE id=?", (aid,)).fetchone()
    assert row["status"] == "graded", "sync reopened a graded assignment"
    assert row["title"] == "Essay 1 (renamed)", "sync stopped updating other fields"
