"""Seed pilot course data for dashboard development.

Reads the pilot course code from the seed (is_pilot=1) so the mock works
against any enrolled course set — real or sample.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema.sql"
DB_DEFAULT = ROOT / "data" / "harness.db"


def get_conn(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA.read_text())
    return conn


def seed_pilot(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT id, code FROM courses WHERE is_pilot=1 ORDER BY id LIMIT 1"
    ).fetchone()
    if not row:
        print("No pilot course (is_pilot=1) — run seed/seed.py first", file=sys.stderr)
        sys.exit(1)
    pilot_code = row["code"]  # noqa: F841 — kept for future mock fixtures
    course_id = row["id"]

    conn.execute(
        """
        UPDATE courses SET
            brightspace_org_unit_id = 12345,
            instructor = 'Dr. Smith',
            syllabus_path = 'content/syllabus.md',
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (course_id,),
    )

    if conn.execute("SELECT COUNT(*) FROM announcements WHERE course_id = ?", (course_id,)).fetchone()[0]:
        print("Pilot data already present, skipping")
        return

    announcements = [
        ("Final grades posted", "Final grades are now available on Brightspace.", "Dr. Smith", "2025-07-12T10:00:00", 101),
        ("Office hours cancelled", "Office hours on July 3 are cancelled.", "Dr. Smith", "2025-07-03T09:00:00", 102),
        ("Assignment 3 rubric updated", "The rubric for Assignment 3 has been updated.", "Dr. Smith", "2025-06-20T14:00:00", 103),
    ]
    for title, body, author, posted_at, bs_id in announcements:
        conn.execute(
            "INSERT INTO announcements (course_id, title, body, author, posted_at, brightspace_id) VALUES (?,?,?,?,?,?)",
            (course_id, title, body, author, posted_at, bs_id),
        )

    assignments = [
        ("Assignment 3 — Design Patterns", "Implement observer and strategy patterns.", "2025-06-15T23:59:00", 15.0, "submitted", 201),
        ("Assignment 2 — Unit Testing", "Write comprehensive JUnit tests.", "2025-05-28T23:59:00", 12.0, "graded", 202),
        ("Assignment 1 — Git Workflow", "Set up repo and branching strategy.", "2025-04-20T23:59:00", 8.0, "graded", 203),
    ]
    for title, desc, due, weight, status, folder_id in assignments:
        conn.execute(
            """INSERT INTO assignments (course_id, title, description, due_at, weight, status, source, brightspace_folder_id)
               VALUES (?,?,?,?,?,?,'brightspace',?)""",
            (course_id, title, desc, due, weight, status, folder_id),
        )

    modules = [
        (1, None, "module", None, "Module 1 — Introduction", 0),
        (2, 1, "topic", "file", "Syllabus", 0),
        (3, 1, "topic", "file", "Course Overview", 1),
        (4, None, "module", None, "Module 2 — OOP Fundamentals", 1),
        (5, 4, "topic", "file", "Lecture 1 — Classes & Objects", 0),
        (6, 4, "topic", "file", "Lecture 2 — Inheritance", 1),
        (7, 4, "topic", "file", "Lab 1 — OOP Exercises", 2),
        (8, None, "module", None, "Assignments", 2),
        (9, 8, "topic", "file", "A3 Specification", 0),
    ]
    node_ids: dict[int, int] = {}
    for bs_id, parent_bs, ntype, ttype, title, sort_order in modules:
        parent_id = node_ids.get(parent_bs) if parent_bs else None
        cur = conn.execute(
            """INSERT INTO content_nodes (course_id, parent_id, brightspace_id, node_type, topic_type, title, sort_order)
               VALUES (?,?,?,?,?,?,?)""",
            (course_id, parent_id, bs_id, ntype, ttype, title, sort_order),
        )
        node_ids[bs_id] = cur.lastrowid

    files = [
        (node_ids[2], "content/Module 1/syllabus.pdf", "reading", "abc123", 102400),
        (node_ids[5], "content/Module 2/lecture-01.pdf", "slide", "def456", 2048000),
        (node_ids[6], "content/Module 2/lecture-02.pdf", "slide", "ghi789", 1800000),
        (node_ids[9], "content/Assignments/a3-spec.pdf", "assignment", "jkl012", 512000),
    ]
    for node_id, path, kind, sha, size in files:
        conn.execute(
            """INSERT INTO files (course_id, content_node_id, path, kind, source, sha256, size, synced_at, processed)
               VALUES (?,? ,?,?,'brightspace',?,?,datetime('now'),1)""",
            (course_id, node_id, path, kind, sha, size),
        )

    facts = [
        ("Final exam format is cumulative.", "exam"),
        ("Lab sessions are Thursdays 2–4pm.", "scheduling"),
    ]
    for fact, cat in facts:
        conn.execute(
            "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,0.9,'sync:2025-07-15')",
            (course_id, fact, cat),
        )

    conn.execute(
        """INSERT INTO sync_runs (started_at, finished_at, status, trigger, courses_processed,
           files_new, files_changed, announcements_new, facts_added, log_path)
           VALUES ('2025-07-15T14:30:00','2025-07-15T14:32:00','ok','manual',1,3,0,2,1,'sync_logs/2025-07-15.md')"""
    )
    conn.execute(
        """INSERT INTO sync_runs (started_at, finished_at, status, trigger, error)
           VALUES ('2025-07-10T09:00:00','2025-07-10T09:01:00','failed','manual','Duo timeout')"""
    )

    conn.commit()
    print(f"Pilot data seeded for course_id={course_id}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DB_DEFAULT)
    args = parser.parse_args()
    conn = get_conn(args.db)
    seed_pilot(conn)
    conn.close()


if __name__ == "__main__":
    main()
