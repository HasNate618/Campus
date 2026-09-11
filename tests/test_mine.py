"""Tests for autonomous sync mining (sync/mine.py + wiring)."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def cfg(tmp_path: Path, db_path: Path):
    from sync.config import Config
    return Config(data_root=tmp_path, db_path=db_path)


@pytest.fixture()
def db(db_path: Path):
    from sync.db import DB
    d = DB(db_path)
    yield d
    d.close()


def test_stable_uid_deterministic():
    from sync.mine import stable_uid
    a = stable_uid("SE 3352A", "Lab 1 due", "2026-09-14")
    b = stable_uid("SE 3352A", "Lab 1 due", "2026-09-14")
    c = stable_uid("SE 3352A", "Lab 2 due", "2026-09-14")
    assert a == b and len(a) == 16
    assert a != c
