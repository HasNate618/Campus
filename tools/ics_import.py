#!/usr/bin/env python3
r"""Import a weekly timetable from an .ics calendar feed into course_sessions.

Parses VEVENT blocks from a standard .ics file and maps each recurring
weekly meeting to a course_sessions row for the matching course in the
`courses` table. Existing sessions for a course are deleted and
re-inserted — the same deterministic upsert seed/seed.py uses.

SUMMARY format expected (example):

    CS 1100A 001 LEC 2026F

Mapping:
  code    `[A-Z]+\s*\d{4}[A-Z]?` (e.g. 'CS 1100A'); normalized by
          stripping whitespace + uppercasing to match courses.code
  section first standalone 3-digit token outside the code (e.g. '001')
  kind    first of LEC / LAB / TUT found in the summary
  term    ignored — recurrence is weekly, so only the first occurrence
          of each meeting matters

DTSTART / DTEND carry the first occurrence (e.g. 20260907T100000).
The weekday (Mon=0) and start/end 'HH:MM' times are derived from them;
the RRULE recurrence rule is intentionally ignored. LOCATION becomes
the room.

Events that can't be resolved (unknown course code, no LEC/LAB/TUT
token, or no DTSTART/DTEND) are skipped with a warning. Exits 1 if no
courses matched.

Usage:
    python3 tools/ics_import.py seed/sample.ics
    python3 tools/ics_import.py feed.ics --db /tmp/test.db
    python3 tools/ics_import.py feed.ics --dry-run
"""
import argparse
import os
import re
import sqlite3
import sys
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(REPO, "data", "harness.db")

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

CODE_RE = re.compile(r"([A-Z]+\s*\d{4}[A-Z]?)")
KIND_RE = re.compile(r"\b(LEC|LAB|TUT)\b", re.IGNORECASE)
SECTION_RE = re.compile(r"\b(\d{3})\b")
DT_RE = re.compile(r"^(\d{8})T(\d{6})")


def norm_code(code: str) -> str:
    """'CS 1100A' -> 'CS1100A' (same normalization as sync.sync._norm_code)."""
    return re.sub(r"\s+", "", code or "").upper()


