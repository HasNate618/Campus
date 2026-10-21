#!/usr/bin/env python3
"""Seed the campus database with courses + schedule from seed/courses.json.

Resolution order: seed/courses.local.json (real enrollments, gitignored) if
present, else seed/courses.example.json (sample data shipped in the repo).

Usage: python3 seed/seed.py [--db PATH] [--reset]
"""
import argparse
import json
import os
import sqlite3
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(REPO, "data", "harness.db")

# Running as `python seed/seed.py` puts seed/ (not the repo root) on sys.path,
# so the modules this imports from sync/ would not resolve otherwise.
if REPO not in sys.path:
    sys.path.insert(0, REPO)

from seed.demo import seed_demo  # noqa: E402
from sync.config import Config  # noqa: E402

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load_courses() -> dict:
    """Local real data wins; the committed example is the fallback.

    A seed script must fail loudly when its input is missing or malformed:
    swallowing that error would start the app against an empty database with
    no explanation, which is the failure the Dockerfile comment calls out.
    """
    local = os.path.join(REPO, "seed", "courses.local.json")
    example = os.path.join(REPO, "seed", "courses.example.json")
    path = local if os.path.exists(local) else example
    # pi-lens-ignore: unchecked-throwing-call-python
    with open(path) as f:
        # pi-lens-ignore: unchecked-throwing-call-python
        return json.load(f)


def connect(db_path: str) -> sqlite3.Connection:
    # pi-lens-ignore: unchecked-throwing-call-python
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    # pi-lens-ignore: unchecked-throwing-call-python
    with open(os.path.join(REPO, "schema.sql")) as f:
        conn.executescript(f.read())
    return conn


def seed(conn: sqlite3.Connection, data: dict) -> dict:
    stats = {"courses": 0, "sessions": 0, "pilots": 0}
    for c in data["courses"]:
        is_pilot = 1 if c.get("is_pilot") else 0
        conn.execute(
            """INSERT INTO courses (code, name, term, instructor, units, class_nbr, color, is_pilot)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(code) DO UPDATE SET
                 name=excluded.name, term=excluded.term, instructor=excluded.instructor,
                 units=excluded.units, class_nbr=excluded.class_nbr, color=excluded.color,
                 is_pilot=excluded.is_pilot,
                 updated_at=datetime('now')""",
            (c["code"], c["name"], c["term"], c.get("instructor"), c.get("units"),
             c.get("class_nbr"), c.get("color"), is_pilot),
        )
        course_id = conn.execute("SELECT id FROM courses WHERE code=?", (c["code"],)).fetchone()["id"]
        stats["courses"] += 1
        if is_pilot:
            stats["pilots"] += 1

        # Upsert sessions (delete + reinsert is simpler and deterministic for a seed)
        conn.execute("DELETE FROM course_sessions WHERE course_id=?", (course_id,))
        for s in c.get("sessions", []):
            conn.execute(
                """INSERT INTO course_sessions (course_id, kind, day_of_week, start_time, end_time, room, section)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (course_id, s["kind"], s["day"], s["start"], s["end"], s.get("room", ""), s.get("section", "")),
            )
            stats["sessions"] += 1
    conn.commit()
    return stats


def _demo_mode() -> bool:
    """True when the resolved config says demo (CAMPUS_DEMO or demo: true)."""
    try:
        return Config.load().demo
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--reset", action="store_true", help="drop all tables first")
    ap.add_argument("--demo", action="store_true",
                    help="seed the fictional demo course instead of the sample "
                         "courses (also on when CAMPUS_DEMO is set)")
    args = ap.parse_args()

    if args.reset and os.path.exists(args.db):
        # Deliberate: if --reset cannot delete the old DB, the seed must fail
        # loudly rather than merge into a database the user asked to discard.
        # pi-lens-ignore: unchecked-throwing-call-python
        os.remove(args.db)

    conn = connect(args.db)
    if args.demo or _demo_mode():
        stats = seed_demo(conn, Config.load())
        if "skipped" in stats:
            print(f"Demo seed skipped: {stats['skipped']}")
        else:
            print(f"Seeded the fictional demo course {stats['course']}: "
                  f"{stats['assignments']} assignments, "
                  f"{stats['announcements']} announcements, "
                  f"{stats['files']} files, {stats['chunks']} search chunks")
    else:
        stats = seed(conn, load_courses())
        print(f"Seeded {stats['courses']} courses ({stats['pilots']} pilot), "
              f"{stats['sessions']} sessions -> {args.db}")
    pilots = conn.execute(
        "SELECT code, name, term FROM courses WHERE is_pilot=1 ORDER BY code"
    ).fetchall()
    if pilots:
        print("Pilots:", ", ".join(f"{p['code']} ({p['term']})" for p in pilots))
    print()
    rows = conn.execute(
        """SELECT c.code, s.kind, s.day_of_week, s.start_time, s.end_time, s.room
           FROM course_sessions s JOIN courses c ON c.id = s.course_id
           ORDER BY s.day_of_week, s.start_time"""
    ).fetchall()
    for d in range(7):
        day_rows = [r for r in rows if r["day_of_week"] == d]
        if not day_rows:
            continue
        print(f"{DAY_NAMES[d]}:")
        for r in day_rows:
            room = f" @ {r['room']}" if r["room"] else ""
            print(f"   {r['start_time']}-{r['end_time']}  {r['code']} [{r['kind']}]{room}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
