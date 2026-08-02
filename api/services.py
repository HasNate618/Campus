"""Data access — SQLite when available, mock fallback."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from api import mock_data
from api.db import db_available, get_conn, rows_to_dicts


def _course_stats(conn, course_id: int) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM files WHERE course_id = ?) AS file_count,
            (SELECT COUNT(*) FROM assignments WHERE course_id = ?) AS assignment_count,
            (SELECT MAX(finished_at) FROM sync_runs) AS last_sync_at
        """,
        (course_id, course_id),
    ).fetchone()
    return dict(row) if row else {"file_count": 0, "assignment_count": 0, "last_sync_at": None}


def list_courses(active_only: bool = True) -> list[dict[str, Any]]:
    if not db_available():
        courses = list(mock_data.COURSES)
        if active_only:
            courses = [c for c in courses if c.get("is_active", 1)]
        return courses

    with get_conn() as conn:
        q = "SELECT * FROM courses"
        if active_only:
            q += " WHERE is_active = 1"
        q += " ORDER BY term, code"
        courses = rows_to_dicts(conn.execute(q).fetchall())
        for c in courses:
            stats = _course_stats(conn, c["id"])
            c.update(stats)
        return courses


def get_course(course_id: int) -> dict[str, Any] | None:
    if not db_available():
        for c in mock_data.COURSES:
            if c["id"] == course_id:
                return dict(c)
        return None

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
        if not row:
            return None
        course = dict(row)
        course.update(_course_stats(conn, course_id))
        return course


def list_announcements(course_id: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
    if not db_available():
        items = mock_data.ANNOUNCEMENTS
        if course_id is not None:
            items = [a for a in items if a["course_id"] == course_id]
        return items[:limit]

    with get_conn() as conn:
        if course_id is not None:
            rows = conn.execute(
                """
                SELECT a.*, c.code AS course_code
                FROM announcements a
                JOIN courses c ON c.id = a.course_id
                WHERE a.course_id = ?
                ORDER BY a.posted_at DESC
                LIMIT ?
                """,
                (course_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT a.*, c.code AS course_code
                FROM announcements a
                JOIN courses c ON c.id = a.course_id
                ORDER BY a.posted_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return rows_to_dicts(rows)


def list_assignments(course_id: int, upcoming_only: bool = False) -> list[dict[str, Any]]:
    if not db_available():
        items = [a for a in mock_data.ASSIGNMENTS if a["course_id"] == course_id]
        if upcoming_only:
            now = datetime.now().isoformat()
            items = [a for a in items if a.get("due_at") and a["due_at"] > now]
        return items

    with get_conn() as conn:
        q = "SELECT * FROM assignments WHERE course_id = ?"
        params: list[Any] = [course_id]
        if upcoming_only:
            q += " AND due_at > datetime('now') AND status NOT IN ('submitted','graded')"
        q += " ORDER BY due_at ASC"
        return rows_to_dicts(conn.execute(q, params).fetchall())


def list_content_nodes(course_id: int) -> list[dict[str, Any]]:
    if not db_available():
        return [n for n in mock_data.CONTENT_NODES if n["course_id"] == course_id]

    with get_conn() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM content_nodes WHERE course_id = ? ORDER BY sort_order, id",
                (course_id,),
            ).fetchall()
        )


def get_content_node(node_id: int) -> dict[str, Any] | None:
    if not db_available():
        for n in mock_data.CONTENT_NODES:
            if n["id"] == node_id:
                return dict(n)
        return None

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM content_nodes WHERE id = ?", (node_id,)).fetchone()
        return dict(row) if row else None


def list_files(course_id: int) -> list[dict[str, Any]]:
    if not db_available():
        return [f for f in mock_data.FILES if f["course_id"] == course_id]

    with get_conn() as conn:
        return rows_to_dicts(
            conn.execute("SELECT * FROM files WHERE course_id = ? ORDER BY path", (course_id,)).fetchall()
        )


def get_file(file_id: int) -> dict[str, Any] | None:
    if not db_available():
        for f in mock_data.FILES:
            if f["id"] == file_id:
                return dict(f)
        return None

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        return dict(row) if row else None


def get_file_content(file_id: int) -> str | None:
    if not db_available():
        return mock_data.FILE_CONTENT.get(file_id)

    # Real impl would read from disk; return placeholder for now
    f = get_file(file_id)
    if not f:
        return None
    return mock_data.FILE_CONTENT.get(file_id, f"# {f['path']}\n\nContent not available locally.")


def list_events(
    course_id: int | None = None,
    from_dt: str | None = None,
    to_dt: str | None = None,
) -> list[dict[str, Any]]:
    if not db_available():
        items = list(mock_data.EVENTS)
        if course_id is not None:
            items = [e for e in items if e.get("course_id") == course_id]
        return items

    with get_conn() as conn:
        q = """
            SELECT e.*, c.code AS course_code
            FROM events e
            LEFT JOIN courses c ON c.id = e.course_id
            WHERE 1=1
        """
        params: list[Any] = []
        if course_id is not None:
            q += " AND e.course_id = ?"
            params.append(course_id)
        if from_dt:
            q += " AND e.starts_at >= ?"
            params.append(from_dt)
        if to_dt:
            q += " AND e.starts_at <= ?"
            params.append(to_dt)
        q += " ORDER BY e.starts_at ASC"
        return rows_to_dicts(conn.execute(q, params).fetchall())


def events_next_days(days: int = 7, course_id: int | None = None) -> list[dict[str, Any]]:
    now = datetime.now()
    end = now + timedelta(days=days)
    return list_events(
        course_id=course_id,
        from_dt=now.isoformat(),
        to_dt=end.isoformat(),
    )


def list_memory_facts(course_id: int) -> list[dict[str, Any]]:
    if not db_available():
        return [m for m in mock_data.MEMORY_FACTS if m["course_id"] == course_id and m["is_active"]]

    with get_conn() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM memory_facts WHERE course_id = ? AND is_active = 1 ORDER BY created_at DESC",
                (course_id,),
            ).fetchall()
        )


