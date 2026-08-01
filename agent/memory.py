"""Memory card — per-course bounded digest of what matters most.

Regenerated (never hand-edited) from structured rows + facts. Conflict rule:
structured rows (assignments, exams) BEAT memory_facts — the DEADLINES
section is built from structured data only; facts fill POLICIES/PROF NOTES.
Regen triggers: sync with non-empty deltas, facts changed, lecture digest.
Atomic write; previous version kept as memory-card.md.prev.
"""
from __future__ import annotations

import datetime
from pathlib import Path

from sync.config import Config
from sync.db import DB

MAX_BULLETS = 24


def _fmt(dt: str | None) -> str:
    if not dt:
        return "unknown"
    try:
        return datetime.datetime.fromisoformat(dt.replace("Z", "+00:00")).strftime("%b %d %Y %H:%M")
    except Exception:
        return dt


def _course_dir(cfg: Config, course) -> Path:
    return Path(cfg.data_root) / course["term"] / course["code"].replace(" ", "")


def build_card(cfg: Config, db: DB, course_id: int) -> str:
    course = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if not course:
        return ""
    bullets: list[str] = []

    # DEADLINES — structured rows only (they beat facts by design)
    deadlines = db.conn.execute(
        """SELECT title, due_at, status FROM assignments
           WHERE course_id=? AND due_at IS NOT NULL AND status IN ('open','in_progress','extended')
           ORDER BY due_at LIMIT 8""", (course_id,)).fetchall()
    exams = db.conn.execute(
        "SELECT title, starts_at FROM exams WHERE course_id=? ORDER BY starts_at LIMIT 4",
        (course_id,)).fetchall()
    for r in deadlines:
        bullets.append(f"- DUE {_fmt(r['due_at'])} ({r['status']}): {r['title']}")
    for r in exams:
        bullets.append(f"- EXAM {_fmt(r['starts_at'])}: {r['title']}")

    # POLICIES / PROF NOTES — from facts (non-date categories; date claims
    # come from structured rows, so scheduling/exam/assignment facts are skipped)
    facts = db.conn.execute(
        """SELECT fact, category FROM memory_facts
           WHERE course_id=? AND is_active=1 AND category IN
                 ('course-policy','prof-note','logistics','grading','general')
           ORDER BY id DESC LIMIT 12""", (course_id,)).fetchall()
    for f in facts:
        bullets.append(f"- [{f['category']}] {f['fact'][:140]}")

    # OPEN THREADS — most recent note files
    notes_dir = _course_dir(cfg, course) / "notes"
    if notes_dir.exists():
        recent = sorted(notes_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)[:3]
        for p in recent:
            bullets.append(f"- note: {p.stem}")

    # STATE
    last_sync = db.conn.execute(
        "SELECT started_at, status FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    files_n = db.conn.execute(
        "SELECT COUNT(*) n FROM files WHERE course_id=?", (course_id,)).fetchone()["n"]
    extracted_n = db.conn.execute(
        "SELECT COUNT(*) n FROM files WHERE course_id=? AND processed=1", (course_id,)).fetchone()["n"]
    state = f"- state: {files_n} files ({extracted_n} extracted)"
    if last_sync:
        state += f"; last sync {_fmt(last_sync['started_at'])} ({last_sync['status']})"
    bullets.append(state)

    return f"""# {course['code']} — memory card
_Regenerated {datetime.date.today().isoformat()}; structured rows beat facts._

{chr(10).join(bullets[:MAX_BULLETS])}
"""


def write_card(cfg: Config, db: DB, course_id: int) -> Path | None:
    course = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if not course:
        return None
    d = _course_dir(cfg, course)
    d.mkdir(parents=True, exist_ok=True)
    target = d / "memory-card.md"
    content = build_card(cfg, db, course_id)
    if target.exists():
        (d / "memory-card.md.prev").write_text(target.read_text())
    tmp = d / "memory-card.md.tmp"
    tmp.write_text(content)
    tmp.rename(target)
    db.audit("system", "file", None, "regenerate", {"path": str(target)})
    db.conn.commit()
    return target


def regenerate_cards(cfg: Config, db: DB, courses: list[int] | None = None) -> int:
    if courses is None:
        rows = db.conn.execute("SELECT id FROM courses WHERE is_active=1").fetchall()
        courses = [r["id"] for r in rows]
    n = 0
    for cid in courses:
        p = write_card(cfg, db, cid)
        if p:
            n += 1
            print(f"  card: {p}")
    return n
