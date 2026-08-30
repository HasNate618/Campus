"""Read services — thin SQL over the harness DB, shaped for the frontend
contracts in web/src/types.ts. No logic beyond queries; the harness owns
logic (agent/) and mutations (mutate_* tools, audit_log).
"""

from __future__ import annotations

import datetime
import hashlib
import json
import sqlite3
import threading
from pathlib import Path

from api.config import cfg, DB_PATH, SCHOOL_ROOT
from api.db import get_conn


def _rows(q: str, args: tuple = ()) -> list[dict]:
    with get_conn() as c:
        return [dict(r) for r in c.execute(q, args)]


def _row(q: str, args: tuple = ()) -> dict | None:
    rows = _rows(q, args)
    return rows[0] if rows else None


def _now_iso() -> str:
    return datetime.datetime.now().isoformat()


# ── courses ─────────────────────────────────────────────────────────────
def list_courses(active_only: bool = True) -> list[dict]:
    q = """SELECT c.*,
        (SELECT COUNT(*) FROM files f WHERE f.course_id=c.id) AS file_count,
        (SELECT COUNT(*) FROM assignments a WHERE a.course_id=c.id) AS assignment_count,
        (SELECT started_at FROM sync_runs s WHERE s.status IN ('ok','partial')
           ORDER BY s.id DESC LIMIT 1) AS last_sync_at
        FROM courses c"""
    if active_only:
        q += " WHERE c.is_active=1"
    q += " ORDER BY c.term DESC, c.code"
    return _rows(q)


def get_course(course_id: int) -> dict | None:
    return _row("SELECT * FROM courses WHERE id=?", (course_id,))


# ── schedule ────────────────────────────────────────────────────────────
DAY_LETTERS = ["M", "Tu", "W", "Th", "F", "Sa", "Su"]
KIND_ORDER = {"LEC": 0, "LAB": 1, "TUT": 2}


def _fmt_12h(t: str) -> str:
    """'11:30' -> '11:30 AM', '18:30' -> '6:30 PM'."""
    hh, mm = t.split(":")
    h = int(hh) % 12 or 12
    return f"{h}:{mm} {'AM' if int(hh) < 12 else 'PM'}"


def get_schedule() -> list[dict]:
    """Weekly timetable in the frontend ScheduleCourse[] contract
    (web/src/types.ts). One ScheduleBlock per (course, kind, section);
    meetings are the course_sessions rows."""
    rows = _rows(
        """SELECT c.id, c.code, c.name, c.units, c.class_nbr, c.instructor,
                  s.kind, s.section, s.day_of_week, s.start_time, s.end_time, s.room
           FROM courses c JOIN course_sessions s ON s.course_id = c.id
           WHERE c.is_active = 1
           ORDER BY c.code, s.kind, s.day_of_week"""
    )
    courses: dict[int, dict] = {}
    for r in rows:
        course = courses.setdefault(r["id"], {
            "id": r["id"],
            "code": r["code"],
            "name": r["name"],
            "credit": f"{r['units']:.2f}",
            "mode": "In Person",
            "blocks": [],
        })
        key = (r["kind"], r["section"])
        block = next((b for b in course["blocks"]
                      if (b["type"], b["section"]) == key), None)
        if block is None:
            block = {
                "type": r["kind"],
                "section": r["section"] or "",
                "crn": int(r["class_nbr"]) if r["class_nbr"] else 0,
                "meetings": [],
            }
            if r["instructor"]:
                block["instructor"] = r["instructor"]
            course["blocks"].append(block)
        meeting = {
            "day": DAY_LETTERS[r["day_of_week"]],
            "start": _fmt_12h(r["start_time"]),
            "end": _fmt_12h(r["end_time"]),
        }
        if r["room"]:
            meeting["room"] = r["room"]
        block["meetings"].append(meeting)
    for course in courses.values():
        course["blocks"].sort(
            key=lambda b: (KIND_ORDER.get(b["type"], 9), b["section"]))
        for block in course["blocks"]:
            block["meetings"].sort(key=lambda m: DAY_LETTERS.index(m["day"]))
    return list(courses.values())


