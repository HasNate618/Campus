# Autonomous Sync Mining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sync automatically mines important info from ANY file (outlines, slides, announcements, assignment descriptions, module HTML) into the memory card and the schedule (events/exams/assignment dates), with a one-shot backfill over the 6 existing 2026F courses.

**Architecture:** New `sync/mine.py` module (pure helpers + corpus builder + output parser + applier) called per-course right after that course's foreground extraction (so `.md` content exists the same run — slower syncs, full context), grouped per-course so facts keep their `course_id`. Miner output is strict JSON `{facts, events, exams, assignment_updates}`; applier dedupes via stable UIDs and writes `audit_log` rows. Backfill is the same code path over existing `.md` files.

**Tech Stack:** Python 3.12, SQLite (WAL), httpx (existing LLM endpoint via `llm_headers`), pytest, existing `sync.config.Config` / `sync.db.DB`. LLM calls (chat + per-course mining only) use `llm_model: opencode-go/mimo-v2.5` via bifrost (`llm_url: http://bifrost:8080/v1`); the sync log, counts, and dedupe are deterministic code with no model involved.

## Global Constraints

- Python 3.12 only; no new third-party dependencies (stdlib + httpx + existing reqs).
- Deterministic first: regex/dedupe/UID/log-rendering logic must be pure and unit-tested; the LLM is used only where comprehension is required (chat answers, per-course mining). The sync digest renders from counts — no model call.
- Never re-download or re-extract: mining reads existing `.md`/DB rows only; `files.sha256` change detection stays the source of truth for "new".
- Auto-add policy (user-approved): mined dates create `events`/`exams` rows and backfill `assignments.due_at`/`weight` immediately, deduped; every write gets an `audit_log` row.
- Memory card stays regenerated (never hand-edited); structured rows beat facts.
- TDD: failing test first for every behavior; commit per task.

---

### Task 1: Mining pure helpers (classify + UID + noise filter)

**Files:**

- Create: `sync/mine.py:1-120`
- Test: `tests/test_mine.py:1-120`

**Interfaces:**

- Consumes: nothing (pure stdlib).
- Produces (used by Tasks 2–4):
  - `classify_file(rel_path: str) -> str` returns `"outline" | "assignment" | "announcement" | "content"`.
  - `stable_uid(course_code: str, title: str, starts_at: str) -> str` returns 16-char hex.
  - `is_noise_fact(fact: str) -> bool` returns True for "file posted / slides added" noise.
  - `NOISE_PATTERNS: list[re.Pattern]`, `OUTLINE_NAME_RE: re.Pattern`.

- [ ] **Step 1: Write the failing test**

```python
def test_classify_and_uid_and_noise():
    from sync.mine import classify_file, stable_uid, is_noise_fact
    assert classify_file("2026F/SE3352A/content/Course Overview/SE3352_CourseOutlines_2026.md") == "outline"
    assert classify_file("2026F/SE3352A/content/Week 1/01-IntroToSDLCAndAgile.md") == "content"
    assert classify_file("assignment:SE 3352A:Group Project") == "assignment"
    assert classify_file("announcement:SE 3316A:Lab rooms") == "announcement"
    assert stable_uid("SE3352A", "Lab 1 due", "2026-09-14") == stable_uid("SE3352A", "Lab 1 due", "2026-09-14")
    assert len(stable_uid("SE3352A", "Lab 1 due", "2026-09-14")) == 16
    assert is_noise_fact("SE3352A course outline (SE3352_CourseOutlines_2026.pdf) is available under Content") is False
    assert is_noise_fact("SE3316A lecture notes covering HTML intro were added (webt...)") is True
    assert is_noise_fact("Chapter 01 lecture slides were added to Brightspace Content as of 2026-09-09.") is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_classify_and_uid_and_noise -v`
Expected: FAIL with "No module named 'sync.mine'" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```python
"""Autonomous sync mining — pure helpers (no DB, no LLM, no I/O)."""
from __future__ import annotations

import hashlib
import re

OUTLINE_NAME_RE = re.compile(r"outline|syllabus|course.?outline", re.I)

NOISE_PATTERNS: list[re.Pattern] = [
    re.compile(r"slides? were added to .*brightspace", re.I),
    re.compile(r"lecture notes .* were added", re.I),
    re.compile(r"materials? .* are available in both pdf and pptx", re.I),
    re.compile(r"week \d+ materials? .* available under content", re.I),
    re.compile(r"brightspace now includes .* under (notes|labs|units)", re.I),
]


def classify_file(rel_path: str) -> str:
    if rel_path.startswith("assignment:"):
        return "assignment"
    if rel_path.startswith("announcement:"):
        return "announcement"
    if OUTLINE_NAME_RE.search(rel_path or ""):
        return "outline"
    return "content"


def stable_uid(course_code: str, title: str, starts_at: str) -> str:
    key = f"{course_code}|{(title or '').strip().casefold()}|{(starts_at or '').strip()}"
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def is_noise_fact(fact: str) -> bool:
    return any(p.search(fact or "") for p in NOISE_PATTERNS)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_classify_and_uid_and_noise -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: add mining pure helpers (classify, uid, noise filter)"
```

