"""The agent's own 7-day query must include ISO deadlines on the horizon day.

The API window was fixed with substr(...,1,10); the prompt's query had the same
mixed-format bug and was still dropping them, so the model could answer "what's
due" from an incomplete list.
"""
from __future__ import annotations

import datetime as dt
import sqlite3

import pytest

from sync.config import Config


@pytest.fixture
def prompt_db(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE assignments (id INTEGER, course_id INTEGER, title TEXT, due_at TEXT, status TEXT, weight TEXT)")
    conn.execute("CREATE TABLE exams (id INTEGER, course_id INTEGER, title TEXT, starts_at TEXT, weight TEXT)")
    conn.execute("CREATE TABLE events (id INTEGER, course_id INTEGER, kind TEXT, title TEXT, starts_at TEXT, ends_at TEXT, notes TEXT)")
    conn.execute("CREATE TABLE courses (id INTEGER, code TEXT, name TEXT, term TEXT, instructor TEXT)")
    conn.execute("CREATE TABLE course_sessions (id INTEGER, course_id INTEGER)")
    conn.execute("INSERT INTO courses VALUES (1,'SE 3351A','Test','2026F','Prof')")
    # Horizon is 2026-12-02; this ISO value sorts OUTSIDE a space-separated
    # bound but is on the boundary day.
    conn.execute("INSERT INTO assignments VALUES (1,1,'ISO horizon','2026-12-02T04:59:59.000Z','open',NULL)")

    class FakeDB:
        pass

    fake = FakeDB()
    fake.conn = conn
    cfg = Config(data_root="/tmp", db_path="/tmp/x.db",
                 timezone="America/Toronto", term_dates={})
    import agent.context as ctx

    monkeypatch.setattr(ctx, "sqlish_now", lambda cfg=None: "2026-11-25 12:00:00")
    monkeypatch.setattr(ctx, "now_local", lambda cfg=None: dt.datetime(
        2026, 11, 25, 12, 0, tzinfo=dt.timezone.utc))
    return cfg, fake


def test_prompt_sees_iso_deadline_on_the_horizon(prompt_db):
    from agent.context import upcoming_events

    cfg, db = prompt_db
    events = upcoming_events(cfg, db, None, 7)
    titles = [e["title"] for e in events]
    assert "ISO horizon" in titles
    iso = next(e for e in events if e["title"] == "ISO horizon")
    assert iso["when"] == "Tue Dec 01, 2026 23:59"