def get_memory_card(course_id: int) -> str:
    if not db_available():
        return mock_data.MEMORY_CARD

    facts = list_memory_facts(course_id)
    if not facts:
        return "# Memory Card\n\nNo facts recorded yet."
    lines = ["# Memory Card\n"]
    for f in facts:
        lines.append(f"- **{f['category']}**: {f['fact']}")
    return "\n".join(lines)


def course_hub(course_id: int) -> dict[str, Any] | None:
    course = get_course(course_id)
    if not course:
        return None
    return {
        "course": course,
        "announcements": list_announcements(course_id=course_id, limit=10),
        "events": events_next_days(7, course_id=course_id),
        "assignments_upcoming": list_assignments(course_id, upcoming_only=True),
        "memory_facts": list_memory_facts(course_id),
        "recent_files": list_files(course_id)[:5],
        "stats": {
            "file_count": course.get("file_count", 0),
            "assignment_count": course.get("assignment_count", 0),
            "processed_files": sum(1 for f in list_files(course_id) if f.get("processed")),
        },
    }


def list_sync_runs(limit: int = 20) -> list[dict[str, Any]]:
    if not db_available():
        return mock_data.SYNC_RUNS[:limit]

    with get_conn() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        )


def get_sync_run(run_id: int) -> dict[str, Any] | None:
    if not db_available():
        for r in mock_data.SYNC_RUNS:
            if r["id"] == run_id:
                return dict(r)
        return None

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sync_runs WHERE id = ?", (run_id,)).fetchone()
        return dict(row) if row else None


def get_sync_log(run_id: int) -> str:
    if not db_available():
        return mock_data.SYNC_LOG_MARKDOWN

    run = get_sync_run(run_id)
    if not run or not run.get("log_path"):
        return f"# Sync run #{run_id}\n\nNo log available."
    return mock_data.SYNC_LOG_MARKDOWN


def latest_sync_status() -> dict[str, Any]:
    runs = list_sync_runs(limit=1)
    if not runs:
        return {"status": "never", "last_run": None}
    last = runs[0]
    return {
        "status": last["status"],
        "last_run": last,
        "token_valid": True,
        "token_expires_in_minutes": 42,
    }


def trigger_sync(course_id: int | None = None) -> dict[str, Any]:
    """Mock sync trigger — creates a completed run in mock mode."""
    if not db_available():
        new_run = {
            "id": 48,
            "started_at": datetime.now().isoformat(),
            "finished_at": datetime.now().isoformat(),
            "status": "ok",
            "trigger": "api",
            "courses_processed": 1,
            "files_new": 0,
            "files_changed": 0,
            "announcements_new": 0,
            "facts_added": 0,
            "log_path": "sync_logs/mock.md",
            "error": None,
        }
        mock_data.SYNC_RUNS.insert(0, new_run)
        return {"run_id": new_run["id"], "status": "ok", "message": "Sync completed (mock)"}

    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO sync_runs (status, trigger, courses_processed)
            VALUES ('ok', 'api', 0)
            """
        )
        conn.commit()
        return {"run_id": cur.lastrowid, "status": "ok", "message": "Sync queued (stub)"}


def get_digest() -> dict[str, Any]:
    return {
        "generated_at": datetime.now().isoformat(),
        "markdown": mock_data.DIGEST_MARKDOWN if not db_available() else _build_digest_from_db(),
        "source": "mock" if not db_available() else "db",
    }


def _build_digest_from_db() -> str:
    upcoming = list_events(from_dt=datetime.now().isoformat())
    upcoming_lines = "\n".join(f"- {e['title']} ({e.get('course_code', '')})" for e in upcoming[:5])
    if not upcoming_lines:
        upcoming_lines = "None."
    anns = list_announcements(limit=5)
    ann_lines = "\n".join(f"- {a['course_code']}: {a['title']}" for a in anns)
    if not ann_lines:
        ann_lines = "None."
    return f"""## Today
Check calendar for classes.

## Upcoming events
{upcoming_lines}

## Recent announcements
{ann_lines}
"""
