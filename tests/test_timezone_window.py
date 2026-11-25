"""The 7-day window must not lose ISO events at the day boundary.

Stored dates mix `YYYY-MM-DD HH:MM:SS` (SQLite UTC) and `YYYY-MM-DDTHH:MM...Z`
(D2L). A lexical BETWEEN against a space-separated bound drops ISO rows on the
horizon day, because 'T' sorts after ' '. Run the generated SQL against a real
in-memory SQLite DB so the substr() rewrite is actually exercised.
"""
from __future__ import annotations

import datetime as dt
import sqlite3

import pytest

import api.services as services


@pytest.fixture
def db(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE assignments (id INTEGER, course_id INTEGER, title TEXT, due_at TEXT, status TEXT, weight TEXT, notes TEXT)")
    conn.execute("CREATE TABLE exams (id INTEGER, course_id INTEGER, title TEXT, starts_at TEXT, weight TEXT)")
    conn.execute("CREATE TABLE events (id INTEGER, course_id INTEGER, kind TEXT, title TEXT, starts_at TEXT, ends_at TEXT, notes TEXT)")
    conn.execute("CREATE TABLE courses (id INTEGER, code TEXT)")
    conn.execute("INSERT INTO courses VALUES (1,'SE 3351A')")
    conn.execute("INSERT INTO assignments VALUES (1,1,'ISO same-day horizon','2026-12-02T04:59:59.000Z',NULL,NULL,NULL)")
    conn.execute("INSERT INTO assignments VALUES (2,1,'space format','2026-12-02 12:00:00',NULL,NULL,NULL)")

    monkeypatch.setenv("CAMPUS_TIMEZONE", "America/Toronto")
    # Freeze 'now' at 2026-11-25 12:00 UTC so the horizon date is 2026-12-02.
    monkeypatch.setattr(services, "_now_iso", lambda: "2026-11-25 12:00:00")
    monkeypatch.setattr(services, "now_local", lambda cfg=None: dt.datetime(
        2026, 11, 25, 12, 0, tzinfo=dt.timezone.utc))
    # Execute the REAL generated SQL against the fixture DB. Replacing _rows
    # with a canned list would bypass the query rewrite under test.
    monkeypatch.setattr(
        services, "_rows",
        lambda q, args: [dict(r) for r in conn.execute(q, args).fetchall()])
    monkeypatch.setattr(services, "_dedupe_deadlines", lambda rows: rows)
    return conn


def test_iso_deadline_on_the_horizon_day_is_included(db):
    rows = services.events_next_days(7, course_id=1)
    titles = {r["title"] for r in rows}
    # Before the substr fix this was excluded: '2026-11-28T...' > '2026-12-02 '.
    assert "ISO same-day horizon" in titles
    assert "space format" in titles


def test_local_deadline_is_rendered_with_the_zone(db):
    rows = services.events_next_days(7, course_id=1)
    iso = next(r for r in rows if r["title"] == "ISO same-day horizon")
    assert iso["starts_at"] == "2026-12-02T04:59:59.000Z"
    assert iso["starts_at_local"] == "Tue Dec 01, 2026 23:59"
    assert iso["timezone"] == "America/Toronto"
