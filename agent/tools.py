"""Tool registry — schemas + handlers for the agent.

Families per DESIGN.md:
  harness_*   structured DB reads (dates, deadlines, facts)
  content_*   file access over the synced corpus (read, grep)
  mutate_*    audited actions (every write logs before/after to audit_log)
  web_search  SearXNG for outside-the-harness questions
"""
from __future__ import annotations

import datetime
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
    if str(code).isdigit():
        row = db.conn.execute("SELECT id FROM courses WHERE id=?", (int(code),)).fetchone()
        if row:
            return row["id"]
    row = db.conn.execute("SELECT id FROM courses WHERE code=?", (code,)).fetchone()
    if not row:
        row = db.conn.execute("SELECT id FROM courses WHERE code LIKE ?", (f"%{_norm(code)}%",)).fetchone()
    return row["id"] if row else None


def _require_course(db: DB, code: str | None) -> int | None:
    """Like _resolve_course but raises on an explicitly-given unknown code —
    a silent empty result for a typo'd course wastes a whole turn."""
    cid = _resolve_course(db, code)
    if code and cid is None:
        raise ValueError(f"Unknown course {code!r} — use a code like 'SE 2250B' or an id from harness_get_courses")
    return cid


def _rows_as_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


# ── handlers ────────────────────────────────────────────────────────────

def _assignment_state(d: dict) -> str:
    """Single intuitive state: closed (availability ended) wins, then
    submitted/graded, then overdue, else open."""
    if d.get("closed"):
        return "closed"
    if d.get("status") in ("submitted", "graded"):
        return d["status"]
    if d.get("due_at") and d["due_at"] < datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"):
        return "overdue"
    return "open"


def _rubric_text(rubrics: list) -> list[str]:
    """Compact human-readable rubric: criteria with their levels, points and
    per-level descriptions — small enough to survive the context window."""
    out = []
    for rb in rubrics:
        out.append(f"[{rb.get('Name')}]")
        for g in rb.get("CriteriaGroups") or []:
            gname = g.get("Name")
            if gname:
                out.append(f"  {gname}:")
            for crit in g.get("Criteria") or []:
                cells = crit.get("Cells") or []
                parts = []
                for li, lv in enumerate(g.get("Levels") or []):
                    pts = lv.get("Points")
                    cell = cells[li] if li < len(cells) else {}
                    txt = ((cell.get("Description") or {}).get("Text")
                           or (cell.get("Feedback") or {}).get("Text") or "").strip()
                    head = lv.get("Name") or ""
                    if pts is not None:
                        head += f" ({pts} pts)"
                    parts.append(f"{head}: {txt[:140]}" if txt else head)
                out.append(f"    - {crit.get('Name')} — " + " | ".join(parts))
    return out