### Task 2: Per-course mining corpus builder

**Files:**

- Modify: `sync/mine.py:120-260` (append)
- Test: `tests/test_mine.py:120-260` (append)

**Interfaces:**

- Consumes: `classify_file` from Task 1; `sync.db.DB`, `sync.config.Config`, `pathlib.Path`.
- Produces (used by Task 5):
  - `DATE_LINE_RE: re.Pattern` — matches `Sep 14`, `Sept. 9th`, `2026-09-14`, `November 20`, `Jan 4, 2027`.
  - `build_course_corpus(cfg, db, course_id, excerpt_chars: int = 12000, other_chars: int = 4000) -> dict` returns `{"course_id": int, "code": str, "term": str, "today": str, "ann_ids": [int], "blocks": [{"kind": str, "path": str, "text": str}]}` (`ann_ids` = announcement row ids included, for `digested_at` stamping in Task 4).

Corpus rules (locked): outlines share ONE 12K budget across max 2 files (first filename matches win — SE3316A has both 2025 and 2026 outlines); assignment descriptions + undigested announcements get full text (capped 3000 chars each, max 10 each); module `content_nodes.description` HTML is stripped to text (capped 2000 chars each, max 5 modules); other `.md` AND on-disk `content/**/*.html` files contribute ONLY date/policy keyword lines (±1 line context, HTML stripped for `.html`), capped at `other_chars` total. Worst case per course is ~60KB; Task 5 serializes outlines-first and hard-truncates the prompt there, so a 6-course backfill is 6 bounded LLM calls, not one giant prompt.

- [ ] **Step 1: Write the failing test**

```python
def test_build_course_corpus_prefers_outlines_and_dates(db_path, tmp_path):
    import os, sqlite3
    os.environ["CAMPUS_DB"] = str(db_path)
    from sync.config import Config
    from sync.db import DB
    from sync.mine import build_course_corpus
    cfg = Config.load()
    db = DB(db_path)
    course = db.get_course_by_code("CS 1100A")
    assert course is not None
    # fake an outline .md + a big slide deck with one dated line
    root = tmp_path / "school"
    code_dir = course["term"] + "/" + course["code"].replace(" ", "")
    (root / code_dir / "content").mkdir(parents=True, exist_ok=True)
    (root / code_dir / "content" / "CS1100-outline.md").write_text("EVALUATION: Midterm 20% Final 45%\n")
    deck = "\n".join([f"slide line {i}" for i in range(200)] + ["Lab 1 due Sep. 14 by 5pm"])
    (root / code_dir / "content" / "deck.md").write_text(deck)
    cfg.data_root = root
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, sha256, size) VALUES (?,?,?,?,?,?)",
        (course["id"], f"{code_dir}/content/CS1100-outline.md", "slide", "brightspace", "a" * 64, 10))
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, sha256, size) VALUES (?,?,?,?,?,?)",
        (course["id"], f"{code_dir}/content/deck.md", "slide", "brightspace", "b" * 64, 10))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    assert corpus["code"] == course["code"]
    kinds = [b["kind"] for b in corpus["blocks"]]
    assert "outline" in kinds
    deck_block = next(b for b in corpus["blocks"] if "deck.md" in b["path"])
    assert "Sep. 14" in deck_block["text"]
    assert "slide line 0" not in deck_block["text"]
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_build_course_corpus_prefers_outlines_and_dates -v`
Expected: FAIL with "build_course_corpus not defined" (import error).

- [ ] **Step 3: Write minimal implementation**

