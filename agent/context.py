"""Context construction — the system prompt built from live state.

The model has no clock and no awareness of what's in the harness, so every
conversation starts with a fresh snapshot: current time (configured timezone),
active term, course scope, upcoming events, and the course memory card.
This is what makes answers grounded instead of guessed.
"""
from __future__ import annotations

import datetime
from pathlib import Path

from sync.config import Config
from sync.db import DB

def _tz(cfg: Config | None = None) -> str:
    """System local time when unset; empty default avoids leaking a
    deployer-specific timezone into a fresh checkout."""
    tz = getattr(cfg, "timezone", None)
    if tz:
        return tz
    try:
        from time import localtime, tzname
        return tzname[localtime().tm_isdst] or "local"
    except Exception:
        return "local"


def _now(cfg: Config | None = None) -> datetime.datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo(_tz(cfg)))
    except Exception:
        return datetime.datetime.now().astimezone()


def _fmt(dt: str | None) -> str:
    if not dt:
        return "unknown"
    try:
        return datetime.datetime.fromisoformat(dt.replace("Z", "+00:00")).strftime("%a %b %d, %Y %H:%M")
    except Exception:
        return dt


def class_events(cfg: Config, db: DB, course_id: int | None, days: int) -> list[dict]:
    """Compute upcoming class meetings from course_sessions, anchored to term
    start dates from config. term_dates: {"2026F": {"start": "2026-09-01",
    "end": "2026-12-31"}} (a bare "YYYY-MM-DD" string also works). No term
    dates set = no class events (nothing to anchor weekdays to)."""
    term_dates: dict = getattr(cfg, "term_dates", {}) or {}
    if not term_dates:
        return []
    now = _now(cfg)
    horizon = now + datetime.timedelta(days=days)
    q = """SELECT cs.*, c.code, c.term, c.id AS course_id
           FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
           WHERE (? IS NULL OR cs.course_id = ?)"""
    rows = db.conn.execute(q, (course_id, course_id)).fetchall()
    events = []
    for r in rows:
        td = term_dates.get(r["term"])
        if not td:
            continue
        if isinstance(td, dict):
            start, end = td.get("start"), td.get("end")
        else:
            start, end = td, None
        if not start:
            continue
        try:
            term_start = datetime.date.fromisoformat(str(start))
            term_end = datetime.date.fromisoformat(str(end)) if end else None
        except ValueError:
            continue
        wd = r["day_of_week"]  # 0=Mon..6=Sun; Python weekday(): Mon=0..Sun=6
        day = term_start + datetime.timedelta(days=(wd - term_start.weekday()) % 7)
        while day <= horizon.date():
            if term_end and day > term_end:
                break
            if now.date() <= day:
                dt = datetime.datetime.combine(day, datetime.time.fromisoformat(r["start_time"]))
                events.append({
                    "when": dt.strftime("%a %b %d, %Y %H:%M"),
                    "ts": dt.isoformat(),
                    "kind": "class", "code": r["code"],
                    "title": f"{r['kind']} {r['section'] or ''}".strip(),
                    "room": r["room"] or "",
                })
            day += datetime.timedelta(days=7)
    return sorted(events, key=lambda e: e["ts"])


def upcoming_events(cfg: Config, db: DB, course_id: int | None, days: int = 7) -> list[dict]:
    """Next N days: classes (computed) + assignments + exams + hand-created events."""
    now = _now(cfg).isoformat()
    later = (_now(cfg) + datetime.timedelta(days=days)).isoformat()
    rows = db.conn.execute(
        """SELECT a.id, c.code, a.title, a.due_at, a.status, a.weight,
                  'assignment' AS kind, NULL AS room
           FROM assignments a JOIN courses c ON c.id = a.course_id
           WHERE a.due_at IS NOT NULL AND a.due_at BETWEEN ? AND ?
             AND (? IS NULL OR a.course_id = ?)
           UNION ALL
           SELECT e.id, c.code, e.title, e.starts_at, NULL, e.weight, 'exam' AS kind, NULL AS room
           FROM exams e JOIN courses c ON c.id = e.course_id
           WHERE e.starts_at IS NOT NULL AND e.starts_at BETWEEN ? AND ?
             AND (? IS NULL OR e.course_id = ?)
           UNION ALL
           SELECT ev.id, c.code, ev.title, ev.starts_at, NULL, NULL, ev.kind, NULL AS room
           FROM events ev LEFT JOIN courses c ON c.id = ev.course_id
           WHERE ev.starts_at BETWEEN ? AND ?
             AND (? IS NULL OR ev.course_id = ?)
           ORDER BY 4""",
        (now, later, course_id, course_id, now, later, course_id, course_id,
         now, later, course_id, course_id),
    )
    events = [dict(r) | {"when": _fmt(r["due_at"] or r["starts_at"]),
                         "ts": r["due_at"] or r["starts_at"]} for r in rows]
    events.extend(class_events(cfg, db, course_id, days))
    events.sort(key=lambda e: e["ts"])
    return events


