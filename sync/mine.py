"""Autonomous sync mining — pure helpers shared by corpus builder, parser, applier.

Deterministic first: everything in this section is regex/hashing only, no LLM.
"""
from __future__ import annotations

import datetime
import hashlib
import re
from pathlib import Path

OUTLINE_NAME_RE = re.compile(r"(outline|course\s*outline|syllabus)", re.I)
DATE_LINE_RE = re.compile(
    r"(\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}(/\d{2,4})?\b|"
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b|"
    r"\b(midterm|final|exam|quiz|lab|assignment|project|due|deadline|weight|worth|%)\b)",
    re.I)
POLICY_LINE_RE = re.compile(
    r"\b(grading|weight|worth|%|policy|policies|plagiarism|accommodat|late|penalty|"
    r"office hours|instructor|professor|ta\b|textbook|prerequisite|attendance)\b",
    re.I)


def stable_uid(code: str, title: str, starts_at: str) -> str:
    """16-hex-char dedupe key: sha1(code|title|starts_at).

    Same input twice (re-sync) MUST yield the same key so INSERT OR IGNORE
    dedupes; different courses/titles/dates MUST differ."""
    h = hashlib.sha1(f"{code}|{title}|{starts_at}".encode("utf-8")).hexdigest()
    return h[:16]


def classify_file(rel: str) -> str:
    """outline | assignment | content | slides | other — from path alone, no I/O."""
    low = (rel or "").lower()
    if OUTLINE_NAME_RE.search(low):
        return "outline"
    if "dropbox" in low or "assignment" in low or "assignments" in low:
        return "assignment"
    if "/slides/" in low or low.endswith((".pptx", ".ppt", ".pdf")):
        return "slides"
    if "/content/" in low or low.endswith((".md", ".html")):
        return "content"
    return "other"


def is_noise_fact(text: str) -> bool:
    """True for sync-chatter facts that must never reach memory cards.

    Matches 'X file(s) were added/updated/posted' phrasing in any case.
    Deliberately narrow: real facts ('Final is worth 45%') never match."""
    return bool(re.search(
        r"\b\d*\s*(files?|slides?|documents?|announcements?)\b.{0,20}"
        r"\b(were|was|has been|have been)\b.{0,20}"
        r"\b(added|updated|posted|synced|uploaded)\b",
        text or "", re.I))


