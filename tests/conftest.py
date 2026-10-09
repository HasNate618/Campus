"""Shared pytest fixtures — a real seeded SQLite DB in a temp dir.

The API + sync code paths read the DB through `api.config.DB_PATH`
(computed at import time from CAMPUS_DB env), so tests that touch the
database set CAMPUS_DB before importing anything from `api`.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

# Pin the paths the API reads at IMPORT time. pytest imports `api.main` at
# module scope while collecting (tests/test_chat_attachments.py), which happens
# before any fixture runs, so whatever CAMPUS_DB holds at that moment is frozen
# into api.config.DB_PATH for the whole session. Left unset it froze to the
# developer's real data/harness.db: the suite then tested against real data and
# passed or failed depending on the machine (in CI that file does not exist, so
# those tests raised "no such table"). Pin a scratch dir here — module scope, so
# it lands before any test module imports `api.*` — and let the db_path fixture
# (re)seed that same file for each test.
_SCRATCH = Path(tempfile.mkdtemp(prefix="campus-test-"))
_DB = _SCRATCH / "harness.db"
_SCHOOL = _SCRATCH / "school"
os.environ["CAMPUS_DB"] = str(_DB)
os.environ["CAMPUS_SCHOOL_ROOT"] = str(_SCHOOL)

# Same import-time hazard as CAMPUS_DB above: `Config.load()` now reads a
# settings layer, and api/config.py loads the config at import. Pin a scratch
# path here — module scope, so it lands before any test module imports `api.*`
# — or a developer's real data/settings.yaml would leak into the suite.
# test_config.py re-pins per test (its _clean_env deletes every CAMPUS_* var).
os.environ["CAMPUS_SETTINGS_PATH"] = str(_SCRATCH / "settings.yaml")


def _seed(path: Path) -> None:
    """(Re)create `path` with the schema and the committed sample data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Drop the sidecars too: a stale -wal beside a freshly created db file is a
    # good way to get confusing reads.
    for suffix in ("", "-wal", "-shm"):
        stale = Path(str(path) + suffix)
        if stale.exists():
            stale.unlink()

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row  # seed.py indexes rows by column name
    with open(REPO / "schema.sql") as f:
        conn.executescript(f.read())

    import seed.seed as seed_mod

    with open(REPO / "seed" / "courses.example.json") as f:
        data = json.load(f)
    seed_mod.seed(conn, data)
    conn.close()


# Seed it at module scope, not just in the fixture: DB_PATH is frozen at import,
# and the first API call of the session would otherwise open a path that does not
# exist yet — sqlite happily creates an empty file, and every later query fails
# with "no such table: courses".
_seed(_DB)


@pytest.fixture()
def seed_json() -> dict:
    """The committed sample enrollment data (no local override)."""
    with open(REPO / "seed" / "courses.example.json") as f:
        return json.load(f)


@pytest.fixture()
def db_path() -> Path:
    """A fresh DB file with schema + sample courses + sessions applied.

    Re-seeds the session-scoped scratch file rather than a per-test tmp_path:
    the API resolves CAMPUS_DB at import, so a per-test path would be invisible
    to it. The env is re-asserted here too, because a fixture that sets CAMPUS_DB
    without monkeypatch would otherwise leak into later modules.
    """
    os.environ["CAMPUS_DB"] = str(_DB)
    os.environ["CAMPUS_SCHOOL_ROOT"] = str(_SCHOOL)
    _seed(_DB)

    # A clean school root, so files one test writes cannot satisfy another
    # test's assertions.
    if _SCHOOL.exists():
        shutil.rmtree(_SCHOOL)
    _SCHOOL.mkdir(parents=True, exist_ok=True)
    return _DB


@pytest.fixture()
def db(db_path: Path):
    """A `sync.db.DB`-style connection for query-level tests."""
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
