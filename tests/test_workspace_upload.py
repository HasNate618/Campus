"""Workspace upload service + endpoint contracts (monkeypatched DB + root)."""
from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture()
def upload_env(tmp_path: Path, monkeypatch):
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    with open("schema.sql") as f:
        conn.executescript(f.read())
    conn.execute(
        "INSERT INTO courses (code,name,term) VALUES (?,?,?)", ("T 1000A", "T", "2026F")
    )
    conn.commit()
    conn.close()
    import api.config as _cfg
    import api.db as _db
    import api.services as _svc
    monkeypatch.setattr(_cfg, "DB_PATH", db)
    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "SCHOOL_ROOT", root)
    (root / "2026F" / "T1000A" / "uploads").mkdir(parents=True)
    return db, root


def _reader(*chunks: bytes):
    it = iter(chunks)
    return lambda _n: next(it, b"")


def test_upload_writes_bytes_and_hashes(upload_env):
    _, root = upload_env
    from api.services import workspace_upload

    out = workspace_upload(1, "uploads/x.bin", _reader(b"hello ", b"world", b""))
    assert out["size"] == 11
    assert out["sha256"] == hashlib.sha256(b"hello world").hexdigest()
    assert (root / "2026F" / "T1000A" / "uploads" / "x.bin").read_bytes() == b"hello world"


def test_upload_into_nested_dir(upload_env):
    _, root = upload_env
    from api.services import workspace_upload

    workspace_upload(1, "uploads/sub/deep.txt", _reader(b"hi", b""))
    assert (root / "2026F" / "T1000A" / "uploads" / "sub" / "deep.txt").read_bytes() == b"hi"


def test_upload_rejects_non_writable_dir(upload_env):
    from api.services import workspace_upload

    with pytest.raises(PermissionError):
        workspace_upload(1, "content/x.bin", _reader(b"x", b""))


def test_upload_rejects_traversal(upload_env):
    from api.services import workspace_upload

    with pytest.raises(ValueError):
        workspace_upload(1, "uploads/../../etc/passwd", _reader(b"x", b""))


def test_upload_rejects_oversize(upload_env, monkeypatch):
    import api.services as svc

    monkeypatch.setattr(svc, "UPLOAD_MAX_BYTES", 5)
    with pytest.raises(ValueError):
        svc.workspace_upload(1, "uploads/big.bin", _reader(b"123456789", b""))


def test_upload_leaves_no_part_file_on_failure(upload_env):
    _, root = upload_env
    from api.services import workspace_upload

    with pytest.raises(ValueError):
        workspace_upload(1, "uploads/../../etc/passwd", _reader(b"x", b""))
    assert not list(root.rglob("*.part"))


def test_uploads_dir_is_writable_in_tree(upload_env):
    from api.services import workspace_tree

    tree = workspace_tree(1)
    assert tree is not None
    up = next(n for n in tree["nodes"] if n["name"] == "uploads")
    assert up["writable"] is True


def _client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def test_upload_endpoint_writes_file(upload_env):
    _, root = upload_env
    r = _client().post(
        "/api/courses/1/workspace/upload?path=uploads/note.txt",
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == "uploads/note.txt"
    assert body["size"] == 5
    assert (root / "2026F" / "T1000A" / "uploads" / "note.txt").read_bytes() == b"hello"


def test_upload_endpoint_rejects_non_writable(upload_env):
    r = _client().post(
        "/api/courses/1/workspace/upload?path=content/x.txt",
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert r.status_code == 403


def test_upload_endpoint_writes_audit_row(upload_env):
    db_path, _ = upload_env
    r = _client().post(
        "/api/courses/1/workspace/upload?path=uploads/a.bin",
        files={"file": ("a.bin", b"abc", "application/octet-stream")},
    )
    assert r.status_code == 200
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT action FROM audit_log WHERE entity='files' AND action='upload'"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None


def test_upload_versions_a_repeated_filename(upload_env):
    """A second test.txt must not destroy the first.

    The chat attachment path has always suffixed on collision; the workspace
    Upload button wrote to the exact path named, so its repeat replaced the
    earlier file with no warning.
    """
    from api.services import workspace_upload

    first = workspace_upload(1, "uploads/test.txt", _reader(b"one", b""))
    second = workspace_upload(1, "uploads/test.txt", _reader(b"two", b""))
    assert first["path"] == "uploads/test.txt"
    assert second["path"] == "uploads/test-2.txt"


def test_upload_preserves_the_earlier_file(upload_env):
    """The point of versioning is that the first upload survives intact."""
    _, root = upload_env
    from api.services import workspace_upload

    workspace_upload(1, "uploads/test.txt", _reader(b"first", b""))
    workspace_upload(1, "uploads/test.txt", _reader(b"second", b""))
    up = root / "2026F" / "T1000A" / "uploads"
    assert (up / "test.txt").read_bytes() == b"first"
    assert (up / "test-2.txt").read_bytes() == b"second"


def test_upload_versions_outside_uploads(upload_env):
    """notes/ and work/ are writable too — the helper cannot assume uploads/."""
    from api.services import workspace_upload

    workspace_upload(1, "notes/draft.txt", _reader(b"a", b""))
    out = workspace_upload(1, "notes/draft.txt", _reader(b"b", b""))
    assert out["path"] == "notes/draft-2.txt"


def test_upload_keeps_a_free_name_unchanged(upload_env):
    """Only a collision earns a suffix — an unused name stays readable."""
    from api.services import workspace_upload

    out = workspace_upload(1, "uploads/solo.txt", _reader(b"x", b""))
    assert out["path"] == "uploads/solo.txt"