# ── corpus builder ────────────────────────────────────────────────────
def _strip_html(html: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def build_course_corpus(cfg, db, course_id: int,
                        excerpt_chars: int = 12000,
                        other_chars: int = 4000) -> dict:
    """Shrink one course to an LLM-sized corpus (outlines first)."""
    course = db.conn.execute(
        "SELECT code, term FROM courses WHERE id=?", (course_id,)).fetchone()
    code, term = course["code"], course["term"]
    blocks: list[dict] = []

    def _read_md(rel: str, cap: int) -> str:
        try:
            return (Path(cfg.data_root) / rel).read_text(
                encoding="utf-8", errors="replace")[:cap]
        except OSError:
            return ""

    # 1. outlines first (filename match): ONE shared budget, max 2 files
    outline_budget = excerpt_chars
    for r in db.conn.execute(
            "SELECT path FROM files WHERE course_id=? ORDER BY id", (course_id,)).fetchall():
        rel = r["path"]
        if outline_budget <= 0:
            break
        if OUTLINE_NAME_RE.search(rel or "") and rel.endswith(".md"):
            text = _read_md(rel, outline_budget)
            if text.strip():
                blocks.append({"kind": "outline", "path": rel, "text": text})
                outline_budget -= len(text)

    # 2. undigested announcements + recent ones
    ann_ids: list[int] = []
    for r in db.conn.execute(
            """SELECT id, title, body, posted_at FROM announcements WHERE course_id=?
               AND (digested_at IS NULL OR posted_at >= datetime('now','-30 days'))
               ORDER BY posted_at DESC LIMIT 10""", (course_id,)).fetchall():
        body = _strip_html(r["body"])[:3000]
        if body.strip():
            blocks.append({"kind": "announcement",
                           "path": f"announcement:{code}:{r['title']}",
                           "text": f"TITLE: {r['title']}\nPOSTED: {r['posted_at']}\n{body}"})
            ann_ids.append(r["id"])

    # 3. assignment descriptions with no due date yet
    for r in db.conn.execute(
            "SELECT title, description FROM assignments WHERE course_id=?"
            " AND (due_at IS NULL OR weight IS NULL) LIMIT 10",
            (course_id,)).fetchall():
        desc = (r["description"] or "")[:3000]
        if len(desc.strip()) > 40:
            blocks.append({"kind": "assignment",
                           "path": f"assignment:{code}:{r['title']}", "text": desc})

    # 4. module HTML descriptions
    for r in db.conn.execute(
            """SELECT title, description FROM content_nodes WHERE course_id=?
               AND description IS NOT NULL LIMIT 5""", (course_id,)).fetchall():
        text = _strip_html(r["description"])[:2000]
        if len(text.strip()) > 80:
            blocks.append({"kind": "content", "path": f"module:{code}:{r['title']}",
                           "text": text})

    # 5. other files: date/policy lines only (md + on-disk html)
    budget = other_chars
    for r in db.conn.execute(
            "SELECT path FROM files WHERE course_id=? "
            "AND (path LIKE '%.md' OR path LIKE '%.html') ORDER BY id",
            (course_id,)).fetchall():
        rel = r["path"]
        if OUTLINE_NAME_RE.search(rel or ""):
            continue
        if budget <= 0:
            break
        try:
            raw_text = (Path(cfg.data_root) / rel).read_text(
                encoding="utf-8", errors="replace")
            if rel.endswith(".html"):
                raw_text = _strip_html(raw_text)
            lines = raw_text.splitlines()
        except OSError:
            continue
        keep: list[str] = []
        for i, ln in enumerate(lines):
            if DATE_LINE_RE.search(ln) or POLICY_LINE_RE.search(ln):
                keep.append(lines[i - 1] if i > 0 else "")
                keep.append(ln)
                if i + 1 < len(lines):
                    keep.append(lines[i + 1])
        chunk = "\n".join(keep)[:budget]
        if len(chunk.strip()) > 40:
            blocks.append({"kind": "other", "path": rel, "text": chunk})
            budget -= len(chunk)

    return {"course_id": course_id, "code": code, "term": term,
            "today": datetime.date.today().isoformat(),
            "ann_ids": ann_ids, "blocks": blocks}


# ── miner prompt + strict parser ──────────────────────────────────────
MINER_SYSTEM = (
    "You are the memory miner for a student's course assistant. "
    "Input is a corpus of course material (outline, assignments, announcements, module pages, slide excerpts). "
    "Output durable memory + schedule rows the student will rely on for months. "
    "QUALITY BAR (most important rule): only add information the student would act on or ask about weeks from now — "
    "grading breakdowns, exam dates and weights, assignment due dates, late/penalty policies, "
    'accommodation rules, instructor contact and office hours, recurring class times (as facts ONLY — the timetable already exists; NEVER emit them as events). '
    "SKIP everything else: file listings, 'X was posted', slide coverage summaries, "
    "generic course descriptions, one-off instructions with no date. "
    "EMPTY IS CORRECT: if nothing in the corpus clears the bar, return empty arrays. "
    "Never invent filler to look productive; never restate the input. "
    "DATES: emit starts_at/due_at as YYYY-MM-DD or YYYY-MM-DDTHH:MM only, resolved against TODAY; "
    "never 'tomorrow/next week'. Only dates explicitly stated in the corpus. "
    "Schedule rows (events/exams/assignment_updates) need confidence >= 0.7; facts need >= 0.5. "
    "Lab-section variants collapse to ONE event with sections in notes. "
    "category must be one of general,scheduling,grading,course-policy,prof-note,exam,assignment,logistics. "
    'Return STRICT JSON: {"facts": [{"fact": str, "category": str, "confidence": float}], '
    '"events": [{"title": str, "starts_at": str, "ends_at": str|None, "kind": str, "notes": str|None, "confidence": float}], '
    '"exams": [{"title": str, "starts_at": str, "weight": float|None, "notes": str|None, "confidence": float}], '
    '"assignment_updates": [{"title": str, "due_at": str|None, "weight": float|None}]}. '
    'event kind must be one of class,assignment,exam,personal.'
)

_CATS = {"general", "scheduling", "grading", "course-policy",
         "prof-note", "exam", "assignment", "logistics"}
_DATE_RE = re.compile(r"^20\d\d-\d\d-\d\d(T\d\d:\d\d)?$")


def parse_miner_output(raw: str) -> dict:
    """Parse miner JSON strictly; coerce junk, never raise on model garbage."""
    import json as _json
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?|\n?```$", "", text).strip()
    try:
        data = _json.loads(text)
    except Exception:
        return {"facts": [], "events": [], "exams": [], "assignment_updates": []}
    if not isinstance(data, dict):
        return {"facts": [], "events": [], "exams": [], "assignment_updates": []}

    facts = []
    for f in (data.get("facts") or [])[:30]:
        fact = str(f.get("fact") or "").strip()
        if len(fact) < 10:
            continue
        cat = f.get("category") if f.get("category") in _CATS else "general"
        try:
            conf = min(1.0, max(0.0, float(f.get("confidence", 0.5))))
        except (TypeError, ValueError):
            conf = 0.5
        facts.append({"fact": fact, "category": cat, "confidence": conf})

    events = []
    for e in (data.get("events") or [])[:30]:
        title = str(e.get("title") or "").strip()
        starts = str(e.get("starts_at") or "").strip()
        if not title or not _DATE_RE.match(starts):
            continue
        try:
            conf = float(e.get("confidence", 0.9))
        except (TypeError, ValueError):
            conf = 0.0
        if conf < 0.7:  # auto-add bar: uncertain schedule rows never enter the calendar
            continue
        kind = e.get("kind") or "assignment"
        if kind not in ("class", "assignment", "exam", "personal"):
            kind = "assignment"
        if kind in ("class", "personal"):
            continue  # recurring meetings live in course_sessions, never the mined calendar
        events.append({"title": title, "starts_at": starts,
                       "ends_at": e.get("ends_at"), "kind": kind,
                       "notes": e.get("notes"), "confidence": conf})

    exams = []
    for x in (data.get("exams") or [])[:10]:
        title = str(x.get("title") or "").strip()
        starts = str(x.get("starts_at") or "").strip()
        if not title or not _DATE_RE.match(starts):
            continue
        try:
            xconf = float(x.get("confidence", 0.9))
        except (TypeError, ValueError):
            xconf = 0.0
        if xconf < 0.7:
            continue
        try:
            w = float(x["weight"]) if x.get("weight") is not None else None
        except (TypeError, ValueError):
            w = None
        exams.append({"title": title, "starts_at": starts, "weight": w,
                      "notes": x.get("notes"), "confidence": xconf})

    updates = []
    for u in (data.get("assignment_updates") or [])[:20]:
        title = str(u.get("title") or "").strip()
        if not title:
            continue
        due = str(u.get("due_at") or "").strip() or None
        if due and not _DATE_RE.match(due):
            due = None
        try:
            w = float(u["weight"]) if u.get("weight") is not None else None
        except (TypeError, ValueError):
            w = None
        if due or w is not None:
            updates.append({"title": title, "due_at": due, "weight": w})
    return {"facts": facts, "events": events, "exams": exams,
            "assignment_updates": updates}


# ── applier ───────────────────────────────────────────────────────────
def _norm_title(s: str) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip().casefold())
    return re.sub(r"[^a-z0-9 ]", "", s)


def _norm_dt(s: str) -> str:
    """Normalize datetime strings so format variants hash identically:
    strip seconds (`...T09:00:00` -> `...T09:00`) and stray whitespace."""
    s = (s or "").strip()
    m = re.match(r"^(20\d\d-\d\d-\d\dT\d\d:\d\d)(:\d\d)?(.*)$", s)
    return (m.group(1) + m.group(3)).strip() if m else s


def apply_mining(db, course_id: int, mined: dict, source: str, ann_ids: list[int] | None = None) -> dict:
    """Apply parsed miner output: facts, events, exams, assignment backfill.

    Idempotent: re-applying the same output returns all zeros. Every write
    is audited (actor='sync'). `course_id` is ALWAYS the mined course."""
    res = {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    course = db.conn.execute(
        "SELECT code FROM courses WHERE id=?", (course_id,)).fetchone()
    code = course["code"] if course else str(course_id)

    for f in mined.get("facts", []):
        fact = str(f.get("fact", "")).strip()
        if not fact or is_noise_fact(fact):
            continue
        dup = db.conn.execute(
            "SELECT 1 FROM memory_facts WHERE course_id=? AND fact=? AND is_active=1",
            (course_id, fact)).fetchone()
        if dup:
            continue
        try:
            conf = min(1.0, max(0.0, float(f.get("confidence", 0.5))))
        except (TypeError, ValueError):
            conf = 0.5
        cur = db.conn.execute(
            "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
            (course_id, fact, f.get("category") or "general", conf, source))
        res["facts"] += 1
        db.audit("sync", "memory_facts", cur.lastrowid, "mine-insert",
                 {"course_id": course_id, "fact": fact})

    for e in mined.get("events", []):
        if (e.get("kind") or "assignment") in ("class", "personal"):
            continue
        title = str(e.get("title") or "").strip()
        starts = str(e.get("starts_at") or "").strip()
        if not title or not starts:
            continue
        dup = db.conn.execute(
            "SELECT 1 FROM events WHERE course_id=? AND lower(title)=lower(?)"
            " AND substr(starts_at,1,10)=substr(?,1,10)",
            (course_id, title, starts)).fetchone()
        if dup:
            continue
        uid = stable_uid(code, title, _norm_dt(starts))
        cur = db.conn.execute(
            "INSERT OR IGNORE INTO events (course_id, kind, title, starts_at, ends_at, notes, ics_uid)"
            " VALUES (?,?,?,?,?,?,?)",
            (course_id, e.get("kind") or "assignment", title, starts,
             e.get("ends_at"), e.get("notes"), uid))
        if cur.rowcount:
            res["events"] += 1
            db.audit("sync", "events", cur.lastrowid, "mine-insert",
                     {"course_id": course_id, "title": title,
                      "starts_at": starts, "uid": uid})

    for x in mined.get("exams", []):
        xtitle = str(x.get("title") or "").strip()
        xstarts = str(x.get("starts_at") or "").strip()
        if not xtitle or not xstarts:
            continue
        dup = db.conn.execute(
            "SELECT 1 FROM exams WHERE course_id=? AND lower(title)=lower(?) AND starts_at=?",
            (course_id, xtitle, xstarts)).fetchone()
        if dup:
            continue
        try:
            xw = float(x["weight"]) if x.get("weight") is not None else None
        except (TypeError, ValueError):
            xw = None
        cur = db.conn.execute(
            "INSERT INTO exams (course_id, title, starts_at, weight, notes, source)"
            " VALUES (?,?,?,?,?, 'ai')",
            (course_id, xtitle, xstarts, xw, x.get("notes")))
        res["exams"] += 1
        db.audit("sync", "exams", cur.lastrowid, "mine-insert",
                 {"course_id": course_id, "title": xtitle, "starts_at": xstarts})

    assigns = db.conn.execute(
        "SELECT id, title, due_at, weight FROM assignments WHERE course_id=?",
        (course_id,)).fetchall()
    for u in mined.get("assignment_updates", []):
        want = _norm_title(u.get("title"))
        if len(want) < 4:
            continue
        target = None
        for a in assigns:
            have = _norm_title(a["title"])
            if want == have or want in have or have in want:
                target = a
                break
        if not target:
            continue
        sets: dict = {}
        if u.get("due_at") and not target["due_at"]:
            sets["due_at"] = u["due_at"]
        if u.get("weight") is not None and target["weight"] is None:
            try:
                sets["weight"] = float(u["weight"])
            except (TypeError, ValueError):
                pass
        if sets:
            db.conn.execute(
                f"UPDATE assignments SET {', '.join(k + '=?' for k in sets)},"
                " updated_at=datetime('now') WHERE id=?",
                (*sets.values(), target["id"]))
            res["assignments"] += 1
            db.audit("sync", "assignments", target["id"], "mine-backfill",
                     {"before": {"due_at": target["due_at"], "weight": target["weight"]},
                      "after": sets})
    if ann_ids:
        db.conn.executemany(
            "UPDATE announcements SET digested_at=datetime('now') WHERE id=?",
            [(i,) for i in ann_ids])
    db.conn.commit()
    return res