```python
DATE_LINE_RE = re.compile(
    r"(20\d\d-\d\d-\d\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(t)?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?(,?\s+20\d\d)?)",
    re.I,
)
POLICY_LINE_RE = re.compile(
    r"(midterm|final exam|quiz|due|weight|% worth|late|penalty|grace|accommodation|plagiarism|office hours|prereq|antireq)",
    re.I,
)


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def build_course_corpus(cfg, db, course_id: int, excerpt_chars: int = 12000,
                        other_chars: int = 4000) -> dict:
    import datetime
    course = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    code = course["code"]
    term = course["term"]
    code_dir = f"{term}/{code.replace(' ', '')}"
    blocks: list[dict] = []

    def _read_md(rel: str, cap: int) -> str:
        try:
            return (Path(cfg.data_root) / rel).read_text(encoding="utf-8", errors="replace")[:cap]
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
    # 2. assignment descriptions (structured, high-trust for dates)
    for r in db.conn.execute(
            "SELECT title, description, due_at FROM assignments WHERE course_id=? LIMIT 10",
            (course_id,)).fetchall():
        desc = _strip_html(r["description"])[:3000]
        if desc.strip():
            blocks.append({"kind": "assignment",
                           "path": f"assignment:{code}:{r['title']}",
                           "text": f"TITLE: {r['title']}\nDUE_AT: {r['due_at']}\n{desc}"})
    # 3. recent/undigested announcements
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
    # 4. module descriptions (landing-page schedule tables live here)
    for r in db.conn.execute(
            """SELECT title, description FROM content_nodes WHERE course_id=?
               AND description IS NOT NULL LIMIT 5""", (course_id,)).fetchall():
        text = _strip_html(r["description"])[:2000]
        if len(text.strip()) > 80:
            blocks.append({"kind": "content", "path": f"module:{code}:{r['title']}",
                           "text": text})
    # 5. other .md files: date/policy lines only
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
                keep.append(ln.strip())
                if i + 1 < len(lines) and lines[i + 1].strip():
                    keep.append(lines[i + 1].strip()[:200])
        if keep:
            text = "\n".join(keep)[:budget]
            budget -= len(text)
            blocks.append({"kind": "content", "path": rel, "text": text})
    return {"course_id": course_id, "code": code, "term": term,
            "today": datetime.date.today().isoformat(),
            "ann_ids": ann_ids, "blocks": blocks}
```