# ── course hub ──────────────────────────────────────────────────────────
def course_hub(course_id: int) -> dict | None:
    course = get_course(course_id)
    if not course:
        return None
    announcements = _rows(
        "SELECT * FROM announcements WHERE course_id=? ORDER BY posted_at DESC", (course_id,))
    events = events_next_days(7, course_id=course_id)
    assignments_upcoming = _rows(
        """SELECT * FROM assignments WHERE course_id=? AND due_at IS NOT NULL
           AND due_at >= datetime('now') ORDER BY due_at LIMIT 8""", (course_id,))
    memory_facts = _rows(
        "SELECT id, fact, category FROM memory_facts WHERE course_id=? AND is_active=1 "
        "ORDER BY id DESC LIMIT 12", (course_id,))
    recent_files = _rows(
        "SELECT * FROM files WHERE course_id=? ORDER BY id DESC LIMIT 8", (course_id,))
    stats = {
        "file_count": _row("SELECT COUNT(*) n FROM files WHERE course_id=?", (course_id,))["n"],
        "assignment_count": _row("SELECT COUNT(*) n FROM assignments WHERE course_id=?", (course_id,))["n"],
        "processed_files": _row("SELECT COUNT(*) n FROM files WHERE course_id=? AND processed=1", (course_id,))["n"],
    }
    return {
        "course": course,
        "announcements": announcements,
        "events": events,
        "assignments_upcoming": assignments_upcoming,
        "memory_facts": memory_facts,
        "recent_files": recent_files,
        "stats": stats,
    }


# ── content / files ─────────────────────────────────────────────────────
def list_content_nodes(course_id: int) -> list[dict]:
    return _rows(
        "SELECT * FROM content_nodes WHERE course_id=? ORDER BY sort_order, id", (course_id,))


def list_files(course_id: int) -> list[dict]:
    return _rows("SELECT * FROM files WHERE course_id=? ORDER BY id", (course_id,))


def list_file_topics(course_id: int) -> list[dict]:
    """file_topics rows for a course (one file displayed under many topics)."""
    return _rows(
        "SELECT ft.file_id, ft.topic_id FROM file_topics ft "
        "JOIN files f ON f.id = ft.file_id WHERE f.course_id=?",
        (course_id,))


def get_file(file_id: int) -> dict | None:
    return _row("SELECT * FROM files WHERE id=?", (file_id,))


def resolve_ref(course_id: int, ref: str) -> dict | None:
    """Map a harness ref (file path or overview/id) to UI navigation."""
    from sync.db import DB
    from agent.citations import resolve_ref as _resolve

    db = DB(DB_PATH)
    try:
        return _resolve(db, course_id, ref)
    finally:
        db.close()


def _read_text(path: Path, max_chars: int = 200_000) -> str:
    return path.read_bytes()[:max_chars].decode("utf-8", errors="replace")


CODE_EXTS = {
    ".cs", ".py", ".js", ".ts", ".tsx", ".sql", ".json",
    ".yaml", ".yml", ".sh", ".java", ".c", ".cpp",
}
DOWNLOAD_EXTS = {".zip", ".rar", ".7z", ".tar", ".gz"}


def get_file_content(file_id: int) -> dict | None:
    """Content contract for the frontend:
    {'content': str, 'format': 'markdown'|'html'|'code'|'pdf'|'download',
     'rawUrl': str|null}
    """
    f = get_file(file_id)
    if not f:
        return None
    full = (SCHOOL_ROOT / f["path"]).resolve()
    if not full.exists():
        return None
    ext = full.suffix.lower()
    raw_url = f"/api/files/{file_id}/raw"
    if ext == ".pdf":
        # rawUrl ALWAYS (pdf.js viewer); content = extracted .md sibling
        # when present so processed PDFs render as markdown, else ''
        sibling = full.with_suffix(".md")
        content = _read_text(sibling) if sibling.exists() else ""
        return {"content": content, "format": "pdf", "rawUrl": raw_url}
    if ext in DOWNLOAD_EXTS:
        return {"content": "", "format": "download", "rawUrl": raw_url}
    if ext in {".html", ".htm"}:
        return {"content": _read_text(full), "format": "html", "rawUrl": None}
    if ext in CODE_EXTS:
        return {"content": _read_text(full), "format": "code", "rawUrl": None}
    # .md/.txt/.markdown (and unknown types) — raw text, no sibling logic
    return {"content": _read_text(full), "format": "markdown", "rawUrl": None}


