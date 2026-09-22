"""Shared pytest fixtures — a real seeded SQLite DB in a temp dir.

The API + sync code paths read the DB through `api.config.DB_PATH`
(computed at import time from CAMPUS_DB env), so tests that touch the
database set CAMPUS_DB before importing anything from `api`.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent

# Same import-time hazard as CAMPUS_DB above: `Config.load()` now reads a
# settings layer, and api/config.py loads the config at import. Pin a scratch
# path here — module scope, so it lands before any test module imports `api.*`
# — or a developer's real data/settings.yaml would leak into the suite.
# test_config.py re-pins per test (its _clean_env deletes every CAMPUS_* var).
os.environ["CAMPUS_SETTINGS_PATH"] = str(Path(tempfile.mkdtemp()) / "settings.yaml")


@pytest.fixture()
def seed_json() -> dict:
    """The committed sample enrollment data (no local override)."""
    with open(REPO / "seed" / "courses.example.json") as f:
        return json.load(f)


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """A fresh DB file with schema + sample courses + sessions applied."""
    db = tmp_path / "harness.db"
    os.environ["CAMPUS_DB"] = str(db)
    os.environ["CAMPUS_SCHOOL_ROOT"] = str(tmp_path / "school")

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row  # seed.py indexes rows by column name
    with open(REPO / "schema.sql") as f:
        conn.executescript(f.read())

    import seed.seed as seed_mod

    with open(REPO / "seed" / "courses.example.json") as f:
        data = json.load(f)
    seed_mod.seed(conn, data)
    conn.close()
    return db


@pytest.fixture()
def db(db_path: Path):
    """A `sync.db.DB`-style connection for query-level tests."""
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
