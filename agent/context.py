"""Context construction — the system prompt built from live state.

The model has no clock and no awareness of what's in the harness, so every
conversation starts with a fresh snapshot: current time (America/Toronto),
active term, course scope, upcoming events, and the course memory card.
This is what makes answers grounded instead of guessed.
"""
from __future__ import annotations

import datetime
from pathlib import Path

from sync.config import Config
from sync.db import DB

TZ_NAME = "America/Toronto"


def _now() -> datetime.datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo(TZ_NAME))
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
    """Compute upcoming class meetings from course_sessions, using term start
    dates from config (term_dates: {2026F: '2026-09-01'}). No term dates set
    = no class events (nothing to anchor weekdays to)."""
    term_dates: dict = getattr(cfg, "term_dates", {}) or {}
    if not term_dates:
        return []
    now = _now()
    horizon = now + datetime.timedelta(days=days)
    q = """SELECT cs.*, c.code, c.term, c.id AS course_id
           FROM course_sessions cs JOIN courses c ON c.id = cs.course_id
           WHERE (? IS NULL OR cs.course_id = ?)"""
    rows = db.conn.execute(q, (course_id, course_id)).fetchall()
    events = []
    for r in rows:
        start = term_dates.get(r["term"])
        if not start:
            continue
        try:
            term_start = datetime.date.fromisoformat(str(start))
        except ValueError:
            continue
        wd = r["day_of_week"]  # 0=Mon..6=Sun; Python weekday(): Mon=0..Sun=6
        day = term_start + datetime.timedelta(days=(wd - term_start.weekday()) % 7)
        while day <= horizon.date():
            if now.date() <= day:
                dt = datetime.datetime.combine(day, datetime.time.fromisoformat(r["start_time"]))
                events.append({
                    "when": dt.strftime("%a %b %d, %Y %H:%M"),
                    "kind": "class", "code": r["code"],
                    "title": f"{r['kind']} {r.get('section') or ''}".strip(),
                    "room": r["room"] or "",
                })
            day += datetime.timedelta(days=7)
    return sorted(events, key=lambda e: e["when"])


def upcoming_events(cfg: Config, db: DB, course_id: int | None, days: int = 7) -> list[dict]:
    """Next N days: classes (computed) + assignments + exams + hand-created events."""
    now = _now().isoformat()
    later = (_now() + datetime.timedelta(days=days)).isoformat()
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
    events = [dict(r) | {"when": _fmt(r["due_at"] or r["starts_at"])} for r in rows]
    events.extend(class_events(cfg, db, course_id, days))
    events.sort(key=lambda e: e["when"])
    return events


def build_system_prompt(cfg: Config, db: DB, course_id: int | None = None) -> str:
    now = _now()
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

    return f"""You are HippoCampus, a personal course assistant for your university.
You work over synced Brightspace data (SQLite + files on disk). You do NOT
have live Brightspace access — everything you know comes from the harness.

CURRENT TIME: {now.strftime('%A %Y-%m-%d %H:%M %Z')} (America/Toronto)
ACTIVE TERMS: {term_str}

{scope}{card_text}UPCOMING (next 7 days):
{events_str}

RULES:
1. Answer only from harness data. Never invent dates, deadlines, or facts.
2. Cite sources when relevant: announcement post dates, file paths, sync dates.
3. For anything about dates/deadlines/status, query the harness tools first —
   do not guess from memory.
4. To change something (extend a due date, write a note, add a fact/event),
   use the mutate_* / file_write tools. All mutations are audited automatically.
5. If you don't know or the data is missing, say so plainly.
6. web_search / web_read are for outside-the-harness questions only; prefer
   harness data for course questions.
7. Keep answers concise and direct. No fluff, no "Lesson:"-style closers.
8. Read efficiently: prefer ONE large content_read_file call (offset/limit,
   up to 1000 lines) over repeated greps or paginated re-reads. Never
   re-read a file or re-grep content you already have in context.
"""
