"""In-memory mock data when SQLite is unavailable."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

NOW = datetime(2026, 8, 1, 11, 0, 0)

COURSES: list[dict[str, Any]] = [
    {
        "id": 1,
        "code": "SE 2250B",
        "name": "Software Construction",
        "term": "2025W",
        "instructor": "Dr. Smith",
        "units": 0.5,
        "class_nbr": None,
        "brightspace_org_unit_id": 12345,
        "brightspace_url": None,
        "color": "#64748b",
        "syllabus_path": "content/syllabus.md",
        "notes": None,
        "is_pilot": 1,
        "is_active": 1,
        "created_at": "2025-01-10T00:00:00",
        "updated_at": "2025-07-15T14:32:00",
        "file_count": 47,
        "assignment_count": 3,
        "last_sync_at": "2025-07-15T14:32:00",
    },
    {
        "id": 2,
        "code": "SE 3309A",
        "name": "Database Management Systems",
        "term": "2026F",
        "instructor": "Grolinger",
        "units": 0.5,
        "class_nbr": "9722",
        "brightspace_org_unit_id": None,
        "brightspace_url": None,
        "color": "#ef4444",
        "syllabus_path": None,
        "notes": None,
        "is_pilot": 0,
        "is_active": 1,
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
        "file_count": 0,
        "assignment_count": 0,
        "last_sync_at": None,
    },
    {
        "id": 3,
        "code": "SE 3316A",
        "name": "Web Technologies",
        "term": "2026F",
        "instructor": "TBA",
        "units": 0.5,
        "class_nbr": "10234",
        "brightspace_org_unit_id": None,
        "brightspace_url": None,
        "color": "#6366f1",
        "syllabus_path": None,
        "notes": None,
        "is_pilot": 0,
        "is_active": 1,
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
        "file_count": 0,
        "assignment_count": 0,
        "last_sync_at": None,
    },
]

ANNOUNCEMENTS: list[dict[str, Any]] = [
    {
        "id": 1,
        "course_id": 1,
        "course_code": "SE 2250B",
        "title": "Final grades posted",
        "body": "Final grades are now available on Brightspace.",
        "author": "Dr. Smith",
        "posted_at": "2025-07-12T10:00:00",
        "is_pinned": 0,
        "brightspace_id": 101,
        "created_at": "2025-07-12T10:05:00",
    },
    {
        "id": 2,
        "course_id": 1,
        "course_code": "SE 2250B",
        "title": "Office hours cancelled",
        "body": "Office hours on July 3 are cancelled.",
        "author": "Dr. Smith",
        "posted_at": "2025-07-03T09:00:00",
        "is_pinned": 0,
        "brightspace_id": 102,
        "created_at": "2025-07-03T09:05:00",
    },
    {
        "id": 3,
        "course_id": 1,
        "course_code": "SE 2250B",
        "title": "Assignment 3 rubric updated",
        "body": "The rubric for Assignment 3 has been updated with clearer marking criteria.",
        "author": "Dr. Smith",
        "posted_at": "2025-06-20T14:00:00",
        "is_pinned": 0,
        "brightspace_id": 103,
        "created_at": "2025-06-20T14:05:00",
    },
]

ASSIGNMENTS: list[dict[str, Any]] = [
    {
        "id": 1,
        "course_id": 1,
        "title": "Assignment 3 — Design Patterns",
        "description": "Implement observer and strategy patterns.",
        "due_at": "2025-06-15T23:59:00",
        "weight": 15.0,
        "status": "submitted",
        "source": "brightspace",
        "brightspace_folder_id": 201,
        "url": None,
        "notes": "Extended +2 days per prof email (audited)",
        "created_at": "2025-05-01T00:00:00",
        "updated_at": "2025-06-15T00:00:00",
    },
    {
        "id": 2,
        "course_id": 1,
        "title": "Assignment 2 — Unit Testing",
        "description": "Write comprehensive JUnit tests.",
        "due_at": "2025-05-28T23:59:00",
        "weight": 12.0,
        "status": "graded",
        "source": "brightspace",
        "brightspace_folder_id": 202,
        "url": None,
        "notes": None,
        "created_at": "2025-04-15T00:00:00",
        "updated_at": "2025-05-28T00:00:00",
    },
    {
        "id": 3,
        "course_id": 1,
        "title": "Assignment 1 — Git Workflow",
        "description": "Set up repo and branching strategy.",
        "due_at": "2025-04-20T23:59:00",
        "weight": 8.0,
        "status": "graded",
        "source": "brightspace",
        "brightspace_folder_id": 203,
        "url": None,
        "notes": None,
        "created_at": "2025-03-20T00:00:00",
        "updated_at": "2025-04-20T00:00:00",
    },
]

CONTENT_NODES: list[dict[str, Any]] = [
    {"id": 1, "course_id": 1, "parent_id": None, "brightspace_id": 1, "node_type": "module", "topic_type": None, "title": "Module 1 — Introduction", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 0},
    {"id": 2, "course_id": 1, "parent_id": 1, "brightspace_id": 2, "node_type": "topic", "topic_type": "file", "title": "Syllabus", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 0},
    {"id": 3, "course_id": 1, "parent_id": 1, "brightspace_id": 3, "node_type": "topic", "topic_type": "file", "title": "Course Overview", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 1},
    {"id": 4, "course_id": 1, "parent_id": None, "brightspace_id": 4, "node_type": "module", "topic_type": None, "title": "Module 2 — OOP Fundamentals", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 1},
    {"id": 5, "course_id": 1, "parent_id": 4, "brightspace_id": 5, "node_type": "topic", "topic_type": "file", "title": "Lecture 1 — Classes & Objects", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 0},
    {"id": 6, "course_id": 1, "parent_id": 4, "brightspace_id": 6, "node_type": "topic", "topic_type": "file", "title": "Lecture 2 — Inheritance", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 1},
    {"id": 7, "course_id": 1, "parent_id": 4, "brightspace_id": 7, "node_type": "topic", "topic_type": "file", "title": "Lab 1 — OOP Exercises", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 2},
    {"id": 8, "course_id": 1, "parent_id": None, "brightspace_id": 8, "node_type": "module", "topic_type": None, "title": "Assignments", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 2},
    {"id": 9, "course_id": 1, "parent_id": 8, "brightspace_id": 9, "node_type": "topic", "topic_type": "file", "title": "A3 Specification", "description": None, "url": None, "due_at": None, "is_hidden": 0, "is_locked": 0, "sort_order": 0},
]

FILES: list[dict[str, Any]] = [
    {"id": 1, "course_id": 1, "content_node_id": 2, "path": "content/Module 1/syllabus.pdf", "kind": "reading", "source": "brightspace", "sha256": "abc123", "size": 102400, "synced_at": "2025-07-15T14:32:00", "processed": 1, "created_at": "2025-07-15T14:32:00"},
    {"id": 2, "course_id": 1, "content_node_id": 5, "path": "content/Module 2/lecture-01.pdf", "kind": "slide", "source": "brightspace", "sha256": "def456", "size": 2048000, "synced_at": "2025-07-15T14:32:00", "processed": 1, "created_at": "2025-07-15T14:32:00"},
    {"id": 3, "course_id": 1, "content_node_id": 6, "path": "content/Module 2/lecture-02.pdf", "kind": "slide", "source": "brightspace", "sha256": "ghi789", "size": 1800000, "synced_at": "2025-07-15T14:32:00", "processed": 1, "created_at": "2025-07-15T14:32:00"},
    {"id": 4, "course_id": 1, "content_node_id": 9, "path": "content/Assignments/a3-spec.pdf", "kind": "assignment", "source": "brightspace", "sha256": "jkl012", "size": 512000, "synced_at": "2025-07-15T14:32:00", "processed": 1, "created_at": "2025-07-15T14:32:00"},
]

MEMORY_FACTS: list[dict[str, Any]] = [
    {"id": 1, "course_id": 1, "fact": "Final exam format is cumulative.", "category": "exam", "confidence": 0.9, "source": "sync:2025-07-15", "is_active": 1, "created_at": "2025-07-15T14:35:00"},
    {"id": 2, "course_id": 1, "fact": "Lab sessions are Thursdays 2–4pm.", "category": "scheduling", "confidence": 0.85, "source": "sync:2025-07-15", "is_active": 1, "created_at": "2025-07-15T14:35:00"},
]

SYNC_RUNS: list[dict[str, Any]] = [
    {
        "id": 47,
        "started_at": "2025-07-15T14:30:00",
        "finished_at": "2025-07-15T14:32:00",
        "status": "ok",
        "trigger": "manual",
        "courses_processed": 1,
        "files_new": 3,
        "files_changed": 0,
        "announcements_new": 2,
        "facts_added": 1,
        "log_path": "sync_logs/2025-07-15.md",
        "error": None,
    },
    {
        "id": 46,
        "started_at": "2025-07-10T09:00:00",
        "finished_at": "2025-07-10T09:01:00",
        "status": "failed",
        "trigger": "manual",
        "courses_processed": 0,
        "files_new": 0,
        "files_changed": 0,
        "announcements_new": 0,
        "facts_added": 0,
        "log_path": None,
        "error": "Duo timeout — auth not completed",
    },
]

SYNC_LOG_MARKDOWN = """# Sync log — 2025-07-15

