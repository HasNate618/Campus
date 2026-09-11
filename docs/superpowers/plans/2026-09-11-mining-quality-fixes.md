# Mining Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the audit findings from the first autonomous backfill: ban recurring-meeting calendar events, surface backfilled due dates on the calendar, add miner provenance, flag date conflicts, harden corpus/prompt/matching, clean card rendering, retire legacy noise facts, and resolve the SE3316A lab-date conflict.

**Architecture:** All fixes stay inside the existing mining pipeline (`sync/mine.py` helpers + `SyncEngine` wiring + `agent/memory.py` card). No new tables, no new dependencies, no model changes. Prompt rules and code gates change together so neither relies on the other alone.

**Tech Stack:** Python 3.12, SQLite (WAL), pytest, `opencode-go/mimo-v2.5` via bifrost (unchanged). Live verification runs inside the `campus` container on `home` (`docker exec campus ...`); the host venv cannot install packages.

## Global Constraints

- Python 3.12, no new dependencies (stdlib + already-vendored httpx/pyyaml only).
- TDD: failing test first for every code change; full suite green before each commit.
- Run tests with `.venv/bin/python -m pytest` from the repo root.
- One commit per task, only the files that task lists.
- Never re-download or re-extract; backfill-safe (re-runs write nothing new).
- Live-data steps run read-only first (SELECT), then write with audit; exact container commands are given per task.

## File Map

- `sync/mine.py` — owns: `MINER_SYSTEM`, `parse_miner_output`, `apply_mining`, `build_course_corpus`, `_norm_title`, `is_noise_fact`. Gains: `_insert_event`, `_fact_mentions_date`, `_titles_match`, `_truncate_blocks`, `retire_noise_facts`, `_outline_year`.
- `sync/sync.py` — owns: `SyncEngine.course_has_mining_deltas/_call_miner/mine_course/mine_main/render_sync_log`. Gains: raw-output stash, block-guarded prompt, `--clean` flag handling.
- `agent/memory.py` — owns: `build_card`. Gains: word-boundary clip.
- `tests/test_mine.py` — append all new tests (reuses `cfg`, `db`, `MagicMock` patterns already in the file).

## As-built deviations (folded during implementation)

- Task 4 `_fact_mentions_date` is three-way: fact mentions the due date → consistent; fact mentions a DIFFERENT date (month name or ISO date only — numeric `10/23` is indistinguishable from scores like `8/10`) → conflict; fact mentions no date at all → silent, never flagged. (The two-way version flagged every dateless fact, e.g. the evaluation breakdown.)
- Task 5 `_outline_year` reads the FILENAME only — the `2026F/` directory prefix matches `2026` and tied every file (caught by the Task-5 test).
- Task 10 gap: round-1 backfills already filled `due_at`, so re-runs never touch them — no `mine-conflict` rows and no backfill events exist for Labs 1-4. Step 1 therefore scans live `assignments`+`memory_facts` read-only with the Task-4 helpers instead of querying `mine-conflict`; Step 3 must INSERT the calendar event when none exists (not just UPDATE).
- Task 9 `retire_noise_facts` uses two static SELECTs (no dynamic SQL construction).
- Task 8 clip test uses a programmatic >140-char fact with the cut provably inside a long word (hand-counted windows were off by one twice).

---

### Task 1: Ban class/personal events (prompt + parser + applier)

**Files:**

- Modify: `sync/mine.py` (`MINER_SYSTEM`, `parse_miner_output` events loop, `apply_mining` events loop)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: existing event dicts `{title, starts_at, kind, ...}`.
- Produces: parser drops `kind in ("class", "personal")`; applier skips them too (defense in depth). Later tasks rely on events containing only `assignment`/`exam` kinds.

- [ ] **Step 1: Write the failing tests**

```python
def test_parser_rejects_class_and_personal_events():
    from sync.mine import parse_miner_output
    raw = ('{"facts": [], "events": ['
           '{"title": "Lecture", "starts_at": "2026-09-16T12:30", "kind": "class", "confidence": 0.9}, '
           '{"title": "Dentist", "starts_at": "2026-09-17", "kind": "personal", "confidence": 0.9}, '
           '{"title": "Lab 1 due", "starts_at": "2026-09-18", "kind": "assignment", "confidence": 0.9}], '
           '"exams": [], "assignment_updates": []}')
    out = parse_miner_output(raw)
    assert [e["title"] for e in out["events"]] == ["Lab 1 due"]


def test_apply_skips_class_events_even_if_parsed(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    mined = {"facts": [], "events": [
        {"title": "Lecture", "starts_at": "2026-09-16T12:30", "kind": "class"}],
        "exams": [], "assignment_updates": []}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["events"] == 0
    assert db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_parser_rejects_class_and_personal_events tests/test_mine.py::test_apply_skips_class_events_even_if_parsed -v`
