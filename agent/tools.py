"""Tool registry — schemas + handlers for the agent.

Families per DESIGN.md:
  harness_*   structured DB reads (dates, deadlines, facts)
  content_*   file access over the synced corpus (read, grep)
  mutate_*    audited actions (every write logs before/after to audit_log)
  <mcp>       tools discovered at runtime from the configured MCP server
              (cfg.mcp_url) — e.g. trawl's search/read. None when mcp_url empty.
"""
from __future__ import annotations

import datetime
import json
import re
import subprocess
import uuid
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
        raise ValueError(f"Unknown course {code!r} — use a code like 'CS 1100A' or an id from harness_get_courses")
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


def harness_sync_delta(db: DB, cfg: Config, args: dict) -> dict:
    """What changed on the last N syncs: run stats + the latest digest log."""
    limit = min(max(int(args.get("limit", 5)), 1), 20)
    rows = db.conn.execute(
        "SELECT id, started_at, finished_at, status, trigger, courses_processed, "
        "files_new, files_changed, announcements_new, facts_added, pdfs_extracted, error "
        "FROM sync_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    runs = _rows_as_dicts(rows)
    log = ""
    if runs:
        lp = db.conn.execute("SELECT log_path FROM sync_runs WHERE id=?", (runs[0]["id"],)).fetchone()
        if lp and lp["log_path"]:
            try:
                log = Path(lp["log_path"]).read_text(errors="replace")[-3000:]
            except OSError:
                pass
    return {"runs": runs, "latest_log": log}


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
    out = []
    for r in rows:
        d = dict(r)
        d["body"] = _strip_html(d.get("body"))
        out.append(d)
    return {"announcements": out}


def _strip_html(body: str | None) -> str:
    """Announcement bodies are stored as raw HTML — convert to readable text."""
    import html as html_mod
    s = body or ""
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</p>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_mod.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(ln.strip() for ln in s.splitlines() if ln.strip())


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
    # search_corpus returns refs like "overview/<node_id>" for module
    # landing pages — those live in the DB (content_nodes.description), not
    # on disk. Resolve them here so the model can read the full page after
    # a search hit ("I can't open overview/1892" was the original dead end).
    if str(path).startswith("overview/"):
        nid = int(str(path).split("/")[1])
        row = db.conn.execute(
            "SELECT course_id, title, description FROM content_nodes WHERE id=?",
            (nid,)).fetchone()
        if not row:
            return {"error": f"no content node {nid}"}
        import re as _re
        desc = _re.sub(r"<[^>]+>", " ", row["description"] or "")
        desc = _re.sub(r"\s+", " ", desc).strip()
        text = f"# {row['title']}\n\n{desc}"
        lines = text.splitlines()
        total = len(lines)
        offset = max(int(args.get("offset", 0)), 0)
        limit = min(int(args.get("limit", 200)), 1000)
        chunk = "\n".join(lines[offset:offset + limit])
        note = (f"lines {offset}-{min(offset + limit, total)} of {total} "
                f"(module description, HTML-stripped); use offset/limit to page")
        return {"path": f"overview/{nid}", "content": chunk,
                "offset": offset, "total_lines": total, "note": note}
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
    if offset >= total:
        note = f"offset {offset} is past the end — the file has {total} lines; read from offset 0"
    else:
        end = min(offset + len(lines[offset:offset + limit]), total)
        note = f"lines {offset}-{end} of {total}; use offset/limit to page further"
    return {"path": str(path), "content": chunk,
            "offset": offset, "total_lines": total,
            "note": note}


def content_grep(db: DB, cfg: Config, args: dict) -> dict:
    """Case-insensitive regex grep over DOWNLOADED FILES on disk (content/,
    Assignments/, notes/) AND module descriptions (content_nodes.description,
    returned as overview/<node_id> refs) for a course. Returns path +
    snippet matches."""
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
    # module descriptions live in the DB, not on disk — the model's go-to
    # tool for exact phrases must find them there too ("Email Response Time"
    # was lost because content_grep only scanned files)
    if course_id:
        import re as _re
        q = "SELECT id, title, description FROM content_nodes WHERE course_id=? AND description IS NOT NULL"
        for r in db.conn.execute(q, (course_id,)):
            d = r["description"] or ""
            stripped = _re.sub(r"<[^>]+>", " ", d)
            stripped = _re.sub(r"\s+", " ", stripped)
            i = stripped.lower().find(query.lower())
            if i < 0:
                continue
            start = max(0, i - 100)
            end = min(len(stripped), i + len(query) + 100)
            snip = stripped[start:end].strip()
            matches.append({
                "path": f"overview/{r['id']}",
                "snippet": f"{r['title']}: …{snip}…",
            })
    return {"matches": matches[:20],
            "note": "paths relative to data_root; overview/<id> refs are module "
                    "descriptions (read them with content_read_file). "
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


def add_fact(db: DB, cfg: Config, args: dict) -> dict:
    """Write a durable fact to memory RIGHT NOW (mid-conversation). The fact
    joins the memory card + the quiz pool immediately. Source 'chat:…'."""
    fact = (args.get("fact") or "").strip()
    if not fact:
        return {"error": "fact is required — one atomic claim"}
    if len(fact) > 500:
        return {"error": "fact too long — keep it under 500 chars (one atomic claim, absolute dates)"}
    allowed = {"general", "scheduling", "grading", "course-policy",
               "prof-note", "exam", "assignment", "logistics"}
    category = args.get("category") or "general"
    if category not in allowed:
        return {"error": f"category must be one of: {', '.join(sorted(allowed))}"}
    cid = _resolve_course(db, args.get("course"))
    try:
        confidence = max(0.0, min(1.0, float(args.get("confidence") or 0.5)))
    except (TypeError, ValueError):
        confidence = 0.5
    dup = db.conn.execute(
        "SELECT id FROM memory_facts WHERE fact=? AND is_active=1", (fact,)).fetchone()
    if dup:
        return {"added": False, "reason": "already known", "fact_id": dup["id"]}
    cur = db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (cid, fact, category, confidence, f"chat:{datetime.date.today().isoformat()}"))
    db.conn.commit()
    fid = cur.lastrowid
    db.audit("ai", "facts", fid, "add", {"fact": fact[:120], "category": category})
    # the memory card regenerates at sync time — trigger it now so the fact
    # shows up in the very next turn (deterministic, no model call)
    if cid:
        try:
            from agent.memory import regenerate_cards
            regenerate_cards(cfg, db, courses=[cid])
        except Exception:
            pass
    return {"added": True, "fact_id": fid}


def quiz_start(db: DB, cfg: Config, args: dict) -> dict:
    """Start a free-recall quiz over active memory facts. Blind-graded:
    every answer is graded against ONLY the fact — never the chat history
    or course material — so grades can't flatter. Returns the first
    question; the AI relays it, the user answers, then quiz_grade checks it
    and returns the next question."""
    db.conn.execute(
        """CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id TEXT NOT NULL,
            course_id INTEGER, fact_id INTEGER, question TEXT, answer_key TEXT,
            user_answer TEXT, grade TEXT, feedback TEXT, selection_json TEXT,
            created_at TEXT DEFAULT (datetime('now')), graded_at TEXT)""")
    cid = _resolve_course(db, args.get("course"))
    topic = args.get("topic")
    try:
        count = max(1, min(int(args.get("count") or 5), 10))
    except (TypeError, ValueError):
        count = 5
    q = "SELECT id, course_id, fact, category FROM memory_facts WHERE is_active=1"
    params: list = []
    if cid:
        q += " AND course_id=?"
        params.append(cid)
    if topic:
        q += " AND (category LIKE ? OR fact LIKE ?)"
        params += [f"%{topic}%", f"%{topic}%"]
    # skip facts quizzed in the last 7 days — the answers sit in the chat
    # history, so re-asking them would be trivial
    q += (" AND id NOT IN (SELECT fact_id FROM quiz_attempts"
          " WHERE graded_at IS NOT NULL AND created_at > datetime('now','-7 days'))")
    q += " ORDER BY RANDOM() LIMIT ?"
    params.append(count)
    facts = [dict(r) for r in db.conn.execute(q, params).fetchall()]
    if not facts:
        return {"error": "no quiz-able facts — the digest hasn't produced active facts yet (live term only), or everything recent was just quizzed"}
    # abandoned quizzes (started >30min ago, never graded) don't block the next
    db.conn.execute("DELETE FROM quiz_attempts WHERE graded_at IS NULL AND created_at < datetime('now','-30 minutes')")
    from agent.quiz import make_question
    quiz_id = uuid.uuid4().hex[:12]
    fact = facts[0]
    question = make_question(cfg, fact["fact"], fact["category"])
    db.conn.execute(
        "INSERT INTO quiz_attempts (quiz_id, course_id, fact_id, question, answer_key, selection_json) "
        "VALUES (?,?,?,?,?,?)",
        (quiz_id, fact["course_id"], fact["id"], question, fact["fact"],
         json.dumps([f["id"] for f in facts[1:]])))
    db.conn.commit()
    return {"quiz_id": quiz_id, "question": question, "position": 1, "total": len(facts)}


def quiz_grade(db: DB, cfg: Config, args: dict) -> dict:
    """Grade the latest unanswered quiz question (blind — the grader sees
    only the answer key + the user's words). Returns the grade, feedback,
    and the next question, or a summary when the quiz is done."""
    row = db.conn.execute(
        "SELECT * FROM quiz_attempts WHERE graded_at IS NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        return {"error": "no active quiz question — call quiz_start first"}
    answer = (args.get("answer") or "").strip()
    if not answer:
        return {"error": "answer is required"}
    from agent.quiz import blind_grade, make_question
    grade, feedback = blind_grade(cfg, row["answer_key"], answer)
    db.conn.execute(
        "UPDATE quiz_attempts SET user_answer=?, grade=?, feedback=?, graded_at=datetime('now') "
        "WHERE id=?",
        (answer, grade, feedback, row["id"]))
    remaining = json.loads(row["selection_json"] or "[]")
    if not remaining:
        graded = db.conn.execute(
            "SELECT grade FROM quiz_attempts WHERE quiz_id=?", (row["quiz_id"],)).fetchall()
        correct = sum(1 for g in graded if g["grade"] == "correct")
        db.conn.commit()
        return {"grade": grade, "feedback": feedback, "done": True,
                "summary": f"{correct}/{len(graded)} correct"}
    nxt = db.conn.execute(
        "SELECT id, course_id, fact, category FROM memory_facts WHERE id=?", (remaining[0],)).fetchone()
    question = make_question(cfg, nxt["fact"], nxt["category"])
    db.conn.execute(
        "INSERT INTO quiz_attempts (quiz_id, course_id, fact_id, question, answer_key, selection_json) "
        "VALUES (?,?,?,?,?,?)",
        (row["quiz_id"], nxt["course_id"], nxt["id"], question, nxt["fact"],
         json.dumps(remaining[1:])))
    db.conn.commit()
    return {"grade": grade, "feedback": feedback, "done": False,
            "next_question": question}


def search_corpus(db: DB, cfg: Config, args: dict) -> dict:
    """Semantic search over the course corpus: extracted content, notes, work
    files, assignment attachments, announcements, syllabus, active facts AND
    MODULE DESCRIPTIONS (landing-page HTML — incl. office-hours tables and
    policies that never became files). Cohere embeddings + rerank via
    the configured LLM endpoint, with a lexical exact-phrase boost. Returns cited passages with
    file refs — read the full file with content_read_file. Prefer this over
    content_grep for module-landing text: content_grep only scans files on
    disk."""
    from sync.search import search as corpus_search
    query = args.get("query", "")
    if not query:
        return {"error": "query is required"}
    try:
        cid = _resolve_course(db, args.get("course"))
        hits = corpus_search(cfg, db, query, cid, top_k=args.get("top_k") or 5)
    except Exception as e:
        return {"error": f"search failed: {e}"}
    if not hits:
        return {"hits": [], "note": "no matches — try different wording or a broader query"}
    return {"hits": hits, "note": "read the matching file with content_read_file for full context"}


def file_edit(db: DB, cfg: Config, args: dict) -> dict:
    """Scoped edit: replace ONE unique snippet in a file. old_text must match
    exactly once — zero or multiple matches error out (retry with more
    surrounding context). Everything outside the matched region is untouched,
    so long documents can't drift. Audited with old/new excerpts."""
    rel = Path(args.get("path", ""))
    old = args.get("old_text", "")
    new = args.get("new_text", "")
    if not old:
        return {"error": "old_text is required — the exact text to replace"}
    root = Path(cfg.data_root).resolve()
    full = (root / rel).resolve()
    if root not in full.parents and full != root:
        return {"error": "path must be under data_root"}
    if any(part == "content" for part in rel.parts):
        return {"error": "content/ is read-only (sync owns it)"}
    if not full.exists():
        return {"error": f"file missing: {rel}"}
    text = full.read_text(encoding="utf-8", errors="replace")
    n = text.count(old)
    if n == 0:
        return {"error": "old_text not found — include more surrounding context (quote the exact lines)"}
    if n > 1:
        return {"error": f"old_text matches {n} times — include more surrounding context to make it unique"}
    before = hashlib.sha256(full.read_bytes()).hexdigest()
    full.write_text(text.replace(old, new, 1), encoding="utf-8")
    after = hashlib.sha256(full.read_bytes()).hexdigest()
    db.audit("ai", "files", None, "edit", {
        "path": str(rel), "before_sha": before, "after_sha": after,
        "old_excerpt": old[:200], "new_excerpt": new[:200]})
    return {"edited": True, "path": str(rel), "matches": 1}


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
    r"\.campus",                              # token dir (any variant) — off limits
    r"\.hippocampus",                         # legacy token dir name — off limits
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
    "harness_sync_delta": _tool(
        "harness_sync_delta",
        "What changed on recent syncs: run stats (files new/changed, announcements, facts) and the latest digest log. Use to answer 'what changed since the last sync' without re-reading content.",
        harness_sync_delta,
        limit={"type": "integer", "description": "how many recent runs (default 5)"},
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
        "Read a text/markdown file from the synced corpus. Path is relative to data_root (e.g. '2026F/CS1100A/content/Course Overview/CS1100 2026 outline.md'). Use offset/limit to page through long files (default 200 lines, max 1000). Binary files (.pdf/.doc attachments) auto-fall-back to their extracted .md sibling when one exists; raw binaries return bytes (not useful). Extraction status: processed=1 means extraction was attempted, not that text exists — for a .pdf, prefer the .md sibling or course_map's extracted flag.",
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
        course={"type": "string", "description": "course code, e.g. 'CS 1100A'"},
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
    "add_fact": _tool(
        "add_fact",
        "Write a durable fact to memory RIGHT NOW — use this mid-conversation when the user states a fact, corrects you, makes a decision, or relays something worth remembering (e.g. 'the final is cumulative', 'our team meets Thursdays', a prof's policy). The fact immediately joins the memory card + the quiz pool. One atomic claim per call, absolute dates (YYYY-MM-DD). Also useful when the user says 'remember this'.",
        add_fact,
        required=["fact", "category"],
        fact={"type": "string", "description": "the durable fact — one atomic claim, absolute dates"},
        category={"type": "string", "description": "one of: general, scheduling, grading, course-policy, prof-note, exam, assignment, logistics"},
        course={"type": "string", "description": "optional course code, e.g. 'CS 1100A'"},
        confidence={"type": "number", "description": "0-1 how sure you are (default 0.5)"},
    ),
    "quiz_start": _tool(
        "quiz_start",
        "Start a free-recall quiz over the course's active memory facts (blind-graded). After it returns the first question, ask the user; when they answer, call quiz_grade with their answer — never answer quiz questions for the user or show the answer key. Keep relaying each returned next_question and calling quiz_grade until done, then report the summary naturally.",
        quiz_start,
        course={"type": "string", "description": "optional course code, e.g. 'CS 1100A'"},
        topic={"type": "string", "description": "optional topic/category filter, e.g. 'project' or 'assignment'"},
        count={"type": "number", "description": "how many questions (default 5, max 10)"},
    ),
    "quiz_grade": _tool(
        "quiz_grade",
        "Grade the latest quiz question: blind-graded against the answer key only. Pass the user's exact answer. Returns the grade (correct/partial/wrong), feedback, and the next question, or a summary when the quiz is done.",
        quiz_grade,
        required=["answer"],
        answer={"type": "string", "description": "the user's answer to the current quiz question"},
    ),
    "search_corpus": _tool(
        "search_corpus",
        "Search over the course corpus (extracted lecture content, notes, work files, assignment attachments, announcements, syllabus, active facts). Lexical (substring + term-overlap) by default — no embeddings model needed; if embed_model/rerank_model are configured it ranks semantically and understands paraphrase. Returns top cited passages with file refs; follow up with content_read_file on the best ref for full context. Use when a question references specific material ('which lecture covered X', 'where does it say Y') that you can't locate by browsing.",
        search_corpus,
        required=["query"],
        query={"type": "string", "description": "the question or topic to find in the course material"},
        course={"type": "string", "description": "optional course code, e.g. 'CS 1100A'"},
        top_k={"type": "number", "description": "how many passages to return (default 5)"},
    ),
    "file_edit": _tool(
        "file_edit",
        "SCOPED edit of a file: replace ONE unique snippet (old_text must appear exactly once — include surrounding context to make it unique). Everything outside the snippet is untouched, so long docs can't drift. Prefer this over file_write for edits; use file_write to create or fully rewrite a file. Audited.",
        file_edit,
        required=["path", "old_text", "new_text"],
        path={"type": "string", "description": "path relative to data_root, e.g. '2026F/CS1100A/notes/2026-09-04-study.md'"},
        old_text={"type": "string", "description": "the exact existing text to replace (quote it verbatim, include neighbors if needed)"},
        new_text={"type": "string", "description": "the replacement text"},
    ),
    "file_write": _tool(
        "file_write",
        "Write a text file into the workspace (notes/ or work/ per course — path relative to data_root, e.g. '2026F/CS1100A/notes/2026-09-01-project.md'). Audited. content/ is read-only.",
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
}


def _mcp_handler(name: str):
    """Closure: dispatch a discovered MCP tool by name using the live cfg
    (``mcp_url`` is read at call time, never cached at discovery)."""
    def handler(db: DB, cfg: Config, args: dict) -> dict:
        if not cfg.mcp_url:
            return {"error": f"MCP tool '{name}' unavailable: mcp_url not configured"}
        from .mcp import MCPClient
        client = MCPClient(cfg.mcp_url)
        try:
            client.connect()
            return client.call_tool(name, args)
        except Exception as e:
            return {"error": f"mcp {name} failed: {e}"}
        finally:
            client.close()
    return handler


def _mcp_tool_entry(t: dict) -> tuple[str, dict]:
    """Build a TOOLS entry from one tools/list tool dict. Returns
    (resolved_name, entry). A name clashing with a built-in is prefixed
    ``mcp_`` to avoid shadowing it."""
    raw = t.get("name") or ""
    if not raw:
        raise ValueError("MCP tool missing 'name'")
    name = raw
    if name in TOOLS or name in BUILTIN_TOOL_NAMES:
        name = f"mcp_{raw}"
    schema = t.get("inputSchema") or t.get("schema") or {"type": "object", "properties": {}}
    props = dict(schema.get("properties") or {})
    required = [r for r in (schema.get("required") or []) if r in props]
    description = (t.get("description") or f"MCP tool '{raw}'").strip()
    return name, _tool(name, description, _mcp_handler(name),
                       required=required or None, **props)


def load_mcp_tools(cfg: Config) -> dict[str, dict]:
    """Discover tools exposed by a configured MCP server and wrap each as a
    tool entry for the agent.

    Returns ``{}`` when ``mcp_url`` is empty (no external tools, zero network
    calls). Any discovery failure is logged and swallowed — a dead/unreachable
    MCP server must never break the agent; the built-in tools still work.
    """
    if not cfg.mcp_url:
        return {}
    from .mcp import MCPClient
    client = MCPClient(cfg.mcp_url)
    try:
        client.connect()
        remote = client.list_tools()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "MCP tool discovery failed for %r: %s", cfg.mcp_url, e)
        return {}
    finally:
        client.close()
    out: dict[str, dict] = {}
    for t in remote:
        try:
            n, entry = _mcp_tool_entry(t)
            out[n] = entry
        except Exception as e:  # skip a malformed tool def rather than crash
            import logging
            logging.getLogger(__name__).warning("skipping MCP tool %r: %s", t.get("name"), e)
    return out


# Names of built-in tools — used to de-conflict with discovered MCP tool
# names so an MCP server can't shadow a harness tool.
BUILTIN_TOOL_NAMES = set(TOOLS.keys())


# ── dynamic MCP tools ──────────────────────────────────────────────────────
# Discovered at startup from cfg.mcp_url. With no mcp_url configured this
# contributes nothing and makes no network calls — the built-in harness tools
# above are the entire surface. Discovery failures are swallowed so a dead MCP
# server never breaks the agent.
try:
    TOOLS.update(load_mcp_tools(Config.load()))
except Exception:
    import logging
    logging.getLogger(__name__).warning("MCP startup discovery failed", exc_info=True)

TOOL_SCHEMAS = [t["schema"] for t in TOOLS.values()]


def execute_tool(name: str, args: dict, db: DB, cfg: Config) -> dict:
    entry = TOOLS.get(name)
    if not entry:
        return {"error": f"unknown tool: {name}"}
    try:
        return entry["handler"](db, cfg, args or {})
    except Exception as e:
        return {"error": f"{name} failed: {e}"}