## Summary
Synced SE 2250B successfully. 3 new files, 2 new announcements.

## Changes
- New file: `content/Module 2/lecture-02.pdf`
- New file: `content/Module 2/lecture-02.md` (extracted)
- Updated: `content/Assignments/a3-spec.pdf`
- Announcement: Final grades posted
- Announcement: Office hours cancelled

## Memory facts added
- Final exam format is cumulative.
"""

DIGEST_MARKDOWN = """## Today
No classes scheduled.

## Deadlines this week
None.

## New since last sync
- 2 announcements (SE 2250B)
- 1 file updated: Lecture 2 slides.pdf

## Cross-course notes
- Memory: Final exam format is cumulative (SE 2250B)
"""

FILE_CONTENT: dict[int, str] = {
    2: "# Lecture 1 — Classes & Objects\n\n## Topics\n- Encapsulation\n- Constructors\n- Access modifiers\n\n## Key takeaway\nObjects bundle data and behavior.",
    3: "# Lecture 2 — Inheritance\n\n## Topics\n- extends keyword\n- Method overriding\n- super()\n\n## Key takeaway\nInheritance enables code reuse through IS-A relationships.",
    1: "# Syllabus\n\nSoftware Construction — SE 2250B\n\nWinter 2025 term.",
    4: "# Assignment 3 — Design Patterns\n\nImplement the Observer and Strategy patterns in Java.\n\nDue: June 15, 2025",
}

MEMORY_CARD = """# SE 2250B Memory Card

