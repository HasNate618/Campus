"""The fictional demo course, seeded when demo mode is on.

Everything in this module is invented for the demo: the course, the
instructor, the policy, the dates. It exists so a stranger can clone the repo,
run `docker compose up`, and browse and search a course without a Brightspace
account. Nothing here is copied from real course material.

Two guard rails:

* it writes only under ``<data_root>/2026F/DEMO101/``;
* it refuses to run at all when the database already holds any other course,
  so pointing demo mode at a real install cannot seed fiction into it.
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast

DEMO_TERM = "2026F"
DEMO_CODE = "DEMO 101"
DEMO_NAME = "Sample Course (fictional)"
DEMO_DIR = f"{DEMO_TERM}/DEMO101"
DEMO_INSTRUCTOR = "Prof. Example"
DEMO_EMAIL = "example@example.edu"
DEMO_COLOR = "#7c3aed"

# Deliberately distinctive sentences: the demo's search test looks one of these
# up verbatim, so a change here has to be mirrored in tests/test_demo_seed.py.
LATE_POLICY = "The late penalty is 10 percent per day, to a maximum of 50 percent."
OBSERVER_LINE = "The observer pattern notifies dependents when a subject's state changes."

CONTENT: dict[str, str] = {
    "syllabus.md": f"""# DEMO 101: Sample Course (fictional)

This course, its instructor and every date in it are invented for the Campus
demo. Nothing here describes a real course or a real person.

## Instructor

{DEMO_INSTRUCTOR} ({DEMO_EMAIL}), Room 101.
Office hours are Tuesdays 14:00 to 15:30, or by appointment.

## Grading

| Component | Weight |
| --- | --- |
| Assignments | 40 percent |
| Project | 30 percent |
| Final exam | 30 percent |

## Late policy

{LATE_POLICY} Work more than five days late is not accepted.

## Schedule

Week 1 covers the observer pattern. Week 2 covers strategy objects. The
project proposal is due in week 3.
""",
    "lecture-01.md": f"""# Week 1: The Observer Pattern

{OBSERVER_LINE} The subject keeps a list of observers and calls each one after
every change.

Two consequences follow:

- observers can be added without changing the subject;
- the subject does not need to know what an observer does with the update.
""",
    "lecture-02.md": """# Week 2: Strategy Objects

A strategy object is selected at runtime and can be swapped without touching
the caller. The context delegates one piece of behaviour to the strategy it
holds.

Worked example: a checkout step that applies either a student discount or no
discount, chosen when the order is created.
""",
    "assignment-01.md": """# Project Proposal

Worth 10 percent of the final grade.

Deliverables: a one-page proposal and a diagram of the architecture.

Describe the problem, the users, and the two design patterns you plan to use.
State what you will not build.
""",
}

# Plain-text lines for the generated PDF (the syllabus, without table pipes).
PDF_LINES = [
    "DEMO 101: Sample Course (fictional)",
    "",
    f"Instructor: {DEMO_INSTRUCTOR} ({DEMO_EMAIL}), Room 101",
    "Office hours: Tuesdays 14:00 to 15:30, or by appointment.",
    "",
    "Grading: assignments 40 percent, project 30 percent, final exam 30 percent.",
    "",
    LATE_POLICY,
    "Work more than five days late is not accepted.",
    "",
    "This course and every date in it are invented for the Campus demo.",
]

FILE_KINDS = {
    "syllabus.md": "reading",
    "lecture-01.md": "slide",
    "lecture-02.md": "slide",
    "assignment-01.md": "assignment",
    "syllabus.pdf": "reading",
}


class _ConnView:
    """``sync.search.rebuild`` only ever touches ``.conn``.

    Rebuilding through this view keeps the seed on ONE sqlite connection, so
    the seed transaction and the index build cannot deadlock on each other.
    """

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn


def _root(cfg) -> Path:
    root = Path(cfg.data_root)
    if not root.is_absolute():
        # Anchor to the repo, matching where data/harness.db lives, so the seed
        # writes the same tree the app reads regardless of the caller's CWD.
        root = Path(__file__).resolve().parent.parent / root
    return root


def _write_pdf(path: Path) -> bool:
    """A small PDF made from PDF_LINES. Optional: PyMuPDF is a declared
    dependency but it needs shared libraries that are not on every dev box, and
    the demo works without this file. Returns True when it was written."""
    try:
        import fitz  # PyMuPDF
    except Exception:
        return False
    doc = fitz.open()
    page = doc.new_page()
    y = 72.0
    for line in PDF_LINES:
        if y > 752:
            break
        page.insert_text((72, y), line, fontsize=11)
        y += 18
    doc.save(str(path))
    doc.close()
    return True


def _iso(days: int, hour: int = 23, minute: int = 59) -> str:
    """A timestamp `days` from now, pinned to a sensible wall-clock time.
    UTC so it lines up with SQLite's datetime('now') in the deadline queries."""
    base = datetime.now(timezone.utc) + timedelta(days=days)
    return base.replace(hour=hour, minute=minute, second=0,
                        microsecond=0).isoformat()


