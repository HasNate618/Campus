"""Memory card — per-course digest of what matters most.

Regenerated (never hand-edited) from structured rows + facts. Conflict rule:
structured rows (assignments, exams) BEAT memory_facts — the DEADLINES
section is built from structured data only; facts fill POLICIES/PROF NOTES.
Regen triggers: sync with non-empty deltas, facts changed, lecture digest.
Atomic write; previous version kept as memory-card.md.prev.

Content is LOSSY ONLY IN A LABELED WAY. Facts render at full length, grouped by
category, with no per-item character clip and no silent bullet ceiling: this one
artifact is read BOTH by the model (agent/context.py) and by the user (the
memory-card.md file), so a shortened bullet is silent data loss in two places at
once. The single bound is MAX_CARD_TOKENS, and when it bites the footer names
exactly which sections were dropped and how many items that was.
"""
from __future__ import annotations

import datetime
from pathlib import Path

from sync.config import Config
from sync.db import DB

# Safety bound only — the card measures ~800 tokens in practice, so this is not
# reached by normal use. It exists so pathological fact growth can never push an
# unbounded prompt into a model call.
MAX_CARD_TOKENS = 6000

# Timeless categories survive forever; time-sensitive ones expire.
TIMELESS = {"grading", "course-policy", "general"}
TIME_SENSITIVE = {"scheduling", "exam", "assignment", "logistics", "prof-note"}
FACT_TTL_DAYS = 30  # time-sensitive facts older than this are superseded

# Render order IS priority order: grading keeps the most room, assignment the
# least. If MAX_CARD_TOKENS is ever reached, the tail sections are the ones
# dropped — and the footer names them, so the loss is never invisible.
CAT_ORDER = ["grading", "exam", "scheduling", "course-policy", "prof-note",
             "general", "logistics", "assignment"]
CAT_HEADING = {
    "grading": "Grading",
    "exam": "Exams",
    "scheduling": "Scheduling",
    "course-policy": "Course policy",
    "prof-note": "Instructor notes",
    "general": "General",
    "logistics": "Logistics",
    "assignment": "Assignments",
}

# Sections pinned ahead of the budget: they are structured rows (or one-line
# state), always short, and always worth their cost.
PINNED_HEADINGS = {"State", "Deadlines"}


def term_window(term: str) -> tuple[datetime.date, datetime.date] | None:
    """Term convention: 2026F = Sep-Dec, 2027W = Jan-Apr (year+1)."""
    m = __import__("re").match(r"(\d{4})([FW])", term or "")
    if not m:
        return None
    year, sess = int(m.group(1)), m.group(2)
    if sess == "F":
        return (datetime.date(year, 9, 1), datetime.date(year, 12, 31))
    return (datetime.date(year + 1, 1, 1), datetime.date(year + 1, 4, 30))


def term_is_past(term: str, today: datetime.date | None = None) -> bool:
    win = term_window(term)
    if not win:
        return False
    today = today or datetime.date.today()
    return win[1] < today


def _fmt(dt: str | None) -> str:
    if not dt:
        return "unknown"
    try:
        return datetime.datetime.fromisoformat(dt.replace("Z", "+00:00")).strftime("%b %d %Y %H:%M")
    except Exception:
        return dt


def _course_dir(cfg: Config, course) -> Path:
    return Path(cfg.data_root) / course["term"] / course["code"].replace(" ", "")