## Exam
- Final exam format is cumulative.

## Scheduling
- Lab sessions are Thursdays 2–4pm.

## Grading
- Assignments: 35% total
- Midterm: 25%
- Final: 40%
"""


def _future_events() -> list[dict[str, Any]]:
    """Generate a few upcoming events for the 2026F courses."""
    base = NOW
    return [
        {
            "id": 101,
            "course_id": 2,
            "course_code": "SE 3309A",
            "kind": "class",
            "title": "SE 3309A LEC",
            "starts_at": (base + timedelta(days=2)).replace(hour=12, minute=30).isoformat(),
            "ends_at": (base + timedelta(days=2)).replace(hour=14, minute=30).isoformat(),
            "all_day": 0,
            "notes": "HSB-240",
            "ics_uid": "se3309a-lec-1",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        },
        {
            "id": 102,
            "course_id": 3,
            "course_code": "SE 3316A",
            "kind": "class",
            "title": "SE 3316A LAB",
            "starts_at": (base + timedelta(days=4)).replace(hour=13, minute=30).isoformat(),
            "ends_at": (base + timedelta(days=4)).replace(hour=15, minute=30).isoformat(),
            "all_day": 0,
            "notes": "ACEB-4440",
            "ics_uid": "se3316a-lab-1",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        },
    ]


EVENTS: list[dict[str, Any]] = _future_events()