def build_system_prompt(cfg: Config, db: DB, course_id: int | None = None) -> str:
    now = _now(cfg)
    terms = db.conn.execute("SELECT DISTINCT term FROM courses ORDER BY term").fetchall()
    term_str = ", ".join(r["term"] for r in terms) or "none"

    scope = ""
    card_text = ""
    if course_id:
        c = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
        if c:
            open_asgn = db.conn.execute(
                "SELECT COUNT(*) n FROM assignments WHERE course_id=? AND status IN ('open','in_progress')",
                (course_id,)).fetchone()["n"]
            ann = db.conn.execute(
                "SELECT COUNT(*) n FROM announcements WHERE course_id=? AND posted_at >= datetime('now','-14 days')",
                (course_id,)).fetchone()["n"]
            scope = f"""
COURSE SCOPE: {c['code']} — {c['name']} ({c['term']})
Instructor: {c['instructor'] or 'unknown'}
Open assignments: {open_asgn} · announcements (14d): {ann}
"""
            card_path = Path(cfg.data_root) / c["term"] / c["code"].replace(" ", "") / "memory-card.md"
            if card_path.exists():
                card_text = f"\nCOURSE MEMORY CARD ({c['code']}):\n{card_path.read_text()[:3000]}\n"

    events = upcoming_events(cfg, db, course_id)
    events_str = "\n".join(
        f"  {e['when']} — {e['kind']} {e['code']}: {e['title']}" +
        (f" ({e['room']})" if e.get("room") else "")
        for e in events
    ) or "  (none in the next 7 days)"

    institution = getattr(cfg, "institution", "") or "your university"
    # ORDER MATTERS for prefix caching (DeepSeek/OpenAI-style): stable content
    # (identity, rules, scope, memory card) leads; the only tokens that change
    # per turn (clock, upcoming events) go last. The cache breaks at the first
    # divergent token, so dynamic content must never precede static content.
    return f"""You are Campus, a personal course assistant for {institution}.
You work over synced LMS data (SQLite + files on disk). You do NOT
have live LMS access — everything you know comes from the harness.

RULES:
1. Answer only from harness data. Never invent dates, deadlines, or facts.
2. Cite harness sources with [cite:N] (cite_id from tool "sources"). Never invent
   cite_ids, paths, or pages. When you use [cite:N], state the fact only — the
   citation chip is the source attribution. Do NOT explain where it came from in
   prose: no filenames, page numbers, "according to…", "found in…", or "on page…"
   alongside the chip. Wrong: "It's in Solutions.md on page 2 [cite:1]."
   Right: "You need 48 hours notice [cite:1]."
3. For anything about dates/deadlines/status, query the harness tools first —
   do not guess from memory.
4. To change something (extend a due date, write a note, add a fact/event),
   use the mutate_* / file_write tools. All mutations are audited automatically.
5. If you don't know or the data is missing, say so plainly.
6. web search / read tools (e.g. trawl's search/read, discovered from the
   configured MCP server) are for outside-the-harness questions only; prefer
   harness data for course questions.
7. Keep answers concise and direct. No fluff, no "Lesson:"-style closers.
8. Read efficiently: prefer ONE large content_read_file call (offset/limit,
   up to 1000 lines) over repeated greps or paginated re-reads. Never
   re-read a file or re-grep content you already have in context.
9. Start with course_map to see the whole course structure (modules, topics,
   files, extraction status) before reading or grepping — it tells you where
   the real content is and avoids blind reads.
10. terminal_run is ONLY for file/workspace operations the user explicitly
   asked for (create/edit/move files, run scripts). NEVER use it to read or
   search course content — use content_read_file / content_grep. After
   course_map you know the file layout; do not call content_list_files again.
11. Be decisive on open-ended questions ("explain a concept", "summarize"):
   course_map + at most 2-3 targeted reads, then answer. Do NOT exhaustively
   survey the corpus — 5+ tool calls per question is too many.

ACTIVE TERMS: {term_str}

{scope}{card_text}
CURRENT TIME: {now.strftime('%A %Y-%m-%d %H:%M %Z')} ({_tz(cfg)})
UPCOMING (next 7 days):
{events_str}
"""