Expected: FAIL (class/personal pass through today).

- [ ] **Step 3: Write minimal implementation**

In `MINER_SYSTEM`, replace `recurring class times` with `recurring class times (as facts ONLY — the timetable already exists; NEVER emit them as events)` and append `NEVER output events with kind=class or personal.` In `parse_miner_output` events loop, after kind coercion add:

```python
        if kind in ("class", "personal"):
            continue  # recurring meetings live in course_sessions, never the mined calendar
```

In `apply_mining` events loop, first line of the loop body:

```python
        if (e.get("kind") or "assignment") in ("class", "personal"):
            continue
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS (7 existing + 2 new).

- [ ] **Step 5: Delete the 2 live class duplicates (audited runbook)**

On `home`, inspect first, then delete with audit:

```bash
ssh home 'docker exec campus python3 -c "
import sqlite3
c = sqlite3.connect(\"/app/data/harness.db\")
for r in c.execute(\"SELECT id, title, starts_at FROM events WHERE kind=\x27class\x27\"):
    print(r[0], r[1], r[2])"'
```

Then for each id shown, audit + delete (repeat the middle line per id):

```bash
ssh home 'docker exec campus python3 -c "
import sqlite3, json
c = sqlite3.connect(\"/app/data/harness.db\")
row = c.execute(\"SELECT id, course_id, title, starts_at FROM events WHERE id=1\").fetchone()
c.execute(\"INSERT INTO audit_log (actor, entity, entity_id, action, detail) VALUES (\x27sync\x27,\x27events\x27,?,\x27delete-class-dupe\x27,?)\", (row[0], json.dumps({\"title\": row[2], \"starts_at\": row[3]})))
c.execute(\"DELETE FROM events WHERE id=?\", (row[0],))
c.commit()
print(\"deleted\", row[0])"'
```

Regenerate cards afterwards: `ssh home 'docker exec campus python -m sync mine --backfill --code "SE 3310A"'` (writes nothing new — dedupe holds — but refreshes the card).

- [ ] **Step 6: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: ban class/personal events from mining"
```

---

### Task 2: Backfilled due dates create calendar events

**Files:**

- Modify: `sync/mine.py` (new `_insert_event` helper; events loop uses it; backfill branch calls it)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `stable_uid`, `_norm_dt`, `db.audit` (all existing).
- Produces: `_insert_event(db, course_id, code, title, starts_at, kind="assignment", ends_at=None, notes=None) -> int | None` (row id or None on dupe/skip). Task 4 reuses its audit pattern; Task 5 relies on backfilled events existing.

- [ ] **Step 1: Write the failing test**

```python
def test_backfill_creates_assignment_event(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 2", "Build a longer page with many parts.", "brightspace"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 2", "due_at": "2026-10-09"}]}
    r1 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r1["assignments"] == 1 and r1["events"] == 1
    row = db.conn.execute(
        "SELECT title, starts_at, kind FROM events WHERE course_id=?",
        (course["id"],)).fetchone()
    assert (row["title"], row["starts_at"], row["kind"]) == ("Lab 2", "2026-10-09", "assignment")
    r2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r2 == {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_backfill_creates_assignment_event -v`
Expected: FAIL (`events == 0` — backfill writes assignments only today).

- [ ] **Step 3: Write minimal implementation**

Add the helper (dedupes exactly like the events loop does today):

```python
def _insert_event(db, course_id: int, code: str, title: str, starts_at: str,
                  kind: str = "assignment", ends_at: str | None = None,
                  notes: str | None = None) -> int | None:
    """Insert one event with normalized dedupe. Returns row id, or None on dupe/skip."""
    title = (title or "").strip()
    starts = (starts_at or "").strip()
    if not title or not starts:
        return None
    dup = db.conn.execute(
        "SELECT 1 FROM events WHERE course_id=? AND lower(title)=lower(?)"
        " AND substr(starts_at,1,10)=substr(?,1,10)",
        (course_id, title, starts)).fetchone()
    if dup:
        return None
    uid = stable_uid(code, title, _norm_dt(starts))
    cur = db.conn.execute(
        "INSERT OR IGNORE INTO events (course_id, kind, title, starts_at, ends_at, notes, ics_uid)"
        " VALUES (?,?,?,?,?,?,?)",
        (course_id, kind, title, starts, ends_at, notes, uid))
    if not cur.rowcount:
        return None
    db.audit("sync", "events", cur.lastrowid, "mine-insert",
             {"course_id": course_id, "title": title, "starts_at": starts, "uid": uid})
    return cur.lastrowid
```

Rewrite the `apply_mining` events loop body to call it (same behavior, no duplicate code):

```python
    for e in mined.get("events", []):
        if (e.get("kind") or "assignment") in ("class", "personal"):
            continue
        kind = e.get("kind") or "assignment"
        if kind not in ("assignment", "exam"):
            kind = "assignment"
        rowid = _insert_event(db, course_id, code, e.get("title"), e.get("starts_at"),
                              kind=kind, ends_at=e.get("ends_at"), notes=e.get("notes"))
        if rowid:
            res["events"] += 1
```

In the backfill branch, after `res["assignments"] += 1` and its audit, add:

```python
            if sets.get("due_at"):
                eid = _insert_event(db, course_id, code, target["title"], sets["due_at"],
                                    kind="assignment", notes="Backfilled from course materials")
                if eid:
                    res["events"] += 1
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS (existing Task-4 applier test still passes after updating its expectations: `events: 1` → `events: 2` in the r1/r2 dicts AND audit count `== 4` → `== 5`, since the backfill event adds a second `mine-insert` row).

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: backfilled due dates create calendar events"
```

---

### Task 3: Miner provenance (raw output in audit)

**Files:**

- Modify: `sync/mine.py` (`apply_mining` signature + mine-run audit row), `sync/sync.py` (`_call_miner` stashes raw, `mine_course` passes it)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `_call_miner` return (unchanged shape — raw travels via `self._last_miner_raw` so the existing monkeypatched test keeps working).
- Produces: `apply_mining(..., raw: str | None = None)`; one `mine-run` audit row per apply carrying truncated raw JSON. Task 4's conflict rows reference the same `source` string.

- [ ] **Step 1: Write the failing test**

```python
def test_apply_stores_raw_provenance(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    raw = '{"facts": [{"fact": "Final is worth 45%.", "confidence": 0.9}]}'
    apply_mining(db, course["id"], {"facts": [{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}],
                                    "events": [], "exams": [], "assignment_updates": []},
                 source="mine:test", raw=raw)
    row = db.conn.execute(
        "SELECT detail FROM audit_log WHERE action='mine-run'").fetchone()
    assert row is not None and "Final is worth 45%" in row["detail"]
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_apply_stores_raw_provenance -v`
Expected: FAIL (no `raw` parameter / no `mine-run` row today).

- [ ] **Step 3: Write minimal implementation**

Signature: `def apply_mining(db, course_id: int, mined: dict, source: str, ann_ids: list[int] | None = None, raw: str | None = None) -> dict`. At the end, before `db.conn.commit()`:

```python
    if raw:
        db.audit("sync", "mine_run", course_id, "mine-run",
                 {"source": source, "counts": res, "raw": (raw or "")[:4000]})
    db.conn.commit()
```

In `_call_miner`, stash the raw text before parsing: `self._last_miner_raw = content` (init `self._last_miner_raw = None` in `SyncEngine.__init__` next to `self.deltas`). In `mine_course`, pass `raw=getattr(self, "_last_miner_raw", None)` to `apply_mining`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py sync/sync.py tests/test_mine.py
git commit -m "feat: store raw miner output in audit for provenance"
```

---

### Task 4: Flag backfills that contradict existing facts

**Files:**

- Modify: `sync/mine.py` (new `_fact_mentions_date`; backfill branch audits conflicts)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: active `memory_facts` rows for the course; `_norm_title` (existing).
- Produces: `_titles_match(want: str, have: str) -> bool` (also used by Task 7's applier match); `_fact_mentions_date(fact: str, due_at: str) -> bool`; `mine-conflict` audit rows. Never blocks the backfill — flag, don't stop.

- [ ] **Step 1: Write the failing test**

```python
def test_backfill_conflicting_fact_is_flagged(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 3", "ReST APIs with many requirements here.", "brightspace"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab 3 is on ReST APIs due Oct 31.", "assignment", 0.9, "mine:old"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 3", "due_at": "2026-10-23"}]}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["assignments"] == 1  # still fills the NULL
    row = db.conn.execute(
        "SELECT detail FROM audit_log WHERE action='mine-conflict'").fetchone()
    assert row is not None and "Oct 31" in row["detail"]
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_backfill_conflicting_fact_is_flagged -v`
Expected: FAIL (no `mine-conflict` action today).

- [ ] **Step 3: Write minimal implementation**

```python
def _titles_match(want: str, have: str) -> bool:
    """Whole-token match: every token of the shorter title must appear as a
    whole token of the longer one. Lab 1 matches 'Lab 1 – HTML+CSS' but NOT
    'Lab 10' (a wrong due_at backfill is worse than a missing one)."""
    w, h = _norm_title(want), _norm_title(have)
    if not w or not h:
        return False
    if w == h:
        return True
    short, long = (w, h) if len(w) <= len(h) else (h, w)
    toks = set(long.split())
    return all(t in toks for t in short.split())


_MONTH_NAMES = {"01": ("jan", "january"), "02": ("feb", "february"), "03": ("mar", "march"),
                "04": ("apr", "april"), "05": ("may", "may"), "06": ("jun", "june"),
                "07": ("jul", "july"), "08": ("aug", "august"), "09": ("sep", "september"),
                "10": ("oct", "october"), "11": ("nov", "november"), "12": ("dec", "december")}


def _fact_mentions_date(fact: str, due_at: str) -> bool:
    """True when the fact text contains the due date in any common phrasing
    (10-23, 10/23, Oct 23, October 23, zero-padded variants). Unparseable due
    dates and invalid months can't be judged — never flag those."""
    m = re.match(r"^(20\d\d)-(\d\d)-(\d\d)", due_at or "")
    if not m:
        return True
    _, mo, d = m.groups()
    pair = _MONTH_NAMES.get(mo)
    if not pair:
        return True
    short, long = pair
    day = d.lstrip("0")
    if not day:
        return True
    cands = [f"{mo}-{d}", f"{mo}/{d}",
             f"{short} {day}", f"{long} {day}",
             f"{short} {d}", f"{long} {d}"]
    low = (fact or "").casefold()
    return any(c in low for c in cands)
```

In the backfill branch, after the UPDATE + `mine-backfill` audit, add:

```python
            if sets.get("due_at"):
                for fr in db.conn.execute(
                        "SELECT fact FROM memory_facts WHERE course_id=? AND is_active=1",
                        (course_id,)).fetchall():
                    if _titles_match(target["title"], fr["fact"]) and not _fact_mentions_date(fr["fact"], sets["due_at"]):
                        db.audit("sync", "assignments", target["id"], "mine-conflict",
                                 {"title": target["title"], "backfilled_due_at": sets["due_at"],
                                  "contradicting_fact": fr["fact"]})
                        print(f"  mining conflict: {target['title']} backfilled {sets['due_at']}"
                              f" vs fact: {fr['fact'][:120]}")
                        break
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: flag backfills that contradict existing facts"
```

---

### Task 5: Corpus robustness (current-term outlines first, whole-block truncation)

**Files:**

- Modify: `sync/mine.py` (`build_course_corpus` outline ordering), `sync/sync.py` (`_call_miner` uses `_truncate_blocks`)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `files.path` rows, course `term`.
- Produces: `_outline_year(rel: str) -> int`; `_truncate_blocks(blocks: list[dict], limit: int) -> list[dict]` (whole blocks only, never mid-block cuts). Task 6+ prompts keep working unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_outlines_prefer_current_term(cfg, db, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    (root / "content").mkdir(parents=True)
    (root / "old-outline-2025.md").write_text("# Old\nMidterm Oct 1 worth 10%.\n")
    (root / "new-outline-2026.md").write_text("# New\nMidterm Oct 20 worth 25%.\n")
    for rel in ("2026F/CS1100A/old-outline-2025.md", "2026F/CS1100A/new-outline-2026.md"):
        db.conn.execute(
            "INSERT INTO files (course_id, path, size, sha256, processed) VALUES (?,?,?,?,1)",
            (course["id"], rel, 10, "y" + rel))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"], excerpt_chars=40)
    assert corpus["blocks"][0]["path"].endswith("new-outline-2026.md")
    db.close()


def test_truncate_blocks_keeps_whole_blocks():
    from sync.mine import _truncate_blocks
    blocks = [{"kind": "outline", "path": "a", "text": "x" * 100},
              {"kind": "other", "path": "b", "text": "y" * 100}]
    out = _truncate_blocks(blocks, 150)
    assert [b["path"] for b in out] == ["a"]
    assert sum(len(b["text"]) for b in out) <= 150
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_outlines_prefer_current_term tests/test_mine.py::test_truncate_blocks_keeps_whole_blocks -v`
Expected: FAIL (id-order wins today; no `_truncate_blocks`).

- [ ] **Step 3: Write minimal implementation**

```python
def _outline_year(rel: str) -> int:
    years = [int(y) for y in re.findall(r"(?:19|20)\d\d", rel or "")]
    return max(years) if years else 0
```

In `build_course_corpus` step 1: collect outline candidates first, then sort by closeness of filename year to the course term year (no year = last), then `id`:

```python
    mterm = re.match(r"(\d{4})", term or "")
    term_year = int(mterm.group(1)) if mterm else 0
    cands = []
    for r in db.conn.execute(
            "SELECT id, path FROM files WHERE course_id=? ORDER BY id", (course_id,)).fetchall():
        rel = r["path"]
        if OUTLINE_NAME_RE.search(rel or "") and rel.endswith(".md"):
            y = _outline_year(rel)
            cands.append(((abs(y - term_year) if y and term_year else 999), r["id"], rel))
    cands.sort()
    outline_budget = excerpt_chars
    for _, _, rel in cands[:2]:
        if outline_budget <= 0:
            break
        text = _read_md(rel, outline_budget)
        if text.strip():
            blocks.append({"kind": "outline", "path": rel, "text": text})
            outline_budget -= len(text)
```

(`_read_md` is already defined above step 1 — reuse it unchanged.) Truncation helper:

```python
def _truncate_blocks(blocks: list[dict], limit: int) -> list[dict]:
    """Keep whole blocks within a char budget — never a mid-block cut that
    breaks the miner JSON and voids the whole course (fail shut, loudly)."""
    out, total = [], 0
    for b in blocks:
        n = len(b.get("text", ""))
        if total + n > limit:
            break
        out.append(b)
        total += n
    return out
```

In `_call_miner`, update the import to `from sync.mine import MINER_SYSTEM, _truncate_blocks, parse_miner_output`, then replace `_json.dumps(ordered[:30], indent=1)[:60000]` with:

```python
        kept = _truncate_blocks(ordered[:30], 55000)
        if not kept:
            print(f"  mining skipped for {corpus['code']}: corpus empty after truncation")
            return {"facts": [], "events": [], "exams": [], "assignment_updates": []}
        if len(kept) < len(ordered[:30]):
            print(f"  mining truncated for {corpus['code']}: {len(ordered[:30]) - len(kept)} block(s) dropped")
        prompt = (MINER_SYSTEM + f"\n\nTODAY: {corpus['today']}\nCOURSE: {corpus['code']} ({corpus['term']})\n"
                  f"CORPUS:\n{_json.dumps(kept, indent=1)}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py sync/sync.py tests/test_mine.py
git commit -m "feat: prefer current-term outlines, truncate prompts at block boundaries"
```

---

### Task 6: Enforce confidence floors in code

**Files:**

- Modify: `sync/mine.py` (`parse_miner_output` facts loop + `assignment_updates` loop)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: miner JSON (now with optional `confidence` on updates).
- Produces: facts with `confidence < 0.5` dropped; updates with `confidence < 0.7` dropped (missing defaults to 0.9, same convention as events/exams). The applier trusts parsed input (single gate, no duplication).

- [ ] **Step 1: Write the failing tests**

```python
def test_parser_drops_low_confidence_facts_and_updates():
    from sync.mine import parse_miner_output
    raw = ('{"facts": [{"fact": "Maybe the prof is nice.", "category": "prof-note", "confidence": 0.3}, '
           '{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}], '
           '"events": [], "exams": [], '
           '"assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14", "confidence": 0.4}, '
           '{"title": "Lab 2", "due_at": "2026-10-09"}]}')
    out = parse_miner_output(raw)
    assert [f["fact"] for f in out["facts"]] == ["Final is worth 45%."]
    assert [u["title"] for u in out["assignment_updates"]] == ["Lab 2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_parser_drops_low_confidence_facts_and_updates -v`
Expected: FAIL (low-confidence rows pass through today).

- [ ] **Step 3: Write minimal implementation**

Facts loop, after computing `conf`: `if conf < 0.5: continue`. Updates loop, after computing `w`:

```python
        try:
            uconf = float(u.get("confidence", 0.9))
        except (TypeError, ValueError):
            uconf = 0.0
        if uconf < 0.7:
            continue
```

Also update `MINER_SYSTEM`'s updates schema to include `"confidence": float` so the model emits it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS (existing Task-2/Task-5 tests have no-confidence updates → default 0.9 → kept).

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: enforce confidence floors for facts and assignment updates"
```

---

### Task 7: Whole-token title matching + exam dedupe alignment

**Files:**

- Modify: `sync/mine.py` (`_titles_match` helper; applier match block; exams dedupe predicate)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `_norm_title` (existing).
- Produces: `_titles_match(want: str, have: str) -> bool`. Exams dedupe on calendar date like events do.

- [ ] **Step 1: Write the failing tests**

```python
def test_titles_match_whole_tokens():
    from sync.mine import _titles_match
    assert _titles_match("Lab 1", "Lab 1 – HTML+CSS") is True
    assert _titles_match("Lab 1", "Lab 10") is False
    assert _titles_match("Midterm", "Midterm Exam") is True
    assert _titles_match("Quiz 9 (nonexistent)", "Lab 1") is False


def test_exam_dedupe_ignores_time_format(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO exams (course_id, title, starts_at, source) VALUES (?,?,?,?)",
        (course["id"], "Midterm", "2026-10-20", "manual"))
    db.conn.commit()
    out = apply_mining(db, course["id"], {
        "facts": [], "events": [],
        "exams": [{"title": "Midterm", "starts_at": "2026-10-20T09:00", "weight": None}],
        "assignment_updates": []}, source="mine:test")
    assert out["exams"] == 0
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_titles_match_whole_tokens tests/test_mine.py::test_exam_dedupe_ignores_time_format -v`
Expected: FAIL (`Lab 1` matches `Lab 10` today; time variants double-insert today).

- [ ] **Step 3: Write minimal implementation**

Reuse `_titles_match` from Task 4 (do not redefine it). Replace the applier match block (`if want == have or want in have or have in want`) with `if _titles_match(u.get("title"), a["title"])` (keep the `len(want) < 4` guard). Change the exams dedupe predicate from `AND starts_at=?` to `AND substr(starts_at,1,10)=substr(?,1,10)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS (existing `"Lab 1" → "Lab 1 – HTML+CSS"` backfill still matches via whole tokens).

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: whole-token title matching, date-level exam dedupe"
```

---

### Task 8: Card rendering (word-boundary clip + wider noise filter)

**Files:**

- Modify: `agent/memory.py` (`build_card` clip), `sync/mine.py` (`is_noise_fact`)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `is_noise_fact` (widened); facts text.
- Produces: cards never chop words, never show availability/posted notices. No signature changes.

- [ ] **Step 1: Write the failing tests**

```python
def test_noise_filter_catches_availability_notices():
    from sync.mine import is_noise_fact
    assert is_noise_fact("SE3352A course outline (outline.pdf) has been posted under Content") is True
    assert is_noise_fact("Week 1 materials are available in both PDF and PPTX formats") is True
    assert is_noise_fact("Final is worth 45%.") is False
    assert is_noise_fact("Office hours are by appointment in TEB.") is False


def test_card_clips_at_word_boundary(db, cfg):
    from agent.memory import build_card
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Midterm covers chapters one through twelve inclusive extraordinary circumstances apply.", "general", 0.9, "t"))
    db.conn.commit()
    card = build_card(cfg, db, course["id"])
    assert "inclusive" in card and "extraordinary" in card
    assert "inclusiv…" not in card and "extraordinar…" not in card
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_noise_filter_catches_availability_notices tests/test_mine.py::test_card_clips_at_word_boundary -v`
Expected: FAIL (availability phrasing passes today; clip chops mid-word).

- [ ] **Step 3: Write minimal implementation**

In `sync/mine.py`, add a second pattern OR-ed into `is_noise_fact`:

```python
_NOISE_EXTRA_RE = re.compile(
    r"\b(has been posted|have been posted|are available|is available|now includes)\b", re.I)
```

so the function returns `bool(_NOISE_RE.search(...) or _NOISE_EXTRA_RE.search(...))` (extract the existing pattern into `_NOISE_RE` unchanged). In `agent/memory.py`, add:

```python
def _clip(text: str, cap: int) -> str:
    text = text or ""
    if len(text) <= cap:
        return text
    cut = text[:cap].rsplit(" ", 1)[0] or text[:cap]
    return cut + "…"
```

and replace the single facts append in `build_card` (`bullets.append(f"- [{f['category']}] {f['fact'][:cap]}")`) with `bullets.append(f"- [{f['category']}] {_clip(f['fact'], cap)}")`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS. Then regenerate live cards to see the effect: `ssh home 'docker exec campus python -m sync mine --backfill --code "SE 3352A"'` (writes nothing — dedupe holds — but the card re-renders without the availability notices).

- [ ] **Step 5: Commit**

```bash
git add agent/memory.py sync/mine.py tests/test_mine.py
git commit -m "feat: word-boundary card clip, wider noise filter"
```

---

### Task 9: Retire legacy noise facts + `--clean` flag

**Files:**

- Modify: `sync/mine.py` (new `retire_noise_facts`), `sync/sync.py` (`mine_main --clean`)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `is_noise_fact` (widened Task 8), `db.audit` (existing).
- Produces: `retire_noise_facts(db, course_id: int | None = None) -> int` (deactivates + audits per row). One-time cleanup, never runs inside sync.

- [ ] **Step 1: Write the failing test**

```python
def test_retire_noise_facts(db):
    from sync.mine import retire_noise_facts
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "3 files were added", "general", 0.9, "sync:2026-09-10"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Final is worth 45%.", "grading", 0.9, "sync:2026-09-10"))
    db.conn.commit()
    assert retire_noise_facts(db, course["id"]) == 1
    assert db.conn.execute(
        "SELECT COUNT(*) FROM memory_facts WHERE course_id=? AND is_active=1",
        (course["id"],)).fetchone()[0] == 1
    db.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_retire_noise_facts -v`
Expected: FAIL (`retire_noise_facts` undefined).

- [ ] **Step 3: Write minimal implementation**

```python
def retire_noise_facts(db, course_id: int | None = None) -> int:
    """Deactivate active facts matching the noise filter (pre-mining digest
    debt). Audited per row so the cleanup is reversible from audit_log."""
    q = "SELECT id, course_id, fact FROM memory_facts WHERE is_active=1"
    params: list = []
    if course_id:
        q += " AND course_id=?"
        params.append(course_id)
    n = 0
    for r in db.conn.execute(q, params).fetchall():
        if is_noise_fact(r["fact"]):
            db.conn.execute("UPDATE memory_facts SET is_active=0 WHERE id=?", (r["id"],))
            db.audit("sync", "memory_facts", r["id"], "retire-noise",
                     {"fact": r["fact"][:200]})
            n += 1
    db.conn.commit()
    return n
```

In `mine_main`, change `--backfill` to `required=False` and add `ap.add_argument("--clean", action="store_true", help="retire noise facts, regen cards, exit (no mining)")`. After `args = ap.parse_args()`, insert this exact block before anything else:

```python
    if not args.backfill and not args.clean:
        ap.error("pass --backfill or --clean")
    cfg = Config.load()
    db = DB(cfg.db_path)
    if args.clean:
        from sync.mine import retire_noise_facts
        from agent.memory import regenerate_cards
        from unittest.mock import MagicMock  # noqa: F401 (kept symmetric with mining path)
        courses = [db.get_course_by_code(args.code)] if args.code else \
            db.conn.execute("SELECT * FROM courses WHERE is_active=1").fetchall()
        total = sum(retire_noise_facts(db, c["id"]) for c in courses)
        regenerate_cards(cfg, db, courses=[c["id"] for c in courses])
        print(f"retired {total} noise fact(s) across {len(courses)} course(s)")
        db.close()
        return 0
```

(the existing backfill flow follows unchanged).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS. Dry-run the flag wiring locally: `.venv/bin/python -m sync mine --help` shows `--clean`.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py sync/sync.py tests/test_mine.py
git commit -m "feat: retire legacy noise facts via mine --clean"
```

---

### Task 10: Resolve the SE3316A lab-date conflict (user-gated) — DONE 2026-09-11

**Verdict (user): backfilled dates correct.** Lab 1 Sep 25 / Lab 2 Oct 9 / Lab 3 Oct 23 / Lab 4 Nov 27. The outline fact was stale (2025 Fridays).

**Applied:** retired fact 75 (outline labs, `retire-stale`) + fact 87 (chat-added, same stale dates — its non-date content about the lab4 branch/test run is preserved in audit detail, unverified); created 4 `ensure-event` rows (labs had due_at but zero events — re-runs never touch filled assignments); card re-rendered with 0 stale dates. All rows audited with actor=`user`.

**Files:** None (live-data correction only — no code).

**Files:** None (live-data correction only — no code).
**Requires:** the user's verdict on which dates are correct (Step 1 presents the evidence; do not proceed past Step 2 without an explicit answer).

**Interfaces:**

- Consumes: Task 4's `mine-conflict` audit rows (query them to find all live conflicts, not just Lab 3/4).
- Produces: corrected `assignments.due_at`, deactivated contradicting facts, regenerated cards — all audited.

- [ ] **Step 1: List every live conflict**

```bash
ssh home 'docker exec campus python3 -c "
import sqlite3, json
c = sqlite3.connect(\"/app/data/harness.db\")
for r in c.execute(\"SELECT entity_id, detail FROM audit_log WHERE action=\x27mine-conflict\x27\"):
    d = json.loads(r[1]); print(r[0], d[\"title\"], d[\"backfilled_due_at\"], \"VS\", d[\"contradicting_fact\"][:120])"'
```

Known from the audit: Lab 3 backfilled `2026-10-23` vs outline fact "due Oct 31"; Lab 4 backfilled `2026-11-27` vs outline fact "due Dec 1". Suspicious pattern: all backfilled dates are 2026 Fridays; outline dates match 2025 weekdays (Oct 31 2025 = Friday).

- [ ] **Step 2: STOP — ask the user which dates are correct**

Present the table. Do not proceed until the user answers per assignment (outline dates vs backfilled dates). There is no safe default: a wrong `due_at` is worse than a missing one.

- [ ] **Step 3: Apply the verdict (template — fill dates from Step 2)**

For each assignment where the BACKFILL was wrong (example Lab 3, correcting to Oct 31):

```bash
ssh home 'docker exec campus python3 -c "
import sqlite3, json
c = sqlite3.connect(\"/app/data/harness.db\")
aid = c.execute(\"SELECT id FROM assignments WHERE title=\x27Lab 3\x27 AND course_id=(SELECT id FROM courses WHERE code=\x27SE 3316A\x27)\").fetchone()[0]
before = c.execute(\"SELECT due_at FROM assignments WHERE id=?\", (aid,)).fetchone()[0]
c.execute(\"UPDATE assignments SET due_at=\x27YYYY-MM-DD\x27, updated_at=datetime(\x27now\x27) WHERE id=?\", (aid,))
c.execute(\"INSERT INTO audit_log (actor, entity, entity_id, action, detail) VALUES (\x27user\x27,\x27assignments\x27,?,\x27correct-date\x27,?)\", (aid, json.dumps({\"before\": before, \"after\": \"YYYY-MM-DD\"})))
eid = c.execute(\"SELECT id, title FROM events WHERE course_id=(SELECT id FROM courses WHERE code=\x27SE 3316A\x27) AND (title=\x27Lab 3\x27 OR title LIKE \x27Lab 3 %\x27)\").fetchone()
if eid:
    from sync.mine import stable_uid, _norm_dt
    uid = stable_uid(\"SE 3316A\", eid[1], _norm_dt(\"YYYY-MM-DD\"))
    c.execute(\"UPDATE events SET starts_at=\x27YYYY-MM-DD\x27, ics_uid=?, updated_at=datetime(\x27now\x27) WHERE id=?\", (uid, eid[0]))
c.commit()
print(\"corrected\", aid)"'
```

For each assignment where the FACT was wrong (stale outline text): deactivate it with audit (`UPDATE memory_facts SET is_active=0`, `audit("user","memory_facts",id,"retire-stale",...)`). Then regenerate cards: `ssh home 'docker exec campus python -m sync mine --backfill --code "SE 3316A"'`.

- [ ] **Step 4: No commit** (no code changed). Report the outcome.

---

## Verification (whole plan)

1. `.venv/bin/python -m pytest tests/ -q` — full suite green (68 baseline + ~12 new).
2. `ssh home 'docker exec campus python -m sync mine --backfill'` — writes nothing new on a clean re-run (idempotency proof), cards re-render.
3. Calendar page shows SE3316A labs (Task 2) and no Lecture/Tutorial dupes (Task 1).
4. `SELECT action, COUNT(*) FROM audit_log WHERE date(ts)=date('now') GROUP BY action` shows `mine-run` rows with raw JSON (Task 3).
5. SE3352A card re-read: no availability/posted bullets, no mid-word chops (Tasks 8–9).

## Self-Review

- Spec coverage: class-event ban (T1) ✓ + live delete ✓; backfill→events (T2) ✓; provenance (T3) ✓; conflicts (T4) ✓; outline ordering + truncation (T5) ✓; confidence floors (T6) ✓; matching + exam dedupe (T7) ✓; card clip + noise (T8) ✓; legacy retirement (T9) ✓; lab dates user-gated (T10) ✓. Reviewer P2s adopted except facts↔events cross-dedupe and DATE_LINE_RE weekday phrasing — deliberately deferred (YAGNI: zero live cases; the corpus already surfaces those lines to the model, which canonicalizes them).
- Placeholder scan: every step has exact code/commands; T10's date template is a user-gated runbook, not a TODO (the gate is explicit in Step 2).
- Type consistency: `_insert_event` (T2) signature reused verbatim in T2's backfill call; `raw` param flows `_call_miner → mine_course → apply_mining` (T3); `_titles_match` defined once in T4 and reused by T4's conflict loop + T7's applier match; `mine-run`/`mine-conflict`/`retire-noise` action names are distinct and grep-able.
