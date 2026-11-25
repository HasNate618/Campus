"""One timezone contract for the harness: store UTC, present local.

The container runs UTC, the user is in America/Toronto, and D2L writes a mix of
`...Z`, date-only and naive datetimes. Without a shared helper the prompt showed
a 5pm EST deadline as midnight, the next-7-days window compared tz-aware strings
against UTC rows, and the browser rendered sync times as Invalid Date.
"""
from __future__ import annotations

import datetime as dt

import pytest

from agent.timeutil import (fmt_local, now_local, parse_harness_dt, sqlish_now,
                            to_local, tz, tz_name)
from sync.config import Config


@pytest.fixture
def cfg(tmp_path):
    return Config(data_root=tmp_path, db_path=tmp_path / "h.db",
                  timezone="America/Toronto")


def test_utc_z_is_converted_to_local(cfg):
    # This is a REAL assignment value: Lab 4 due at 5pm EST, stored as 22:00Z.
    assert fmt_local("2026-11-27T22:00:00.000Z", cfg) == "Fri Nov 27, 2026 17:00"
    assert to_local("2026-11-27T22:00:00.000Z", cfg).hour == 17


def test_utc_z_crosses_the_local_day_boundary(cfg):
    # 23:59 UTC on Dec 6 is 18:59 EST on Dec 6; 04:59 UTC Dec 7 is 23:59 EST
    # Dec 6. The old code printed "07 Dec 04:59" — a different DAY.
    assert fmt_local("2026-12-07T04:59:59.000Z", cfg) == "Sun Dec 06, 2026 23:59"


def test_date_only_stays_the_lms_calendar_day(cfg):
    # date-only means the day the LMS labelled, in the user's zone. Noon keeps
    # the day stable across DST; it must not become UTC midnight (07:00 EST).
    assert fmt_local("2026-12-01", cfg) == "Tue Dec 01, 2026 12:00"


def test_naive_datetime_is_treated_as_utc(cfg):
    assert fmt_local("2026-11-29T23:59", cfg) == "Sun Nov 29, 2026 18:59"


def test_sqlite_space_separated_utc_is_supported(cfg):
    # sync_runs.started_at looks like this. The browser used to call it
    # Invalid Date and the prompt's SQL window could not compare with it.
    assert fmt_local("2026-11-19 10:00:51", cfg) == "Thu Nov 19, 2026 05:00"


def test_sqlish_bound_is_utc_and_sortable(cfg):
    s = sqlish_now(cfg)
    assert "T" not in s and "-" in s and ":" in s
    parsed = dt.datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    utc_now = dt.datetime.now(dt.timezone.utc)
    assert abs((utc_now - parsed.replace(tzinfo=dt.timezone.utc)).total_seconds()) < 5


def test_now_and_zone_names(cfg):
    assert tz_name(cfg) == "America/Toronto"
    n = now_local(cfg)
    assert n.tzinfo is not None and n.utcoffset() == dt.timedelta(hours=-5)
    assert tz(cfg).key == "America/Toronto"


def test_bad_values_do_not_crash(cfg):
    assert fmt_local(None, cfg) == "unknown"
    assert fmt_local("nonsense", cfg) == "unknown"
    assert parse_harness_dt("nonsense", cfg) is None


def test_prompt_renders_deadlines_in_the_configured_zone(cfg):
    """The actual symptom: what the agent sees in UPCOMING."""
    from agent.context import build_system_prompt
    from sync.db import DB
    import sqlite3

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    for stmt in (
        "CREATE TABLE courses (id INTEGER PRIMARY KEY, code TEXT, name TEXT, term TEXT, instructor TEXT)",
        "CREATE TABLE assignments (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT, due_at TEXT, status TEXT, weight TEXT)",
        "CREATE TABLE exams (id INTEGER PRIMARY KEY, course_id INTEGER, title TEXT, starts_at TEXT, weight TEXT)",
        "CREATE TABLE events (id INTEGER PRIMARY KEY, course_id INTEGER, kind TEXT, title TEXT, starts_at TEXT, ends_at TEXT, notes TEXT)",
        "CREATE TABLE course_sessions (id INTEGER PRIMARY KEY, course_id INTEGER)",
        "CREATE TABLE announcements (course_id INTEGER, posted_at TEXT)",
    ):
        conn.execute(stmt)
    conn.execute("INSERT INTO courses VALUES (1,'SE 3351A','Test','2026F','Prof')")
    conn.execute("INSERT INTO assignments VALUES (1,1,'Lab 4','2026-11-27T22:00:00.000Z','open',NULL)")

    class FakeDB:
        pass

    fake = FakeDB()
    fake.conn = conn
    prompt = build_system_prompt(cfg, fake, 1)
    assert "TIMEZONE RULE" in prompt
    line = next(l for l in prompt.splitlines() if "Lab 4" in l and "assignment" in l)
    assert "Fri Nov 27, 2026 17:00" in line
    assert "00:00" not in line