def get_file_raw_path(file_id: int) -> Path | None:
    f = get_file(file_id)
    if not f:
        return None
    full = (SCHOOL_ROOT / f["path"]).resolve()
    return full if full.exists() else None


# ── assignments / announcements ─────────────────────────────────────────
def _parse_assignment(r: dict) -> dict:
    for col, key in (("rubrics_json", "rubrics"), ("attachments_json", "attachments"),
                     ("availability_json", "availability")):
        j = r.get(col)
        r[key] = json.loads(j) if j else None
        r.pop(col, None)
    # the user's team name ("Group 29") for group assignments
    r["group_name"] = None
    if r.get("group_category"):
        g = _row("SELECT group_name FROM course_groups WHERE course_id=? AND category_name=?",
                 (r["course_id"], r["group_category"]))
        r["group_name"] = g["group_name"] if g else None
    # closed = the folder's availability window ended (no dates = open forever)
    av = r.get("availability") or {}
    end = av.get("EndDate")
    r["closed"] = False
    if end:
        try:
            d = datetime.datetime.fromisoformat(end.replace("Z", "+00:00"))
            r["closed"] = d < datetime.datetime.now(datetime.timezone.utc)
        except ValueError:
            pass
    return r


def list_assignments(course_id: int, upcoming_only: bool = False) -> list[dict]:
    q = "SELECT * FROM assignments WHERE course_id=?"
    args: tuple = (course_id,)
    if upcoming_only:
        q += " AND due_at IS NOT NULL AND due_at >= datetime('now')"
    q += " ORDER BY due_at"
    return [_parse_assignment(r) for r in _rows(q, args)]


# ── workspace (course file tree + audited text editor) ─────────────────
WRITABLE_WORKSPACE_DIRS = ("notes", "work")
WORKSPACE_TEXT_SUFFIXES = {".md", ".txt", ".html", ".htm", ".json", ".yaml", ".yml",
                           ".csv", ".py", ".ts", ".tsx", ".js", ".css", ".nix", ".sh"}
WORKSPACE_READ_CAP = 200_000
WORKSPACE_WRITE_CAP = 512_000


def course_dir(course: dict) -> Path:
    return SCHOOL_ROOT / course["term"] / course["code"].replace(" ", "")


def _writable_rel(rel: str) -> bool:
    return rel.split("/", 1)[0] in WRITABLE_WORKSPACE_DIRS


def _resolve_workspace(course: dict, rel: str) -> Path:
    root = course_dir(course).resolve()
    full = (root / rel).resolve()
    if not full.is_relative_to(root):
        raise ValueError("path escapes the course dir")
    return full


def workspace_tree(course_id: int) -> dict | None:
    course = get_course(course_id)
    if not course:
        return None
    root = course_dir(course)
    if not root.exists():
        return {"root": root.name, "nodes": []}

    def walk(d: Path, rel: str, depth: int) -> list[dict]:
        if depth > 5:
            return []
        out = []
        for p in sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if p.name.startswith(".") or p.name.endswith(".prev") or p.name == "_assets":
                continue
            r = f"{rel}/{p.name}" if rel else p.name
            if p.is_dir():
                children = walk(p, r, depth + 1)
                out.append({"name": p.name, "path": r, "type": "dir",
                            "writable": p.name in WRITABLE_WORKSPACE_DIRS,
                            "children": children})
            else:
                try:
                    st = p.stat()
                    out.append({"name": p.name, "path": r, "type": "file",
                                "size": st.st_size,
                                "mtime": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                                "kind": p.suffix.lower().lstrip(".") or "file",
                                "writable": _writable_rel(r)})
                except OSError:
                    continue
        return out

    return {"root": root.name, "nodes": walk(root, "", 0)}


