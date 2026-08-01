"""Tool registry — schemas + handlers for the agent.

Families per DESIGN.md:
  harness_*   structured DB reads (dates, deadlines, facts)
  content_*   file access over the synced corpus (read, grep)
  mutate_*    audited actions (every write logs before/after to audit_log)
  web_search  SearXNG for outside-the-harness questions
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import httpx

from sync.config import Config
from sync.db import DB

MAX_READ_BYTES = 200_000


def _norm(code: str) -> str:
    return re.sub(r"\s+", "", code or "").upper()


def _resolve_course(db: DB, code: str | None) -> int | None:
    if not code:
        return None
    row = db.conn.execute("SELECT id FROM courses WHERE code=?", (code,)).fetchone()
    if not row:
        row = db.conn.execute("SELECT id FROM courses WHERE code LIKE ?", (f"%{_norm(code)}%",)).fetchone()
    return row["id"] if row else None


def _rows_as_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ── handlers ────────────────────────────────────────────────────────────

def harness_list_assignments(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    q = """SELECT a.id, c.code, a.title, a.due_at, a.status, a.weight, a.notes
           FROM assignments a JOIN courses c ON c.id=a.course_id WHERE 1=1"""
    params = []
    if course_id:
        q += " AND a.course_id=?"; params.append(course_id)
    if args.get("status"):
        q += " AND a.status=?"; params.append(args["status"])
    if args.get("due_within_days"):
        q += " AND a.due_at IS NOT NULL AND a.due_at <= datetime('now', ?)"
        params.append(f"+{int(args['due_within_days'])} days")
    q += " ORDER BY a.due_at"
    rows = db.conn.execute(q, params).fetchall()
    return {"assignments": _rows_as_dicts(rows)}


def harness_get_announcements(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    q = """SELECT c.code, a.title, a.body, a.posted_at, a.author
           FROM announcements a JOIN courses c ON c.id=a.course_id WHERE 1=1"""
    params = []
    if course_id:
        q += " AND a.course_id=?"; params.append(course_id)
    if args.get("days"):
        q += " AND a.posted_at >= datetime('now', ?)"; params.append(f"-{int(args['days'])} days")
    q += " ORDER BY a.posted_at DESC LIMIT 30"
    rows = db.conn.execute(q, params).fetchall()
    return {"announcements": _rows_as_dicts(rows)}


def harness_get_facts(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    q = "SELECT fact, category, confidence, source, created_at FROM memory_facts WHERE is_active=1"
    params = []
    if course_id:
        q += " AND course_id=?"; params.append(course_id)
    if args.get("category"):
        q += " AND category=?"; params.append(args["category"])
    q += " ORDER BY id DESC LIMIT 40"
    rows = db.conn.execute(q, params).fetchall()
    return {"facts": _rows_as_dicts(rows)}


def harness_get_courses(db: DB, cfg: Config, args: dict) -> dict:
    rows = db.conn.execute(
        """SELECT c.code, c.name, c.term, c.instructor, c.is_pilot,
                  (SELECT COUNT(*) FROM assignments a WHERE a.course_id=c.id AND a.status IN ('open','in_progress')) AS open_assignments
           FROM courses c WHERE c.is_active=1 ORDER BY c.term, c.code"""
    ).fetchall()
    return {"courses": _rows_as_dicts(rows)}


def content_list_files(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    q = "SELECT path, kind, source, processed, size FROM files WHERE 1=1"
    params = []
    if course_id:
        q += " AND course_id=?"; params.append(course_id)
    if args.get("kind"):
        q += " AND kind=?"; params.append(args["kind"])
    q += " ORDER BY path LIMIT 100"
    rows = db.conn.execute(q, params).fetchall()
    return {"files": _rows_as_dicts(rows)}


def content_read_file(db: DB, cfg: Config, args: dict) -> dict:
    path = Path(args.get("path", ""))
    root = Path(cfg.data_root).resolve()
    full = (root / path).resolve()
    if root not in full.parents and full != root:
        return {"error": "path must be under data_root"}
    # prefer the extracted .md sibling when given a .pdf (or when the file is binary)
    if not full.exists() or full.suffix.lower() not in (".md", ".txt", ".html"):
        sibling = full.with_suffix(".md")
        if sibling.exists():
            full = sibling
            path = sibling.relative_to(root)
        elif not full.exists():
            return {"error": f"file missing: {path}"}
    data = full.read_bytes()[:MAX_READ_BYTES]
    return {"path": str(path), "content": data.decode("utf-8", errors="replace")}


def content_grep(db: DB, cfg: Config, args: dict) -> dict:
    query = args.get("query", "")
    if not query:
        return {"error": "query required"}
    course_id = _resolve_course(db, args.get("course"))
    root = Path(cfg.data_root)
    search_dir = root
    if course_id:
        row = db.conn.execute("SELECT code, term FROM courses WHERE id=?", (course_id,)).fetchone()
        if row:
            search_dir = root / row["term"] / row["code"].replace(" ", "")
    if not search_dir.exists():
        return {"matches": [], "note": "no content dir yet"}
    try:
        out = subprocess.run(
            ["rg", "-i", "-m", "2", "--with-filename", "--line-number", query, str(search_dir)],
            capture_output=True, text=True, timeout=20,
        )
        lines = out.stdout.splitlines()[:40]
    except FileNotFoundError:
        lines = []
        for p in sorted(search_dir.rglob("*")):
            if p.suffix.lower() in (".md", ".txt") and query.lower() in p.read_text(errors="ignore").lower():
                lines.append(f"{p}: (matched)")
    matches = []
    for ln in lines:
        try:
            path, rest = ln.split(":", 1)
            rel = path.replace(str(root) + "/", "")
            matches.append({"path": rel, "snippet": rest.strip()[:200]})
        except ValueError:
            continue
    return {"matches": matches[:20],
            "note": "paths relative to data_root; snippets from matched lines. "
                    "If a .pdf path is shown, prefer reading its .md sibling (extracted version)."}


def mutate_update_assignment(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    ident = args.get("id") or args.get("title")
    q = "SELECT * FROM assignments WHERE 1=1"
    params = []
    if args.get("id"):
        q += " AND id=?"; params.append(int(args["id"]))
    elif ident:
        q += " AND title LIKE ?"; params.append(f"%{ident}%")
    if course_id:
        q += " AND course_id=?"; params.append(course_id)
    row = db.conn.execute(q + " LIMIT 1", params).fetchone()
    if not row:
        return {"error": "assignment not found"}
    before = dict(row)
    updates, params = [], []
    for field in ("due_at", "status", "notes"):
        if args.get(field) is not None:
            updates.append(f"{field}=?"); params.append(args[field])
    if not updates:
        return {"error": "no fields to update (due_at/status/notes)"}
    params.append(row["id"])
    db.conn.execute(f"UPDATE assignments SET {', '.join(updates)}, updated_at=datetime('now') WHERE id=?", params)
    after = dict(db.conn.execute("SELECT * FROM assignments WHERE id=?", (row["id"],)).fetchone())
    db.audit("ai", "assignments", row["id"], "update", {"before": before, "after": after})
    db.conn.commit()
    return {"updated": True, "assignment": after}


def mutate_add_fact(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    allowed = {"general", "scheduling", "grading", "course-policy", "prof-note", "exam", "assignment", "logistics"}
    category = args.get("category", "general")
    if category not in allowed:
        category = "general"
    import datetime
    cur = db.conn.execute(
        """INSERT INTO memory_facts (course_id, fact, category, confidence, source)
           VALUES (?,?,?,?,?)""",
        (course_id, args.get("fact", ""), category,
         float(args.get("confidence", 0.7)), f"chat:{datetime.date.today().isoformat()}"),
    )
    db.audit("ai", "memory_facts", cur.lastrowid, "create", {"fact": args.get("fact"), "category": category})
    db.conn.commit()
    return {"created": True, "fact_id": cur.lastrowid}


def mutate_add_note(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    cur = db.conn.execute(
        "INSERT INTO notes (course_id, title, body_md, source) VALUES (?,?,?,'ai')",
        (course_id, args.get("title", "Note"), args.get("body", "")),
    )
    db.audit("ai", "notes", cur.lastrowid, "create", {"title": args.get("title"), "body": args.get("body", "")[:200]})
    db.conn.commit()
    return {"created": True, "note_id": cur.lastrowid}


def mutate_add_event(db: DB, cfg: Config, args: dict) -> dict:
    course_id = _resolve_course(db, args.get("course"))
    import uuid
    cur = db.conn.execute(
        """INSERT INTO events (course_id, kind, title, starts_at, ends_at, notes, ics_uid)
           VALUES (?,?,?,?,?,?,?)""",
        (course_id, args.get("kind", "personal"), args.get("title", ""),
         args.get("starts_at"), args.get("ends_at"), args.get("notes"), str(uuid.uuid4())),
    )
    db.audit("ai", "events", cur.lastrowid, "create", {"title": args.get("title"), "starts_at": args.get("starts_at")})
    db.conn.commit()
    return {"created": True, "event_id": cur.lastrowid}


def web_search(db: DB, cfg: Config, args: dict) -> dict:
    try:
        r = httpx.get("http://127.0.0.1:8888/search",
                      params={"q": args.get("query", ""), "format": "json"},
                      timeout=20)
        r.raise_for_status()
        results = r.json().get("results", [])[:5]
        return {"results": [{"title": x.get("title"), "url": x.get("url"),
                             "snippet": x.get("content", "")[:300]} for x in results]}
    except Exception as e:
        return {"error": f"search failed: {e}"}


# ── registry ────────────────────────────────────────────────────────────

def _tool(name: str, description: str, handler, required: list | None = None, **props):
    """Build an OpenAI function schema without hand-counted braces."""
    return {
        "handler": handler,
        "schema": {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": props,
                    **({"required": required} if required else {}),
                },
            },
        },
    }


TOOLS = {
    "harness_list_assignments": _tool(
        "harness_list_assignments",
        "List assignments from synced data. Filter by course code, status (open/in_progress/submitted/graded/extended), or due within N days.",
        harness_list_assignments,
        course={"type": "string", "description": "course code, e.g. 'SE 2250B'"},
        status={"type": "string"},
        due_within_days={"type": "integer"},
    ),
    "harness_get_announcements": _tool(
        "harness_get_announcements",
        "Get announcements (prof posts) for a course, optionally within N days.",
        harness_get_announcements,
        course={"type": "string"},
        days={"type": "integer"},
    ),
    "harness_get_facts": _tool(
        "harness_get_facts",
        "Get AI-extracted memory facts. course optional (omitting returns all incl. cross-course). category: general/scheduling/grading/course-policy/prof-note/exam/assignment/logistics.",
        harness_get_facts,
        course={"type": "string"},
        category={"type": "string"},
    ),
    "harness_get_courses": _tool(
        "harness_get_courses",
        "List all courses with open assignment counts.",
        harness_get_courses,
    ),
    "content_list_files": _tool(
        "content_list_files",
        "List synced files for a course (slides, readings, handouts...).",
        content_list_files,
        course={"type": "string"},
        kind={"type": "string"},
    ),
    "content_read_file": _tool(
        "content_read_file",
        "Read a text/markdown file from the synced corpus. Path is relative to data_root (e.g. '2025W/SE2250B/content/Course Overview/SE2250 2025-2026 outline.md').",
        content_read_file,
        required=["path"],
        path={"type": "string"},
    ),
    "content_grep": _tool(
        "content_grep",
        "Search course content files (slides, outlines, notes) for a keyword. Returns matching file paths.",
        content_grep,
        required=["query"],
        query={"type": "string"},
        course={"type": "string"},
    ),
    "mutate_update_assignment": _tool(
        "mutate_update_assignment",
        "Update an assignment's due_at (ISO datetime), status, or notes. Audited. Use when the user reports a change (extension, completion...).",
        mutate_update_assignment,
        course={"type": "string"},
        id={"type": "integer"},
        title={"type": "string", "description": "or match by title"},
        due_at={"type": "string", "description": "ISO 8601"},
        status={"type": "string", "enum": ["open", "in_progress", "submitted", "graded", "extended"]},
        notes={"type": "string"},
    ),
    "mutate_add_fact": _tool(
        "mutate_add_fact",
        "Store a durable fact the user stated or a prof said (extension, policy, exam info). Audited.",
        mutate_add_fact,
        required=["fact"],
        course={"type": "string"},
        fact={"type": "string"},
        category={"type": "string"},
        confidence={"type": "number"},
    ),
    "mutate_add_note": _tool(
        "mutate_add_note",
        "Save a user/AI note (markdown). course optional. Audited.",
        mutate_add_note,
        required=["title", "body"],
        course={"type": "string"},
        title={"type": "string"},
        body={"type": "string"},
    ),
    "mutate_add_event": _tool(
        "mutate_add_event",
        "Add a calendar event (class/assignment/exam/personal). Audited.",
        mutate_add_event,
        required=["title", "starts_at"],
        course={"type": "string"},
        kind={"type": "string"},
        title={"type": "string"},
        starts_at={"type": "string"},
        ends_at={"type": "string"},
        notes={"type": "string"},
    ),
    "web_search": _tool(
        "web_search",
        "Web search (SearXNG) for questions outside the synced course data.",
        web_search,
        required=["query"],
        query={"type": "string"},
    ),
}

TOOL_SCHEMAS = [t["schema"] for t in TOOLS.values()]


def execute_tool(name: str, args: dict, db: DB, cfg: Config) -> dict:
    entry = TOOLS.get(name)
    if not entry:
        return {"error": f"unknown tool: {name}"}
    try:
        return entry["handler"](db, cfg, args or {})
    except Exception as e:
        return {"error": f"{name} failed: {e}"}