def harness_list_assignments(db: DB, cfg: Config, args: dict) -> dict:
    # course is optional: omit it to aggregate across all courses
    course_id = _require_course(db, args.get("course"))
    q = """SELECT a.id, c.code, a.course_id, a.title, a.due_at, a.status, a.weight, a.notes,
                  a.description, a.url, a.category, a.group_category, a.points,
                  a.availability_json, a.rubrics_json, a.attachments_json
           FROM assignments a JOIN courses c ON c.id=a.course_id WHERE 1=1"""
    params = []
    if course_id:
        q += " AND a.course_id=?"; params.append(course_id)
    if args.get("status"):
        q += " AND a.status=?"; params.append(args["status"])
    if args.get("due_within_days"):
        # lower bound too: only assignments due from now until now+N days
        q += " AND a.due_at IS NOT NULL AND a.due_at >= datetime('now') AND a.due_at <= datetime('now', ?)"
        params.append(f"+{int(args['due_within_days'])} days")
    detail = bool(args.get("assignment_id"))
    if detail:
        q += " AND a.id=?"; params.append(int(args["assignment_id"]))
    q += " ORDER BY a.due_at"
    rows = db.conn.execute(q, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        av = json.loads(d.pop("availability_json") or "{}") or {}
        end = (av or {}).get("EndDate")
        d["closed"] = False
        if end:
            try:
                d["closed"] = datetime.datetime.fromisoformat(end.replace("Z", "+00:00")) < datetime.datetime.now(datetime.timezone.utc)
            except ValueError:
                pass
        d["state"] = _assignment_state(d)
        rubrics = json.loads(d.pop("rubrics_json") or "[]")
        d["rubrics"] = [rub.get("Name") for rub in rubrics]
        if detail:
            d["rubric_detail"] = _rubric_text(rubrics)
        d["attachments"] = [{"name": at.get("FileName"), "local": at.get("local")}
                            for at in json.loads(d.pop("attachments_json") or "[]")]
        if d.get("group_category"):
            g = db.conn.execute("SELECT group_name FROM course_groups WHERE course_id=? AND category_name=?",
                                (d["course_id"], d["group_category"])).fetchone()
            d["group_name"] = g["group_name"] if g else None
        out.append(d)
    return {"assignments": out}


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
    text = full.read_bytes()[:MAX_READ_BYTES].decode("utf-8", errors="replace")
    lines = text.splitlines()
    total = len(lines)
    offset = max(int(args.get("offset", 0)), 0)
    limit = min(int(args.get("limit", 200)), 1000)
    chunk = "\n".join(lines[offset:offset + limit])
    return {"path": str(path), "content": chunk,
            "offset": offset, "total_lines": total,
            "note": f"lines {offset}-{offset + len(lines[offset:offset + limit])} of {total}; use offset/limit to page further"}


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
    # id-first: duplicate titles exist (per-section dropboxes) so fuzzy title
    # matching can silently hit the wrong row. The id comes from
    # harness_list_assignments.
    if not args.get("id"):
        return {"error": "id is required — get it from harness_list_assignments (titles are not unique)"}
    course_id = _require_course(db, args.get("course"))
    q = "SELECT * FROM assignments WHERE id=?"
    params: list = [int(args["id"])]
    if course_id:
        q += " AND course_id=?"; params.append(course_id)
    row = db.conn.execute(q + " LIMIT 1", params).fetchone()
    if not row:
        return {"error": f"assignment id {args['id']} not found"}
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


def file_write(db: DB, cfg: Config, args: dict) -> dict:
    """Audited file write. path is relative to data_root; content/ is read-only.
    Notes convention: {TERM}/{CODE}/notes/YYYY-MM-DD-title.md; work files go in work/."""
    rel = Path(args.get("path", ""))
    root = Path(cfg.data_root).resolve()
    full = (root / rel).resolve()
    if root not in full.parents and full != root:
        return {"error": "path must be under data_root"}
    if any(part == "content" for part in rel.parts):
        return {"error": "content/ is read-only (sync owns it)"}
    before = full.read_bytes()[:64].hex() if full.exists() else None
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(args.get("content", ""))
    after = full.read_bytes()[:64].hex()
    db.audit("ai", "file", None, "write",
             {"path": str(rel), "head_sha_before": before, "head_sha_after": after})
    db.conn.commit()
    return {"written": str(rel), "bytes": full.stat().st_size,
            "note": "writes are audited (audit_log, actor=ai)"}


def _trawl_call(cfg: Config, tool: str, args: dict) -> dict:
    from .mcp import MCPClient
    client = MCPClient(cfg.trawl_url)
    try:
        client.connect()
        return client.call_tool(tool, args)
    except Exception as e:
        return {"error": f"trawl {tool} failed: {e}"}
    finally:
        client.close()


# ── terminal ────────────────────────────────────────────────────────────
# Runs inside the campus container (the jail): no docker socket, no host
# secrets, no /etc/nixos, no mounts outside the workspace. Blocklist +
# audit are accident-prevention and visibility, not a security boundary —
# the container IS the boundary.
import re as _re
import subprocess as _sp

TERMINAL_MAX_OUTPUT = 10_000  # chars returned to the model
TERMINAL_DEFAULT_TIMEOUT = 30
TERMINAL_MAX_TIMEOUT = 120

# denied commands / patterns (checked case-insensitively)
TERMINAL_BLOCKLIST = [
    r"\bsudo\b", r"\bsu\b", r"\bdocker\b", r"\bpodman\b", r"\bnixos-rebuild\b",
    r"\bsystemctl\b", r"\bjournalctl\b", r"\bshutdown\b", r"\breboot\b",
    r"\bmkfs\b", r"\bdd\b", r"\bchmod\b", r"\bchown\b", r"\bkill\b",
    r"rm\s+(-[a-z]*[rf][a-z]*\s+)+/",          # rm -rf /
    r"\.hippocampus",                          # token + browser profile — off limits
    r"config\.yaml",                           # credentials (repo config)
    r"python\s+-m\s+sync\s+auth",              # no Duo spawns from chat
]
# write-class commands that must not touch synced content/
TERMINAL_WRITE_OPS = r"\b(rm|mv|cp|touch|tee|truncate|sed|echo|redirect)\b"
TERMINAL_CONTENT_GUARD = r"(^|/)content(/|$)"


def _audit(db: DB, action: str, detail: dict) -> None:
    db.audit("ai", "terminal", None, action, detail)
    db.conn.commit()


def terminal_run(db: DB, cfg: Config, args: dict) -> dict:
    cmd = args.get("command", "").strip()
    if not cmd:
        return {"error": "empty command"}
    low = cmd.lower()
    for pat in TERMINAL_BLOCKLIST:
        if _re.search(pat, low):
            _audit(db, "blocked", {"command": cmd, "reason": f"blocklist: {pat}"})
            return {"error": f"blocked: command matches denied pattern {pat}"}
    # content/ write-guard: deny write-class commands whose args mention content/
    if _re.search(TERMINAL_WRITE_OPS, low) and _re.search(TERMINAL_CONTENT_GUARD, low):
        _audit(db, "blocked", {"command": cmd, "reason": "content/ is read-only"})
        return {"error": "blocked: content/ is read-only (sync owns it)"}

    root = Path(cfg.data_root).resolve()
    workdir = args.get("workdir") or str(root)
    wd = Path(workdir).resolve()
    if root not in wd.parents and wd != root:
        return {"error": "workdir must be under data_root"}
    if not wd.exists():
        return {"error": f"workdir does not exist: {workdir}"}

    timeout = min(int(args.get("timeout_s", TERMINAL_DEFAULT_TIMEOUT)), TERMINAL_MAX_TIMEOUT)
    try:
        p = _sp.run(cmd, shell=True, cwd=wd, capture_output=True, text=True, timeout=timeout)
        out = (p.stdout or "") + (("\n[stderr]\n" + p.stderr) if p.stderr else "")
        out = out[-TERMINAL_MAX_OUTPUT:]
        _audit(db, "run", {"command": cmd, "cwd": str(wd), "exit": p.returncode})
        return {"exit": p.returncode, "cwd": str(wd), "output": out}
    except _sp.TimeoutExpired:
        _audit(db, "timeout", {"command": cmd, "cwd": str(wd), "timeout_s": timeout})
        return {"error": f"timed out after {timeout}s"}
    except Exception as e:
        return {"error": f"terminal failed: {e}"}


def web_search(db: DB, cfg: Config, args: dict) -> dict:
    result = _trawl_call(cfg, "search", {"query": args.get("query", ""),
                                         "max_results": int(args.get("max_results", 5))})
    if "error" in result:
        return result
    # trawl returns results as text; try to parse JSON, else return raw
    import json as _json
    try:
        parsed = _json.loads(result["content"])
        return {"results": parsed.get("results", parsed)[:8]}
    except _json.JSONDecodeError:
        return {"content": result["content"][:4000]}


def web_read(db: DB, cfg: Config, args: dict) -> dict:
    result = _trawl_call(cfg, "read", {"url": args.get("url", ""),
                                       "mode": args.get("mode", "fit")})
    if "error" in result:
        return result
    return {"content": result["content"][:8000]}


def course_map(db: DB, cfg: Config, args: dict) -> dict:
    """Full course structure in ONE call: modules → topics → their files
    (kind + extraction status). Use this before reading/grepping so you
    know what exists and where the real content lives."""
    course_id = _resolve_course(db, args.get("course"))
    if course_id is None:
        row = db.conn.execute("SELECT id FROM courses ORDER BY id LIMIT 1").fetchone()
        if not row:
            raise ValueError("No courses synced yet")
        course_id = row["id"]
    course = db.conn.execute(
        "SELECT code, name, term FROM courses WHERE id=?", (course_id,)).fetchone()
    nodes = db.conn.execute(
        """SELECT id, parent_id, title, node_type, topic_type, description
           FROM content_nodes WHERE course_id=? ORDER BY sort_order, id""",
        (course_id,)).fetchall()
    files = db.conn.execute(
        """SELECT id, path, kind, processed, content_node_id
           FROM files WHERE course_id=?""", (course_id,)).fetchall()
    by_parent: dict = {}
    for n in nodes:
        by_parent.setdefault(n["parent_id"], []).append(n)

    def fmt_file(f) -> str:
        name = Path(f["path"]).name
        tag = "extracted" if f["processed"] else (f["kind"] or "file")
        return f"{name} [{tag}]"

    lines = [f"# {course['code']} — {course['name']} ({course['term']})"]
    for mod in by_parent.get(None, []):
        lines.append(f"\n## {mod['title']}")
        if mod["description"]:
            d = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", mod["description"])).strip()
            lines.append(f"  landing: {d[:200]}")
        for t in by_parent.get(mod["id"], []):
            fs = [f for f in files if f["content_node_id"] == t["id"]]
            if fs:
                extra = " (" + ", ".join(fmt_file(f) for f in fs) + ")"
            elif t["topic_type"] == "link":
                extra = " [external link]"
            else:
                extra = ""
            lines.append(f"- {t['title']}{extra}")
    return {"course": course["code"], "map": "\n".join(lines)}


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
        "List assignments. course is OPTIONAL — omit it to aggregate across all courses (e.g. 'what's due this week'). due_within_days = only assignments due from now until now+N days. Each row: id, code, title, due_at, state (open/closed/overdue/submitted/graded — use this, not status), points, category, group/group_name, description, rubric names, attachment paths. Pass assignment_id to get ONE assignment with rubric_detail (full criteria with levels + points).",
        harness_list_assignments,
        course={"type": "string"},
        status={"type": "string"},
        due_within_days={"type": "integer"},
        assignment_id={"type": "integer"},
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
        "Read a text/markdown file from the synced corpus. Path is relative to data_root (e.g. '2025W/SE2250B/content/Course Overview/SE2250 2025-2026 outline.md'). Use offset/limit to page through long files (default 200 lines, max 1000). Binary files (.pdf/.doc attachments) auto-fall-back to their extracted .md sibling when one exists; raw binaries return bytes (not useful). Extraction status: processed=1 means extraction was attempted, not that text exists — for a .pdf, prefer the .md sibling or course_map's extracted flag.",
        content_read_file,
        required=["path"],
        path={"type": "string"},
        offset={"type": "integer", "description": "line offset"},
        limit={"type": "integer", "description": "max lines to return"},
    ),
    "course_map": _tool(
        "course_map",
        "Full course structure in ONE call: modules → topics → their files (kind + extraction status). ALWAYS start with this to understand the course before reading or grepping content.",
        course_map,
        course={"type": "string", "description": "course code, e.g. 'SE 2250B'"},
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
        "Update an assignment's due_at (ISO datetime), status, or notes. Audited. id is REQUIRED (get it from harness_list_assignments) — titles are not unique. Use when the user reports a change (extension, completion...).",
        mutate_update_assignment,
        required=["id"],
        course={"type": "string"},
        id={"type": "integer"},
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
    "file_write": _tool(
        "file_write",
        "Write a text file into the workspace (notes/ or work/ per course — path relative to data_root, e.g. '2025W/SE2250B/notes/2026-08-01-project.md'). Audited. content/ is read-only.",
        file_write,
        required=["path", "content"],
        path={"type": "string"},
        content={"type": "string"},
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
    "terminal_run": _tool(
        "terminal_run",
        "Run a shell command ONLY for file/workspace operations the user explicitly requested (create, edit, move files, run a script in work/, git in work/). NEVER use this to read or search course content — use content_read_file / content_grep for that. cwd defaults to data_root; blocklist + audit enforced; content/ is read-only; 30s default, max 120s.",
        terminal_run,
        required=["command"],
        command={"type": "string"},
        workdir={"type": "string", "description": "must be under data_root"},
        timeout_s={"type": "integer", "description": "1-120, default 30"},
    ),
    "web_search": _tool(
        "web_search",
        "Web search (via trawl/SearXNG) for questions outside the synced course data. Returns results with title/url/snippet.",
        web_search,
        required=["query"],
        query={"type": "string"},
        max_results={"type": "integer", "description": "default 5"},
    ),
    "web_read": _tool(
        "web_read",
        "Fetch a URL and extract its content as markdown (via trawl/crawl4ai). Use after web_search to read a promising page.",
        web_read,
        required=["url"],
        url={"type": "string"},
        mode={"type": "string", "enum": ["fit", "raw"], "description": "default fit (readability)"},
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