(Append to `sync/mine.py`; add `from pathlib import Path` import at top if missing.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_build_course_corpus_prefers_outlines_and_dates -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: add per-course mining corpus builder"
```

### Task 3: Miner output contract (prompt + strict parser)

**Files:**

- Modify: `sync/mine.py:260-420` (append)
- Test: `tests/test_mine.py:260-420` (append)

**Interfaces:**

- Consumes: corpus dict from Task 2.
- Produces (used by Task 4):
  - `MINER_SYSTEM: str` — prompt with absolute-date rules + category whitelist + output schema.
  - `parse_miner_output(raw: str) -> dict` returns `{"facts": [{"fact","category","confidence"}], "events": [{"title","starts_at","ends_at","kind","notes","confidence"}], "exams": [{"title","starts_at","weight","notes","confidence"}], "assignment_updates": [{"title","due_at","weight"}]}`; coerces bad categories to `"general"`, drops rows with unparseable dates, drops schedule rows with explicit confidence < 0.7 (missing confidence defaults to 0.9 — the prompt mandates it), never raises on model garbage (returns empty lists).

Date rule (locked): miner must emit `starts_at`/`due_at` as `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`; relative dates ("next Friday", "tomorrow") resolved against `corpus["today"]`; lab-section variants ("Sec 3 Thu 9:30") collapse to one event with the section in `notes`, never 3 duplicate events. Categories locked to `general,scheduling,grading,course-policy,prof-note,exam,assignment,logistics`.

- [ ] **Step 1: Write the failing test**

```python
def test_parse_miner_output_coerces_and_drops():
    from sync.mine import parse_miner_output
    raw = '{"facts": [{"fact": "Midterm is 25%", "category": "bogus", "confidence": 0.9}], '
    raw += '"events": [{"title": "Lab 1 due", "starts_at": "2026-09-14", "kind": "assignment"}, '
    raw += '{"title": "Maybe quiz", "starts_at": "2026-10-01", "kind": "exam", "confidence": 0.2}], '
    raw += '"exams": [{"title": "Midterm", "starts_at": "sometime soon"}, '
    raw += '{"title": "Final", "starts_at": "2026-12-15", "confidence": 0.3}], '
    raw += '"assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14"}]}'
    out = parse_miner_output("```json\n" + raw + "\n```")
    assert out["facts"][0]["category"] == "general"
    assert len(out["events"]) == 1  # low-confidence rumor dropped
    assert out["events"][0]["starts_at"] == "2026-09-14"
    assert out["exams"] == []  # bad date + low confidence dropped
    assert out["assignment_updates"][0]["due_at"] == "2026-09-14"


def test_parse_miner_output_never_raises():
    from sync.mine import parse_miner_output
    assert parse_miner_output("not json at all") == {
        "facts": [], "events": [], "exams": [], "assignment_updates": []}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py -k parse_miner -v`
Expected: FAIL with "parse_miner_output not defined".

- [ ] **Step 3: Write minimal implementation**

```python
MINER_SYSTEM = (
    "You are the memory miner for a student's course assistant. "
    "Input is a corpus of course material (outline, assignments, announcements, module pages, slide excerpts). "
    "Output durable memory + schedule rows the student will rely on for months. "
    "QUALITY BAR (most important rule): only add information the student would act on or ask about weeks from now — "
    "grading breakdowns, exam dates and weights, assignment due dates, late/penalty policies, "
    "accommodation rules, instructor contact and office hours, recurring class times. "
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

_ALLOWED_CATS = {"general", "scheduling", "grading", "course-policy",
                 "prof-note", "exam", "assignment", "logistics"}
_ALLOWED_KINDS = {"class", "assignment", "exam", "personal"}
_DATE_RE = re.compile(r"^20\d\d-\d\d-\d\d(T\d\d:\d\d)?$")


def parse_miner_output(raw: str) -> dict:
    out: dict = {"facts": [], "events": [], "exams": [], "assignment_updates": []}
    try:
        s = raw or ""
        a, b = s.find("{"), s.rfind("}")
        if a < 0 or b <= a:
            return out
        import json as _json
        data = _json.loads(s[a:b + 1])
    except Exception:
        return out
    for f in (data.get("facts") or [])[:30]:
        fact = str(f.get("fact") or "").strip()
        if not fact:
            continue
        cat = f.get("category") or "general"
        if cat not in _ALLOWED_CATS:
            cat = "general"
        try:
            conf = float(f.get("confidence", 0.5))
        except Exception:
            conf = 0.5
        out["facts"].append({"fact": fact[:500], "category": cat,
                             "confidence": min(1.0, max(0.0, conf))})
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
        if kind not in _ALLOWED_KINDS:
            kind = "assignment"
        ends = str(e.get("ends_at") or "").strip() or None
        if ends is not None and not _DATE_RE.match(ends):
            ends = None
        out["events"].append({"title": title[:200], "starts_at": starts,
                              "ends_at": ends, "kind": kind,
                              "notes": str(e.get("notes") or "")[:500] or None})
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
        except Exception:
            w = None
        out["exams"].append({"title": title[:200], "starts_at": starts,
                             "weight": w, "notes": str(x.get("notes") or "")[:500] or None})
    for u in (data.get("assignment_updates") or [])[:30]:
        title = str(u.get("title") or "").strip()
        if not title:
            continue
        due = str(u.get("due_at") or "").strip() or None
        if due is not None and not _DATE_RE.match(due):
            due = None
        try:
            w = float(u["weight"]) if u.get("weight") is not None else None
        except Exception:
            w = None
        if due is None and w is None:
            continue
        out["assignment_updates"].append({"title": title[:200], "due_at": due, "weight": w})
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py -k parse_miner -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: add miner output contract and strict parser"
```

### Task 4: Applier (facts + schedule auto-add with dedupe + audit)

**Files:**

- Modify: `sync/mine.py:420-600` (append)
- Test: `tests/test_mine.py:420-600` (append)

**Interfaces:**

- Consumes: `stable_uid`, `is_noise_fact`, `parse_miner_output` shape from Tasks 1–3.
- Produces (used by Task 5):
  - `apply_mining(db, course_id: int, mined: dict, source: str, ann_ids: list[int] | None = None) -> dict` returns `{"facts": int, "events": int, "exams": int, "assignments": int}`.

Apply rules (locked): facts skip `is_noise_fact` hits and exact-duplicate active facts; `course_id` is ALWAYS the mined course (this fixes the multi-course `None` bug — caller passes per-course id). Events dedupe by normalized title + calendar date (`lower(title)` and `substr(starts_at,1,10)` pre-check) then insert with `ics_uid = stable_uid(code, title, starts_at)` and `INSERT OR IGNORE` (the hash input is normalized: seconds stripped, surrounding whitespace dropped); exams dedupe on normalized `(course_id, lower(title), starts_at)` via select-then-insert; assignment_updates match by normalized title (lowercase, punctuation stripped, whitespace collapsed; substring EITHER direction, min 4 chars) and only fill `due_at`/`weight` when the row is currently NULL (never overwrite registrar/Brightspace values); every insert/update writes `db.audit("sync", ...)` with action `"mine-insert"` / `"mine-backfill"` and before/after JSON (`audit_log.actor` CHECK only allows `system/ai/user/sync` — never `"mine"`). On success, `ann_ids` rows are stamped `digested_at=datetime('now')` so announcements are never re-mined.

- [ ] **Step 1: Write the failing test**

```python
def test_apply_mining_dedupes_and_backfills(db_path):
    import os
    os.environ["CAMPUS_DB"] = str(db_path)
    from sync.db import DB
    from sync.mine import apply_mining
    db = DB(db_path)
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, source) VALUES (?,?,?)",
        (course["id"], "Lab 1 – HTML+CSS", "brightspace"))
    db.conn.commit()
    mined = {
        "facts": [{"fact": "Chapter 01 slides were added to Brightspace Content.", "category": "general", "confidence": 0.6},
                  {"fact": "Midterm is worth 20% and needs supporting documentation.", "category": "grading", "confidence": 0.9}],
        "events": [{"title": "Lab 1 due", "starts_at": "2026-09-14", "ends_at": None, "kind": "assignment", "notes": None}],
        "exams": [{"title": "Midterm Test", "starts_at": "2026-10-20", "weight": 20.0, "notes": None}],
        "assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14", "weight": None},
                               {"title": "Quiz 9 (nonexistent)", "due_at": "2026-10-01", "weight": None}],
    }
    r1 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r1 == {"facts": 1, "events": 1, "exams": 1, "assignments": 1}
    assert db.conn.execute(
        "SELECT COUNT(*) FROM assignments WHERE course_id=?",
        (course["id"],)).fetchone()[0] == 1  # non-matching update creates nothing
    r2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r2 == {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    row = db.conn.execute(
        "SELECT due_at FROM assignments WHERE course_id=? AND title LIKE 'Lab 1%'",
        (course["id"],)).fetchone()
    assert (row["due_at"] or "").startswith("2026-09-14")
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_apply_mining_dedupes_and_backfills -v`
Expected: FAIL with "apply_mining not defined".

- [ ] **Step 3: Write minimal implementation**

```python
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
    res = {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    course = db.conn.execute("SELECT code FROM courses WHERE id=?", (course_id,)).fetchone()
    code = course["code"] if course else ""
    for f in mined.get("facts", []):
        fact = (f.get("fact") or "").strip()
        if not fact or is_noise_fact(fact):
            continue
        dup = db.conn.execute(
            "SELECT 1 FROM memory_facts WHERE course_id=? AND is_active=1 AND fact=?",
            (course_id, fact)).fetchone()
        if dup:
            continue
        try:
            conf = min(1.0, max(0.0, float(f.get("confidence", 0.5))))
        except (TypeError, ValueError):
            conf = 0.5
        db.conn.execute(
            "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
            (course_id, fact, f.get("category") or "general", conf, source))
        res["facts"] += 1
    for e in mined.get("events", []):
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
        if target is None:
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_apply_mining_dedupes_and_backfills -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: add mining applier with dedupe and audit"
```

### Task 5: Wire into sync + backfill CLI

**Files:**

- Modify: `sync/sync.py` (`SyncEngine.digest_and_log`, `SyncEngine.run` extraction order, `sync/__main__.py` CLI)
- Test: `tests/test_mine.py` (append integration test with monkeypatched LLM)

**Interfaces:**

- Consumes: `build_course_corpus`, `parse_miner_output`, `apply_mining`, `MINER_SYSTEM` from Tasks 2–4; existing `llm_headers`, `DB`, `Config`.
- Produces:
  - `SyncEngine.course_has_mining_deltas(course_id: int) -> bool` — True when `self.deltas` holds a `file_new`/`file_changed` path under that course's data dir, or an announcement/assignment delta for it.
  - `SyncEngine.mine_course(course_id: int, force: bool = False) -> dict` — returns zeros immediately when not forced and `course_has_mining_deltas` is False; otherwise corpus → LLM POST → parse → apply; never raises. Uses `self.model` from config (`opencode-go/mimo-v2.5` on `home`; `--model` flag overrides per run).
  - CLI: `python -m sync mine --backfill [--code CS 1100A]` runs `mine_course(..., force=True)` per active course then `regenerate_cards`.

Wiring rules (locked): per-course order inside `run()` — content → embedded → module media → dropbox → news → syllabus → FOREGROUND `run_extraction_queue(course_id)` (same caps as today: long-scan skip, size cap) → `mine_course(course_id)` gated on that course's deltas (deltas OR undigested announcements — see gate). The old detached `_extraction_bg` spawn is removed (kept for manual use): the user accepts slower syncs in exchange for mining with full context the same run. Idle courses (no deltas, nothing undigested) skip extraction + mining entirely, so quiet syncs stay fast. `digest_and_log` loses its LLM call entirely (see Task 7): it renders the markdown log from counts + per-course mining results. Sync log gains one line per mined course: `mined SE3352A: +3 facts, +2 events, +1 exam, backfilled 1 assignment`.

- [ ] **Step 1: Write the failing test**

```python
def test_mine_course_applies_without_llm_leak(db_path, tmp_path, monkeypatch):
    import os
    os.environ["CAMPUS_DB"] = str(db_path)
    from sync.config import Config
    from sync.db import DB
    from sync.sync import SyncEngine
    cfg = Config.load()
    db = DB(db_path)
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Midterm", "Covers units 1-4.", "brightspace"))
    db.conn.commit()
    fake = {"facts": [{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}],
            "events": [], "exams": [], "assignment_updates": []}
    import sync.sync as sync_mod
    monkeypatch.setattr(sync_mod.SyncEngine, "_call_miner", lambda self, c: fake)
    eng = SyncEngine(cfg, db, client=None)
    out = eng.mine_course(course["id"], force=True)
    assert eng.course_has_mining_deltas(course["id"]) is False  # bare DB: gate works
    assert out["facts"] == 1
    n = db.conn.execute(
        "SELECT COUNT(*) FROM memory_facts WHERE course_id=? AND is_active=1",
        (course["id"],)).fetchone()[0]
    assert n >= 1
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_mine_course_applies_without_llm_leak -v`
Expected: FAIL with "mine_course not defined" (AttributeError).

- [ ] **Step 3: Write minimal implementation**

```python
# in sync/sync.py — add methods to SyncEngine (append near digest_and_log):

def _call_miner(self, corpus: dict) -> dict:
    """Single LLM call for one course corpus; returns parsed mining dict."""
    import json as _json
    from sync.mine import MINER_SYSTEM, parse_miner_output
    endpoints = self.cfg.llm_endpoints()
    if not endpoints:
        return {"facts": [], "events": [], "exams": [], "assignment_updates": []}
    ordered = sorted(corpus["blocks"], key=lambda b: 0 if b["kind"] == "outline" else 1)
    prompt = (MINER_SYSTEM + f"\n\nTODAY: {corpus['today']}\nCOURSE: {corpus['code']} ({corpus['term']})\n"
              f"CORPUS:\n{_json.dumps(ordered[:30], indent=1)[:60000]}")
    try:
        import httpx
        r = httpx.post(f"{endpoints[0]}/chat/completions", headers=llm_headers(self.cfg),
                       json={"model": self.model,
                             "messages": [{"role": "user", "content": prompt}]}, timeout=180)
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        return parse_miner_output(content)
    except Exception as e:
        print(f"  mine failed for {corpus['code']}: {e}")
        return {"facts": [], "events": [], "exams": [], "assignment_updates": []}

def course_has_mining_deltas(self, course_id: int) -> bool:
    """True when this sync produced anything worth mining for the course."""
    course = self.db.conn.execute(
        "SELECT term, code FROM courses WHERE id=?", (course_id,)).fetchone()
    prefix = f"{course['term']}/{course['code'].replace(' ', '')}/" if course else ""
    for d in self.deltas:
        if (d.get("path") or "").startswith(prefix):
            return True
        if d.get("kind") in ("announcement", "assignment"):
            return True
    undig = self.db.conn.execute(
        "SELECT 1 FROM announcements WHERE course_id=? AND digested_at IS NULL LIMIT 1",
        (course_id,)).fetchone()
    if undig:
        return True
    return False

def mine_course(self, course_id: int, force: bool = False) -> dict:
    """Mine one course corpus and apply results (per-course => correct attribution)."""
    import time as _time
    from sync.mine import apply_mining, build_course_corpus
    if not force and not self.course_has_mining_deltas(course_id):
        return {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    corpus = build_course_corpus(self.cfg, self.db, course_id)
    if not corpus["blocks"]:
        return {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    mined = self._call_miner(corpus)
    course = self.db.conn.execute(
        "SELECT code FROM courses WHERE id=?", (course_id,)).fetchone()
    src = f"mine:{_time.strftime('%Y-%m-%d')}:{course['code'] if course else course_id}"
    out = apply_mining(self.db, course_id, mined, source=src,
                       ann_ids=corpus.get("ann_ids"))
    self.stats["facts_added"] = self.stats.get("facts_added", 0) + out["facts"]
    return out
```

Caller change in `SyncEngine.run`: inside the per-course loop, after `sync_syllabus` and image caching, call `self.run_extraction_queue(course["id"])` then `mine_course(course["id"])` (gated, no force); accumulate counts, append one sync-log line per course with nonzero counts. Remove the `_extraction_bg` detached spawn from `run()` (keep the method for manual `extract` use). In the same task, fix `DB.upsert_assignment` (`sync/db.py`): the existing-row UPDATE must use `due_at=COALESCE(?, due_at), weight=COALESCE(?, weight)` so a Brightspace `NULL` never wipes a mined backfill (registrar non-NULL values still win). `digest_and_log` itself is replaced by the deterministic renderer from Task 7 (its LLM prompt, backlog passes, and per-fact attribution disappear with it — mining attributes per-course by construction). CLI in `sync/__main__.py`: add `mine --backfill [--code X]` that loads Config/DB (no D2L client needed), calls `mine_course(..., force=True)` per course, then `regenerate_cards`, prints counts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_mine_course_applies_without_llm_leak -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/sync.py sync/__main__.py tests/test_mine.py
git commit -m "feat: wire per-course mining into sync plus backfill CLI"
```

### Task 6: Memory-card noise filter + grading-first ordering

**Files:**

- Modify: `agent/memory.py:40-110` (`build_card` facts query + bullet assembly)
- Test: `tests/test_mine.py` (append card test)

**Interfaces:**

- Consumes: `is_noise_fact` from Task 1; existing `DB`, `Config`.
- Produces: same `build_card(cfg, db, course_id) -> str` signature, new behavior — the facts query is widened to include `scheduling`, `exam`, and `assignment` categories (the current `IN` list drops them, so mined dates would never surface); noise facts excluded in Python (not SQL), bullets ordered grading → exam → scheduling → course-policy → prof-note → general → logistics, grading facts keep full 300 chars (others 140).

- [ ] **Step 1: Write the failing test**

```python
def test_card_skips_noise_and_orders_grading_first(db_path):
    import os
    os.environ["CAMPUS_DB"] = str(db_path)
    from sync.config import Config
    from sync.db import DB
    from agent.memory import build_card
    cfg = Config.load()
    db = DB(db_path)
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute("DELETE FROM memory_facts WHERE course_id=?", (course["id"],))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Chapter 01 slides were added to Brightspace Content.", "general", 0.6, "t"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Midterm is worth 20%; final 45%; pass needs 50% on the final.", "grading", 0.9, "t"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab sessions begin the week of 2026-09-21.", "scheduling", 0.8, "t"))
    db.conn.commit()
    card = build_card(cfg, db, course["id"])
    assert "slides were added" not in card
    assert "Midterm is worth 20%" in card
    assert "week of 2026-09-21" in card
    assert card.index("Midterm is worth 20%") < card.index("week of 2026-09-21")
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_card_skips_noise_and_orders_grading_first -v`
Expected: FAIL ("slides were added" still in card).

- [ ] **Step 3: Write minimal implementation**

```python
# in agent/memory.py build_card — widen the facts query, then replace the loop:
_CATC = {"grading": 0, "exam": 1, "scheduling": 2, "course-policy": 3,
         "prof-note": 4, "general": 5, "logistics": 6, "assignment": 7}
facts = db.conn.execute(
    """SELECT f.fact, f.category, f.created_at, c.term
       FROM memory_facts f JOIN courses c ON c.id = f.course_id
       WHERE f.course_id=? AND f.is_active=1 AND f.category IN
             ('course-policy','prof-note','logistics','grading','general',
              'scheduling','exam','assignment')
       ORDER BY f.id DESC LIMIT 30""", (course_id,)).fetchall()
cutoff = ...
ranked = sorted(facts, key=lambda f: (_CATC.get(f["category"], 9), -(len(f["fact"] or ""))))
for f in ranked:
    from sync.mine import is_noise_fact
    if is_noise_fact(f["fact"]):
        continue
    ...same term_is_past + TTL gates (unchanged)...
    limit = 300 if f["category"] == "grading" else 140
    bullets.append(f"- [{f['category']}] {f['fact'][:limit]}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_card_skips_noise_and_orders_grading_first -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/memory.py tests/test_mine.py
git commit -m "feat: filter mining noise from memory card, grading first"
```

### Task 7: Deterministic digest (no LLM)

**Files:**

- Modify: `sync/sync.py` (replace `digest_and_log` body; delete `_undigested_chats` + `_undigested_announcements`)
- Test: `tests/test_mine.py` (append log test)

**Interfaces:**

- Consumes: per-course counts + mining results from Task 5's `run()` loop.
- Produces:
  - `render_sync_log(date_str: str, stats: dict, per_course: list[dict]) -> str` — pure function, no I/O, no LLM. `per_course` entries are `{"code": str, "files_new": int, "files_changed": int, "announcements_new": int, "mined": {"facts","events","exams","assignments"}}`.
  - `digest_and_log(run_id, courses, mining: dict[int, dict])` — renders via `render_sync_log`, writes `sync_logs/YYYY-MM-DD.md`, updates `sync_runs.log_path`. Signature change is internal (only `run()` calls it).

Rules (locked): zero model involvement — the old prompt, backlog passes, and chat safety-net are deleted, not bypassed. Announcements are mined through the Task 2 corpus (and stamped by Task 4); chat facts are recorded live by the agent's existing `add_fact` tool, so no batch pass is needed. Empty syncs render `# Sync <date>` + `Nothing new in any course.`

- [ ] **Step 1: Write the failing test**

```python
def test_render_sync_log_deterministic():
    from sync.sync import render_sync_log
    md = render_sync_log("2026-09-11",
        {"files_new": 3, "files_changed": 1},
        [{"code": "SE 3352A", "files_new": 3, "files_changed": 1,
          "announcements_new": 0,
          "mined": {"facts": 4, "events": 2, "exams": 0, "assignments": 1}}])
    assert "SE 3352A" in md and "3 new" in md
    assert "mined +4 facts" in md and "+2 events" in md and "backfilled 1 assignment" in md
    assert "Nothing new" in render_sync_log("2026-09-11", {}, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mine.py::test_render_sync_log_deterministic -v`
Expected: FAIL with "render_sync_log not defined" (ImportError).

- [ ] **Step 3: Write minimal implementation**

```python
def render_sync_log(date_str: str, stats: dict, per_course: list[dict]) -> str:
    """Deterministic sync log — counts only, no LLM. Pure function."""
    lines = [f"# Sync {date_str}", ""]
    if not per_course and not any(stats.get(k, 0) for k in
                                  ("files_new", "files_changed", "announcements_new")):
        lines.append("Nothing new in any course.")
        return "\n".join(lines) + "\n"
    for c in per_course:
        parts = []
        if c.get("files_new"):
            parts.append(f"{c['files_new']} new file{'s' if c['files_new'] != 1 else ''}")
        if c.get("files_changed"):
            parts.append(f"{c['files_changed']} changed")
        if c.get("announcements_new"):
            n = c['announcements_new']
            parts.append(f"{n} announcement{'s' if n != 1 else ''}")
        m = c.get("mined") or {}
        mine_parts = []
        if m.get("facts"): mine_parts.append(f"+{m['facts']} facts")
        if m.get("events"): mine_parts.append(f"+{m['events']} events")
        if m.get("exams"): mine_parts.append(f"+{m['exams']} exams")
        if m.get("assignments"):
            n = m['assignments']
            mine_parts.append(f"backfilled {n} assignment{'s' if n != 1 else ''}")
        line = f"- {c['code']}: " + (", ".join(parts) if parts else "no changes")
        if mine_parts:
            line += " — mined " + ", ".join(mine_parts)
        lines.append(line)
    return "\n".join(lines) + "\n"
```

`digest_and_log` replacement: delete the prompt/`httpx` block, the backlog/chat queries, and the `_undigested_*` helpers; new body gathers per-course counts (files/announcements from `self.deltas` + `self.stats`, mining from the Task 5 loop), calls `render_sync_log(time.strftime('%Y-%m-%d'), self.stats, per_course)`, writes the file, updates `sync_runs.log_path`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mine.py::test_render_sync_log_deterministic -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/sync.py tests/test_mine.py
git commit -m "feat: deterministic sync digest, no LLM"
```

## Verification (deployment `home`)

1. `ssh home "cd ~/campus && python -m sync mine --backfill"` → expect per-course lines, e.g. `SE3352A: +N facts, +M events, +K exams`.
2. `sqlite3 ~/campus/data/harness.db "SELECT c.code, count(e.id) FROM courses c LEFT JOIN events e ON e.course_id=c.id GROUP BY c.id;"` → nonzero for SE3316A/SE3352A/SE3309A.
3. `sqlite3 ... "SELECT c.code, a.title, a.due_at FROM assignments a JOIN courses c ON c.id=a.course_id;"` → Lab due dates filled.
4. Open each `memory-card.md` under `/srv/homelab/school/2026F/*/` → grading line present, no "slides were added" bullets.
5. `pytest tests/test_mine.py -v` green locally before pushing.

## Self-Review

- Spec coverage: any-file mining (Tasks 2–3 corpus covers outlines/assignments/announcements/modules/other mds + on-disk html) ✓; auto-add dates (Task 4 events/exams/assignment backfill + audit) ✓; backfill now (Task 5 CLI) ✓; attribution by per-course mining (digest writes no facts anymore, Task 7) ✓; deterministic digest with zero LLM (Task 7) ✓. Reviewer round 2 (13 findings) folded in: audit actor, fuzzy match, test seeding, mining gate, outlines-first prompt, dropbox COALESCE, digest attribution, budget caps, html scope, digested_at stamping, uid normalization, card ordering test, robustness nits.
- Placeholder scan: no TBD/TODO; every step has exact code, exact test, exact command.
- Type consistency: `mined` dict shape defined once in Task 3, consumed verbatim in Tasks 4–5; `build_course_corpus`/`apply_mining`/`mine_course` signatures match across tasks.