def _est_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token) — sufficient for a safety bound."""
    return (len(text) + 3) // 4


def build_card(cfg: Config, db: DB, course_id: int,
               max_tokens: int = MAX_CARD_TOKENS) -> str:
    """Render the card. Facts are never clipped; over-budget sections are
    dropped from the tail and reported in a visible footer."""
    course = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if not course:
        return ""

    # sections: (heading, [bullets]) in priority order
    sections: list[tuple[str, list[str]]] = []

    # STATE — one line, pinned. Built from the most recent COMPLETED sync
    # (never a stale 'running' row).
    last_sync = db.conn.execute(
        "SELECT started_at, status FROM sync_runs "
        "WHERE status IN ('ok','partial') ORDER BY id DESC LIMIT 1").fetchone()
    files_n = db.conn.execute(
        "SELECT COUNT(*) n FROM files WHERE course_id=?", (course_id,)).fetchone()["n"]
    extracted_n = db.conn.execute(
        "SELECT COUNT(*) n FROM files WHERE course_id=? AND processed=1",
        (course_id,)).fetchone()["n"]
    state = f"- {files_n} files ({extracted_n} extracted)"
    if last_sync:
        state += f"; last sync {_fmt(last_sync['started_at'])} ({last_sync['status']})"
    sections.append(("State", [state]))

    # DEADLINES — structured rows only (they beat facts by design); pinned.
    # Only still-upcoming deadlines belong on the card.
    deadlines = db.conn.execute(
        """SELECT title, due_at, status FROM assignments
           WHERE course_id=? AND due_at IS NOT NULL AND due_at >= datetime('now')
             AND status IN ('open','in_progress','extended')
           ORDER BY due_at LIMIT 8""", (course_id,)).fetchall()
    exams = db.conn.execute(
        "SELECT title, starts_at FROM exams WHERE course_id=? AND starts_at >= datetime('now') "
        "ORDER BY starts_at LIMIT 4", (course_id,)).fetchall()
    deadline_bullets = [f"- DUE {_fmt(r['due_at'])} ({r['status']}): {r['title']}"
                        for r in deadlines]
    deadline_bullets += [f"- EXAM {_fmt(r['starts_at'])}: {r['title']}" for r in exams]
    if deadline_bullets:
        sections.append(("Deadlines", deadline_bullets))

    # POLICIES / PROF NOTES — from facts. Three gates: the fact must belong to
    # a current/future-term course (past terms are history), time-sensitive
    # facts must be recent, and sync-chatter noise never qualifies.
    from sync.mine import is_noise_fact as _is_noise_fact
    # No silent row cap here. A `LIMIT 30` used to sit on this query, which
    # quietly discarded facts before they ever reached the card — the same class
    # of invisible loss as the old bullet ceiling. MAX_CARD_TOKENS is the one
    # real bound, and it reports itself.
    facts = db.conn.execute(
        """SELECT f.fact, f.category, f.created_at, c.term
           FROM memory_facts f JOIN courses c ON c.id = f.course_id
           WHERE f.course_id=? AND f.is_active=1 AND f.category IN
                 ('course-policy','prof-note','logistics','grading','general',
                  'scheduling','exam','assignment')
           ORDER BY f.id DESC LIMIT 500""", (course_id,)).fetchall()
    cutoff = datetime.date.today() - datetime.timedelta(days=FACT_TTL_DAYS)
    kept = []
    for f in facts:
        if term_is_past(f["term"]):
            continue  # course term ended — facts are history
        if _is_noise_fact(f["fact"]):
            continue  # sync chatter, never card-worthy
        created = (f["created_at"] or "")[:10]
        if f["category"] in TIME_SENSITIVE:
            if not created or created < cutoff.isoformat():
                continue
        kept.append(f)

    # Group by category, preserving CAT_ORDER (== priority). Full text, no clip:
    # a 140-char bullet cut the explanation off mid-sentence in BOTH the prompt
    # and the file the user reads.
    by_cat: dict[str, list[str]] = {}
    for f in kept:
        by_cat.setdefault(f["category"], []).append(f["fact"])
    for cat in CAT_ORDER:
        texts = by_cat.get(cat)
        if texts:
            sections.append((CAT_HEADING[cat], [f"- {t}" for t in texts]))
    # Any category not named in CAT_ORDER still gets rendered rather than lost.
    for cat, texts in by_cat.items():
        if cat not in CAT_ORDER:
            sections.append((CAT_HEADING.get(cat, cat.title()),
                             [f"- {t}" for t in texts]))

    # NOTES — most recent note files (pointers, cheap).
    notes_dir = _course_dir(cfg, course) / "notes"
    if notes_dir.exists():
        recent = sorted(notes_dir.glob("*.md"),
                        key=lambda p: p.stat().st_mtime, reverse=True)[:3]
        if recent:
            sections.append(("Notes", [f"- {p.stem}" for p in recent]))

    header = (f"# {course['code']} — memory card\n"
              f"_Regenerated {datetime.date.today().isoformat()}; "
              f"structured rows beat facts._\n")

    # Assemble under the bound, dropping the LOWEST-priority sections. Anything
    # dropped is counted by heading and reported below — never silently.
    rendered: list[str] = []
    omitted: dict[str, int] = {}
    used = _est_tokens(header)
    for heading, bullets in sections:
        block = f"\n## {heading}\n" + "\n".join(bullets) + "\n"
        cost = _est_tokens(block)
        if heading not in PINNED_HEADINGS and used + cost > max_tokens:
            omitted[heading] = len(bullets)
            continue
        rendered.append(block)
        used += cost

    body = header + "".join(rendered)
    if omitted:
        n = sum(omitted.values())
        detail = ", ".join(f"{h}: {c}" for h, c in omitted.items())
        body += (f"\n_⚠ {n} item(s) omitted to stay within the {max_tokens}-token "
                 f"card budget — {detail}. They are NOT invisible: raise "
                 f"MAX_CARD_TOKENS in agent/memory.py, or read the source facts._\n")
    return body


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


def supersede_stale_facts(db: DB, course_id: int | None = None) -> int:
    """Supersede facts that are no longer valid:
    1. time-sensitive facts older than FACT_TTL_DAYS (created_at), and
    2. ALL facts from courses whose term has ended (history, not memory).
    Timeless categories (grading/course-policy/general) only survive via rule 2."""
    today = datetime.date.today()
    cutoff = (today - datetime.timedelta(days=FACT_TTL_DAYS)).isoformat()
    total = 0
    # rule 1: old time-sensitive facts
    q = ("UPDATE memory_facts SET is_active=0 WHERE is_active=1 "
         f"AND category IN ({','.join('?' * len(TIME_SENSITIVE))}) "
         "AND date(created_at) < ?")
    params: list[str | int] = [*TIME_SENSITIVE, cutoff]
    if course_id:
        q += " AND course_id=?"
        params.append(course_id)
    total += db.conn.execute(q, params).rowcount
    # rule 2: facts from ended terms
    ended = [r["id"] for r in db.conn.execute(
        "SELECT id, term FROM courses").fetchall() if term_is_past(r["term"], today)]
    for cid in ended:
        q2 = "UPDATE memory_facts SET is_active=0 WHERE is_active=1 AND course_id=?"
        p2: list = [cid]
        if course_id:
            q2 += " AND course_id=?"
            p2.append(course_id)
        total += db.conn.execute(q2, p2).rowcount
    db.conn.commit()
    return total


def regenerate_cards(cfg: Config, db: DB, courses: list[int] | None = None) -> int:
    if courses is None:
        rows = db.conn.execute("SELECT id FROM courses WHERE is_active=1").fetchall()
        courses = [r["id"] for r in rows]
    n = 0
    for cid in courses:
        supersede_stale_facts(db, cid)  # hygiene before rendering
        p = write_card(cfg, db, cid)
        if p:
            n += 1
            print(f"  card: {p}")
    return n