def seed_demo(conn: sqlite3.Connection, cfg) -> dict:
    """Seed the demo course. Returns a stats dict; {"skipped": reason} when it
    declines, which is never an error."""
    others = conn.execute(
        "SELECT COUNT(*) FROM courses WHERE code != ?", (DEMO_CODE,)
    ).fetchone()[0]
    if others:
        return {"skipped": f"{others} non-demo course(s) already present"}

    existing = conn.execute(
        "SELECT id FROM courses WHERE code = ?", (DEMO_CODE,)
    ).fetchone()
    if existing:
        return {"skipped": "demo course already present"}

    root = _root(cfg)
    content_dir = root / DEMO_DIR / "content"
    content_dir.mkdir(parents=True, exist_ok=True)

    # ── files on disk ────────────────────────────────────────────────────
    written: list[tuple[str, str]] = []  # (relative path, kind)
    for name, body in CONTENT.items():
        (content_dir / name).write_text(body, encoding="utf-8")
        written.append((f"{DEMO_DIR}/content/{name}", FILE_KINDS[name]))
    if _write_pdf(content_dir / "syllabus.pdf"):
        written.append((f"{DEMO_DIR}/content/syllabus.pdf", FILE_KINDS["syllabus.pdf"]))

    # ── course ───────────────────────────────────────────────────────────
    cur = conn.execute(
        """INSERT INTO courses (code, name, term, instructor, units, color,
                                syllabus_path, is_pilot, is_active)
           VALUES (?,?,?,?,?,?,?,1,1)""",
        (DEMO_CODE, DEMO_NAME, DEMO_TERM, DEMO_INSTRUCTOR, 0.5, DEMO_COLOR,
         f"{DEMO_DIR}/content/syllabus.md"),
    )
    course_id = cur.lastrowid

    for kind, day, start, end, room in (
        ("LEC", 0, "10:00", "11:30", "Room 101"),
        ("LEC", 2, "10:00", "11:30", "Room 101"),
        ("TUT", 4, "14:00", "15:00", "Room 102"),
    ):
        conn.execute(
            """INSERT INTO course_sessions (course_id, kind, day_of_week,
                                            start_time, end_time, room)
               VALUES (?,?,?,?,?,?)""",
            (course_id, kind, day, start, end, room),
        )

    # ── content nodes: one module, one topic per file ────────────────────
    # brightspace_id is NOT NULL and UNIQUE per course; the demo never syncs,
    # so small synthetic ids are all it needs to behave like synced rows.
    module_id = conn.execute(
        """INSERT INTO content_nodes (course_id, brightspace_id, node_type,
                                      title, sort_order)
           VALUES (?, 1, 'module', ?, 0)""",
        (course_id, "Week 1 and 2"),
    ).lastrowid

    titles = {
        "syllabus.md": "Syllabus",
        "lecture-01.md": "Lecture 1: The Observer Pattern",
        "lecture-02.md": "Lecture 2: Strategy Objects",
        "assignment-01.md": "Project Proposal",
        "syllabus.pdf": "Syllabus (PDF)",
    }
    order = ["syllabus.md", "syllabus.pdf", "lecture-01.md",
             "lecture-02.md", "assignment-01.md"]
    for rel, kind in written:
        topic_id = conn.execute(
            """INSERT INTO content_nodes (course_id, parent_id, brightspace_id,
                                          node_type, topic_type, title, sort_order)
               VALUES (?,?,?,'topic','file',?,?)""",
            (course_id, module_id, 2 + order.index(Path(rel).name),
             titles[Path(rel).name], order.index(Path(rel).name)),
        ).lastrowid
        body = (root / rel).read_bytes()
        conn.execute(
            """INSERT INTO files (course_id, content_node_id, path, kind, source,
                                  sha256, size, synced_at, processed)
               VALUES (?,?,?,?,'manual',?,?,datetime('now'),1)""",
            (course_id, topic_id, rel, kind,
             hashlib.sha256(body).hexdigest(), len(body)),
        )

    # ── assignments, due relative to now so "this week" is never empty ───
    for title, desc, days, weight, status in (
        ("Reflection 1", "One page on the observer pattern.", 3, 5.0, "open"),
        ("Problem Set 2", "Two strategy-pattern exercises.", 9, 10.0, "open"),
        ("Project Proposal", "One-page proposal plus architecture diagram.", 16, 10.0, "open"),
    ):
        conn.execute(
            """INSERT INTO assignments (course_id, title, description, due_at,
                                        weight, status, source, category, points)
               VALUES (?,?,?,?,?,?,'seed','Coursework',?)""",
            (course_id, title, desc, _iso(days), weight, status, weight),
        )

    # ── announcements ────────────────────────────────────────────────────
    for title, body, days in (
        ("Welcome to the fictional demo", "This course exists only to show the "
         "Campus interface. No real people or courses are involved.", -1),
        ("Office hours moved", "Office hours this week run on Wednesday instead "
         "of Tuesday, in Room 101.", -2),
        ("Project proposal posted", "The proposal brief is in the Week 1 and 2 "
         "module. It is worth 10 percent of the final grade.", -4),
    ):
        conn.execute(
            """INSERT INTO announcements (course_id, title, body, author,
                                          posted_at, brightspace_id)
               VALUES (?,?,?,?,?,NULL)""",
            (course_id, title, body, DEMO_INSTRUCTOR, _iso(days, hour=9, minute=0)),
        )

    # ── memory facts (so the facts panel is not empty) ───────────────────
    for fact, category in (
        (LATE_POLICY, "grading"),
        ("Office hours are Tuesdays 14:00 to 15:30 in Room 101.", "scheduling"),
    ):
        conn.execute(
            """INSERT INTO memory_facts (course_id, fact, category, confidence, source)
               VALUES (?,?,?,0.9,'demo')""",
            (course_id, fact, category),
        )

    conn.commit()

    # ── search index, built from the files just written ───────────────────
    from sync.search import rebuild
    index = rebuild(cfg, cast("object", _ConnView(conn)))

    return {
        "course": DEMO_CODE,
        "assignments": 3,
        "announcements": 3,
        "files": len(written),
        "chunks": index.get("chunks", 0),
    }
