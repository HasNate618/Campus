"""Demo mode: the fictional course, the guard rails, and the banner flags.

The demo exists so a stranger can clone the repo and look around without a
Brightspace account, so these tests pin the three things that make it safe to
ship: the seed never touches a database that already holds a real course, the
course it creates is browseable, and demo mode cannot expose the shell tool.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"


@pytest.fixture()
def fresh_db(tmp_path):
    """An empty schema-only DB. Deliberately NOT the conftest `db_path`
    fixture: that one already holds the sample courses, which would (correctly)
    make the demo seed refuse to run."""
    conn = sqlite3.connect(str(tmp_path / "demo.db"))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA.read_text())
    yield conn
    conn.close()


@pytest.fixture()
def demo_cfg(tmp_path):
    from sync.config import Config

    return Config(data_root=tmp_path / "school", db_path=tmp_path / "demo.db")


def test_demo_seed_creates_a_browseable_course(fresh_db, demo_cfg):
    from seed.demo import DEMO_CODE, seed_demo

    stats = seed_demo(fresh_db, demo_cfg)

    assert stats.get("skipped") is None
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM courses").fetchone()[0] >= 1
    course = fresh_db.execute(
        "SELECT code, name FROM courses WHERE code = ?", (DEMO_CODE,)).fetchone()
    assert course["code"] == DEMO_CODE
    assert "fictional" in course["name"].lower()

    # The handoff's acceptance minimum: the pages have something to show.
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM assignments").fetchone()[0] >= 2
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM announcements").fetchone()[0] >= 2
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM files").fetchone()[0] >= 3


def test_demo_seed_indexes_its_files_for_search(fresh_db, demo_cfg):
    from seed.demo import LATE_POLICY, seed_demo
    from seed.demo import _ConnView
    from sync.search import search

    stats = seed_demo(fresh_db, demo_cfg)
    assert stats["chunks"] >= 3
    assert fresh_db.execute(
        "SELECT COUNT(DISTINCT ref) FROM chunks").fetchone()[0] >= 3

    hits = search(demo_cfg, _ConnView(fresh_db), f'"{LATE_POLICY}"', top_k=5)
    assert hits, "the demo syllabus must be findable by an exact phrase"
    assert any(h["ref"].endswith("syllabus.md") for h in hits)


def test_demo_seed_writes_only_inside_the_demo_directory(fresh_db, demo_cfg):
    from seed.demo import DEMO_DIR, seed_demo

    seed_demo(fresh_db, demo_cfg)
    root = demo_cfg.data_root
    written = [p for p in root.rglob("*") if p.is_file()]
    assert written
    for path in written:
        assert path.relative_to(root).as_posix().startswith(DEMO_DIR + "/")


def test_demo_seed_refuses_a_database_with_real_courses(fresh_db, demo_cfg):
    """Pointing demo mode at a real install must not seed fiction into it."""
    from seed.demo import seed_demo

    fresh_db.execute(
        """INSERT INTO courses (code, name, term) VALUES ('CS 1100A', 'Real', '2026F')""")
    fresh_db.commit()

    stats = seed_demo(fresh_db, demo_cfg)

    assert "skipped" in stats
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM courses").fetchone()[0] == 1
    assert not demo_cfg.data_root.exists(), "no files may be written"


def test_demo_seed_is_idempotent(fresh_db, demo_cfg):
    from seed.demo import seed_demo

    seed_demo(fresh_db, demo_cfg)
    again = seed_demo(fresh_db, demo_cfg)

    assert "skipped" in again
    assert fresh_db.execute("SELECT COUNT(*) FROM courses").fetchone()[0] == 1
    assert fresh_db.execute(
        "SELECT COUNT(*) FROM announcements").fetchone()[0] == 3


def test_demo_mode_forces_the_shell_tool_off(monkeypatch, tmp_path):
    """Even an explicit CAMPUS_TERMINAL_ENABLED=1 must not win in demo mode."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_DEMO", "1")
    monkeypatch.setenv("CAMPUS_TERMINAL_ENABLED", "1")
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    cfg = Config.load()

    assert cfg.demo is True
    assert cfg.terminal_enabled is False

    from agent.tools import tool_schemas
    names = [s["function"]["name"] for s in tool_schemas(cfg)]
    assert "terminal_run" not in names


def test_demo_content_is_fictional():
    """No real institution may creep into the demo fixtures."""
    from seed import demo

    blob = " ".join(demo.CONTENT.values()).lower() + " " + " ".join(
        demo.PDF_LINES).lower()
    for banned in ("uwo", "western", "samarabandu", "jagath", "teb 351"):
        assert banned not in blob, f"demo content mentions {banned!r}"