def workspace_read(course_id: int, rel: str) -> dict:
    course = get_course(course_id) or {"term": "", "code": ""}
    if not course.get("term"):
        raise ValueError("course not found")
    full = _resolve_workspace(course, rel)
    if not full.exists() or not full.is_file():
        raise FileNotFoundError(rel)
    if full.suffix.lower() in WORKSPACE_TEXT_SUFFIXES:
        if full.stat().st_size > WORKSPACE_READ_CAP:
            raise ValueError("file too large to edit — open in viewer")
        return {"text": full.read_text(encoding="utf-8", errors="replace"),
                "viewable": True, "asset": None}
    return {"text": None, "viewable": False,
            "asset": f"/api/assets/{course['term']}/{course['code'].replace(' ', '')}/{rel}"}


def workspace_write(course_id: int, rel: str, content: str) -> dict:
    course = get_course(course_id) or {}
    if not course.get("term"):
        raise ValueError("course not found")
    if not _writable_rel(rel):
        raise PermissionError("read-only — only notes/ and work/ are editable")
    if len(content) > WORKSPACE_WRITE_CAP:
        raise ValueError("file too large to save")
    full = _resolve_workspace(course, rel)
    before = hashlib.sha256(full.read_bytes()).hexdigest() if full.exists() else None
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    after = hashlib.sha256(full.read_bytes()).hexdigest()
    return {"path": rel, "size": full.stat().st_size, "before": before, "after": after}


def workspace_delete(course_id: int, rel: str) -> dict:
    course = get_course(course_id) or {}
    if not course.get("term"):
        raise ValueError("course not found")
    if not _writable_rel(rel):
        raise PermissionError("read-only — only notes/ and work/ are editable")
    full = _resolve_workspace(course, rel)
    if not full.exists() or not full.is_file():
        raise FileNotFoundError(rel)
    size = full.stat().st_size
    full.unlink()
    return {"path": rel, "size": size}


def workspace_mkdir(course_id: int, rel: str) -> dict:
    course = get_course(course_id) or {}
    if not course.get("term"):
        raise ValueError("course not found")
    if not _writable_rel(rel):
        raise PermissionError("read-only — only notes/ and work/ are editable")
    full = _resolve_workspace(course, rel)
    if full.exists():
        raise ValueError("already exists")
    full.mkdir(parents=True, exist_ok=True)
    return {"path": rel}


def workspace_audit(action: str, course_id: int, rel: str, detail: dict) -> None:
    from api.db import get_conn
    try:
        with get_conn() as c:
            c.execute(
                "INSERT INTO audit_log (actor, entity, entity_id, action, detail) VALUES (?,?,?,?,?)",
                ("user", "files", course_id, action, json.dumps(detail)))
            c.commit()
    except Exception:
        pass


def get_assignment(course_id: int, assignment_id: int) -> dict | None:
    r = _row("SELECT * FROM assignments WHERE course_id=? AND id=?", (course_id, assignment_id))
    return _parse_assignment(r) if r else None


def list_announcements(course_id: int | None = None, limit: int = 20) -> list[dict]:
    q = """SELECT a.*, c.code AS course_code FROM announcements a
           JOIN courses c ON c.id = a.course_id"""
    args: tuple = ()
    if course_id is not None:
        q += " WHERE a.course_id=?"
        args = (course_id,)
    q += " ORDER BY a.posted_at DESC LIMIT ?"
    return _rows(q, args + (limit,))


# ── events (assignments + exams + hand-created, next N days) ────────────
def _events_sql(base: str, course_id: int | None, args: tuple) -> tuple[str, tuple]:
    if course_id is not None:
        return base + " WHERE (? IS NULL OR a.course_id=?)", args + (course_id, course_id)
    return base, args


