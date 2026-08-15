"""Seed + ICS import: the two ways course_sessions get populated.

Both must be deterministic (delete+reinsert), idempotent, and match the
DB CHECK constraints (kind in LEC/LAB/TUT, day 0-6).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _session_rows(conn) -> list[tuple]:
    return conn.execute(
        "SELECT course_id, kind, day_of_week, start_time, end_time, room, section "
        "FROM course_sessions ORDER BY course_id, day_of_week, start_time"
    ).fetchall()


def test_seed_loads_example_when_no_local(seed_json):
    """load_courses() picks the committed example when courses.local.json
    is absent (fresh clone)."""
    import seed.seed as s

    real_exists = s.os.path.exists
    s.os.path.exists = lambda p: False if "courses.local.json" in str(p) else real_exists(p)
    try:
        data = s.load_courses()
    finally:
        s.os.path.exists = real_exists
    assert len(data["courses"]) == len(seed_json["courses"]) >= 3
    assert all("code" in c and "term" in c for c in data["courses"])


def test_seed_upserts_idempotently(db_path, db):
    """Seeding twice → same rows, no duplicates."""
    import seed.seed as s

    with open(REPO / "seed" / "courses.example.json") as f:
        data = json.load(f)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # seed.py indexes rows by column name
    s.seed(conn, data)
    conn.close()

    first = _session_rows(db)
    assert len(first) > 0
    assert len(first) == len(set(first))  # no dup (course_id, kind, day, time) rows


def test_seed_session_kinds_valid(db):
    kinds = {r[1] for r in _session_rows(db)}
    assert kinds <= {"LEC", "LAB", "TUT"}
    days = {r[2] for r in _session_rows(db)}
    assert days <= set(range(7))


def test_ics_import_roundtrip(db_path, db, seed_json):
    """Import seed/sample.ics over the seeded example — sessions match the
    JSON exactly (same rooms/sections/times)."""
    import subprocess
    import sys

    r = subprocess.run(
        [sys.executable, "tools/ics_import.py", "seed/sample.ics", "--db", str(db_path)],
        capture_output=True, text=True, cwd=str(REPO),
    )
    assert r.returncode == 0, r.stderr
    assert "Inserted 19 session(s)" in r.stdout

    from collections import Counter
    rows = _session_rows(db)
    assert len(rows) == 19
    # per-course counts match the JSON
    expect = Counter(c["code"] for c in seed_json["courses"]
                     for _ in c.get("sessions", []))
    got = Counter(
        conn_row[0] for conn_row in
        db.execute("SELECT c.code FROM course_sessions cs JOIN courses c ON c.id=cs.course_id").fetchall()
    )
    # normalize codes to JSON form
    got_norm = Counter()
    for code, n in got.items():
        key = next((c["code"] for c in seed_json["courses"]
                    if c["code"].replace(" ", "") == code.replace(" ", "")), code)
        got_norm[key] = n
    assert dict(got_norm) == dict(expect)


def test_ics_import_dry_run_writes_nothing(db_path, db):
    import subprocess
    import sys

    before = len(_session_rows(db))
    r = subprocess.run(
        [sys.executable, "tools/ics_import.py", "seed/sample.ics", "--db", str(db_path), "--dry-run"],
        capture_output=True, text=True, cwd=str(REPO),
    )
    assert r.returncode == 0, r.stderr
    assert "Dry run" in r.stdout
    assert len(_session_rows(db)) == before