def connect(db_path: str) -> sqlite3.Connection:
    """Open (creating if needed) the database; same schema setup as seed/seed.py."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    with open(os.path.join(REPO, "schema.sql")) as f:
        conn.executescript(f.read())
    return conn


def parse_ics(path: str) -> list:
    """Minimal RFC 5545-ish parser: unfold folded lines, collect VEVENT props."""
    with open(path) as f:
        lines = []
        for raw in f.read().splitlines():
            raw = raw.rstrip("\r")
            if raw[:1] in (" ", "\t") and lines:
                lines[-1] += raw[1:]
            else:
                lines.append(raw)
    events = []
    current = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            if current:
                events.append(current)
            current = None
        elif current is not None:
            key, _, value = line.partition(":")
            current.setdefault(key.split(";")[0].upper(), value)
    return events


def parse_dt(value: str):
    """'20260907T100000' (trailing Z/offset tolerated) -> (datetime, 'HH:MM')."""
    m = DT_RE.match(value or "")
    if not m:
        return None, None
    dt = datetime.strptime(m.group(0), "%Y%m%dT%H%M%S")
    return dt, dt.strftime("%H:%M")


def parse_event(ev: dict, course_ids: dict):
    """Map one VEVENT -> (course_id, kind, day, start, end, room, section), or (None, why)."""
    summary = ev.get("SUMMARY", "")
    cm = CODE_RE.search(summary)
    if not cm:
        return None, "unknown_code"
    code = norm_code(cm.group(1))
    if code not in course_ids:
        return None, "unknown_code"
    km = KIND_RE.search(summary)
    if not km:
        return None, "no_kind"
    kind = km.group(1).upper()
    rest = summary[: cm.start()] + summary[cm.end():]
    sm = SECTION_RE.search(rest)
    section = sm.group(1) if sm else ""
    start_dt, start_t = parse_dt(ev.get("DTSTART", ""))
    _, end_t = parse_dt(ev.get("DTEND", ""))
    if start_dt is None or end_t is None:
        return None, "no_time"
    return (course_ids[code][0], kind, start_dt.weekday(), start_t, end_t,
            (ev.get("LOCATION") or "").strip(), section), None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ics_file", help="path to the .ics timetable feed")
    ap.add_argument("--db", default=DEFAULT_DB, help="sqlite database path")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse and report without writing to the database")
    args = ap.parse_args()

    conn = connect(args.db)
    course_ids = {}
    for r in conn.execute("SELECT id, code FROM courses"):
        course_ids[norm_code(r["code"])] = (r["id"], r["code"])
    if not course_ids:
        print("No courses in the database — run seed/seed.py first", file=sys.stderr)
        return 1

    events = parse_ics(args.ics_file)
    if not events:
        print(f"No VEVENT blocks found in {args.ics_file}", file=sys.stderr)
        return 1

    by_course = {}
    skipped = {"unknown_code": [], "no_kind": [], "no_time": []}
    for ev in events:
        if ev.get("STATUS", "").upper() == "CANCELLED":
            continue
        row, why = parse_event(ev, course_ids)
        if row is None:
            skipped[why].append(ev.get("SUMMARY", "") or ev.get("UID", "(no summary)"))
            continue
        by_course.setdefault(row[0], []).append(row)
    n_skipped = sum(len(v) for v in skipped.values())
    n_sessions = sum(len(v) for v in by_course.values())
    print(f"Parsed {len(events)} event(s) from {args.ics_file}")
    print(f"  courses matched : {len(by_course)}")
    print(f"  sessions        : {n_sessions}")
    if n_skipped:
        parts = ", ".join(f"{k}={len(v)}" for k, v in skipped.items() if v)
        print(f"  skipped         : {n_skipped} event(s) ({parts})")
        for k, v in skipped.items():
            for s in v:
                print(f"    WARN [{k}]: {s!r}")

    if not by_course:
        print("No events matched any course — nothing to import", file=sys.stderr)
        return 1

    if not args.dry_run:
        for course_id, rows in by_course.items():
            conn.execute("DELETE FROM course_sessions WHERE course_id=?", (course_id,))
            conn.executemany(
                """INSERT INTO course_sessions
                   (course_id, kind, day_of_week, start_time, end_time, room, section)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                rows)
        conn.commit()
        verb = f"Inserted {n_sessions} session(s) into {args.db}"
    else:
        verb = f"Dry run — would insert {n_sessions} session(s) into {args.db}"
    print(verb)

    # Weekly timetable summary (same shape as seed/seed.py)
    if args.dry_run:
        code_by_id = {cid: raw for cid, raw in course_ids.values()}
        rows = [{"code": code_by_id[cid], "kind": r[1], "day_of_week": r[2],
                 "start_time": r[3], "end_time": r[4], "room": r[5]}
                for cid, rs in by_course.items() for r in rs]
    else:
        rows = conn.execute(
            """SELECT c.code, s.kind, s.day_of_week, s.start_time, s.end_time, s.room
               FROM course_sessions s JOIN courses c ON c.id = s.course_id
               WHERE c.id IN ({}) ORDER BY s.day_of_week, s.start_time""".format(
                ",".join("?" * len(by_course))),
            list(by_course)).fetchall()
    print()
    for d in range(7):
        day_rows = [r for r in rows if r["day_of_week"] == d]
        if not day_rows:
            continue
        print(f"{DAY_NAMES[d]}:")
        for r in sorted(day_rows, key=lambda x: x["start_time"]):
            room = f" @ {r['room']}" if r["room"] else ""
            print(f"   {r['start_time']}-{r['end_time']}  {r['code']} [{r['kind']}]{room}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