def events_next_days(days: int, course_id: int | None = None) -> list[dict]:
    now = _now_iso()
    later = (datetime.datetime.now() + datetime.timedelta(days=days)).isoformat()
    q = """SELECT a.id, a.course_id, c.code AS course_code, 'assignment' AS kind,
                  a.title, a.due_at AS starts_at, NULL AS ends_at, NULL AS notes
           FROM assignments a JOIN courses c ON c.id=a.course_id
           WHERE a.due_at BETWEEN ? AND ? AND (? IS NULL OR a.course_id=?)
           UNION ALL
           SELECT e.id, e.course_id, c.code, 'exam', e.title, e.starts_at, NULL, NULL
           FROM exams e JOIN courses c ON c.id=e.course_id
           WHERE e.starts_at BETWEEN ? AND ? AND (? IS NULL OR e.course_id=?)
           UNION ALL
           SELECT ev.id, ev.course_id, c.code, ev.kind, ev.title, ev.starts_at, ev.ends_at, ev.notes
           FROM events ev LEFT JOIN courses c ON c.id=ev.course_id
           WHERE ev.starts_at BETWEEN ? AND ? AND (? IS NULL OR ev.course_id=?)
           ORDER BY starts_at"""
    args = (now, later, course_id, course_id) * 3
    return _rows(q, args)


def list_events(course_id: int | None = None,
                from_dt: str | None = None, to_dt: str | None = None) -> list[dict]:
    q = """SELECT ev.id, ev.course_id, c.code AS course_code, ev.kind, ev.title,
                  ev.starts_at, ev.ends_at, ev.notes
           FROM events ev LEFT JOIN courses c ON c.id=ev.course_id WHERE 1=1"""
    args: tuple = ()
    if course_id is not None:
        q += " AND ev.course_id=?"
        args += (course_id,)
    if from_dt:
        q += " AND ev.starts_at >= ?"
        args += (from_dt,)
    if to_dt:
        q += " AND ev.starts_at <= ?"
        args += (to_dt,)
    q += " ORDER BY ev.starts_at"
    return _rows(q, args)


# ── memory card ─────────────────────────────────────────────────────────
def get_memory_card(course_id: int) -> str:
    course = get_course(course_id)
    if not course:
        return ""
    p = SCHOOL_ROOT / course["term"] / course["code"].replace(" ", "") / "memory-card.md"
    if p.exists():
        return p.read_text()[:20_000]
    return ""


# ── sync runs / digest ──────────────────────────────────────────────────
def latest_sync_status() -> dict:
    last = _row("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1")
    token_valid = False
    try:
        from sync.token_store import TokenStore
        store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
        token_valid = bool(store.load())
    except Exception:
        pass
    return {"status": (last or {}).get("status", "never"), "last_run": last,
            "token_valid": token_valid}


def list_sync_runs(limit: int = 20) -> list[dict]:
    return _rows("SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", (limit,))


def get_sync_run(run_id: int) -> dict | None:
    return _row("SELECT * FROM sync_runs WHERE id=?", (run_id,))


def get_sync_log(run_id: int) -> str:
    run = get_sync_run(run_id)
    if not run or not run.get("log_path"):
        return ""
    p = Path(run["log_path"])
    if p.exists():
        return p.read_text()[:20_000]
    return ""


def get_digest() -> dict:
    logs = sorted((SCHOOL_ROOT / "sync_logs").glob("*.md")) if (SCHOOL_ROOT / "sync_logs").exists() else []
    if not logs:
        return {"generated_at": "", "markdown": "", "source": ""}
    latest = logs[-1]
    return {"generated_at": latest.stem, "markdown": latest.read_text()[:20_000],
            "source": str(latest)}


# ── sync trigger (background) ───────────────────────────────────────────
def trigger_sync(course_id: int | None = None) -> dict:
    def _run() -> None:
        try:
            from sync.d2l import D2LClient
            from sync.sync import SyncEngine
            from sync.token_store import TokenStore
            from sync.db import DB
            store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
            db = DB(cfg.db_path)
            client = D2LClient(cfg.base_url, store.load)
            engine = SyncEngine(cfg, db, client)
            code = None
            if course_id:
                row = db.conn.execute("SELECT code FROM courses WHERE id=?", (course_id,)).fetchone()
                code = row["code"] if row else None
            # engine.run() owns the sync_runs lifecycle and error recording
            engine.run(code=code)
            client.close()
            db.close()
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()
    return {"run_id": 0, "status": "started", "message": "sync running in background"}
