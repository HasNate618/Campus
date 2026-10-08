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
