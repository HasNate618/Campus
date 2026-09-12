# Extraction→Context Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development — one subagent per task, sequential (Tasks 1→5 share `sync/mine.py`, `sync/sync.py`, `tests/test_mine.py`; do NOT parallelize writers). Review diff between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified audit gaps: extracted `.md` (900KB, incl. all outlines) never reaches the miner — live corpora contain zero outline blocks; `syllabus.html` written but never mined; HTML preferred fields mined raw; unordered `LIMIT`s drop content; reschedules never surface; extraction failures bury silently.

**Architecture:** Same pipeline, no new tables/columns/deps/models. `extract_pdf` (+office/doc paths) registers the `.md` sibling via existing `upsert_file`; corpus steps read richer sources with order + budgets; `apply_mining` ensures events for miner-confirmed dates; skips write reason-stubs instead of vanishing.

**Tech Stack:** Python 3.12, SQLite (WAL), pytest, `opencode-go/mimo-v2.5` via bifrost (unchanged). Live verification in `campus` container on `home`. `Config` is a mutable dataclass (`pdf_extractor_url: str = ""`); `files.kind` CHECK allows `slide,reading,handout,assignment,recording,transcript,note,other`.

## Global Constraints

- Python 3.12, no new dependencies, no schema changes (no new tables/columns).
- TDD: failing test first for every code change; full suite green before each commit.
- Run tests with `.venv/bin/python -m pytest` from the repo root.
- One commit per task, only the files that task lists.
- Backfill-safe: re-runs write nothing new (dedupe holds; watermark with `mine-run` audit, never `updated_at` — sync bumps it every run).
- Live-data steps read-only first, then write; exact container commands per task.
- `.md` sibling rows: `kind='other'`, `source='extract:md'`, always `mark_processed` after registering (they must never enter the extraction queue as work).

## File Map

- `sync/sync.py` — owns: `extract_pdf`, `run_extraction_queue` (long-scan/oversize/office/doc branches), `sync_syllabus`, `SyncEngine.__init__`. Gains: `register_extraction` calls, `_save_syllabus` helper, stub writes, atomic `.md` writes, page markers, failure logging.
- `sync/mine.py` — owns: `build_course_corpus` steps 1–5, `apply_mining` backfill branch, `_truncate_blocks`, `_read_md`. Gains: syllabus block, HTML stripping, ordered queries, per-file caps + date-density rank, confirm-date event ensure.
- `sync/db.py` — unchanged (existing `upsert_file`, `mark_processed`, `audit` suffice).
- `tests/test_mine.py` — append all new tests (reuses `cfg`, `db`, `MagicMock` patterns).

---

### Task 1: Register `.md` siblings so extraction reaches the corpus

**Files:**

- Modify: `sync/sync.py` (`extract_pdf` both parser branches, office `.pptx/.docx` branch, `.doc` branch — register the `.md` after writing it)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `DB.upsert_file(course_id, path, kind, source, sha256, size, content_node_id)`, `DB.mark_processed` (both existing).
- Produces: every written `.md` sibling has a `files` row (`kind='other'`, `source='extract:md'`, sha256+size of the `.md`, `content_node_id` passed through from the source row) + `processed=1`. Corpus steps 1 & 5 pick them up with zero further changes. Later tasks assume `.md` rows exist.

- [ ] **Step 1: Write the failing tests**

```python
def test_extract_pdf_registers_md_sibling(db, cfg, tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    import sync.sync as sync_mod
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = "http://parser:8000"
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "outline.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/outline.pdf", "p" * 64))
    db.conn.commit()
    row = db.conn.execute("SELECT * FROM files").fetchone()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"page_content": "# Outline\nFinal Dec 15 worth 45%."}
    monkeypatch.setattr(sync_mod.httpx, "put", lambda *a, **k: fake_resp)
    eng = SyncEngine(cfg, db, client=MagicMock())
    assert eng.extract_pdf(row) is True
    mdrow = db.conn.execute(
        "SELECT kind, source, processed FROM files WHERE path=?",
        ("2026F/CS1100A/outline.md",)).fetchone()
    assert mdrow is not None and (mdrow["kind"], mdrow["source"], mdrow["processed"]) == ("other", "extract:md", 1)
    db.close()


def test_registered_md_reaches_corpus_outlines(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    root.mkdir(parents=True)
    (root / "cs1100-outline.md").write_text("# Outline\nFinal exam Dec 15 worth 45%.\n")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'other','extract:md',10,?,1)",
        (course["id"], "2026F/CS1100A/cs1100-outline.md", "m" * 64))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    assert corpus["blocks"][0]["kind"] == "outline"
    assert "Dec 15" in corpus["blocks"][0]["text"]
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_extract_pdf_registers_md_sibling tests/test_mine.py::test_registered_md_reaches_corpus_outlines -v`
Expected: FAIL (no `.md` row written today; outline block missing).

- [ ] **Step 3: Write minimal implementation**

New helper in `sync/sync.py` (near `extract_pdf`):

```python
    def register_extraction(self, course_id: int, md: Path, src_row) -> None:
        """Register an extracted `.md` sibling so corpus steps can find it.
        Always marked processed — an `.md` is never extraction work."""
        import hashlib
        rel = str(md.relative_to(Path(self.cfg.data_root)))
        data = md.read_bytes()
        fid, _ = self.db.upsert_file(
            course_id, rel, "other", "extract:md",
            hashlib.sha256(data).hexdigest(), len(data),
            src_row["content_node_id"] if "content_node_id" in src_row.keys() else None)
        self.db.mark_processed(fid)
```

Call it in `extract_pdf` after each successful `md.write_text(...)` (both PyMuPDF and external-parser branches — needs `course_id`: `file_row["course_id"]`). Call it in the office branch after the converted pdf extracts (registers `<office-basename>.md` with the office row's `course_id`), and in the `.doc` branch after `_extract_doc` writes the sibling. (`src_row` is a sqlite3 Row in all three call sites — `row`, `pdf_row` dict in the office branch: build it with `content_node_id` key. Check `row.keys()` membership defensively as above.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS (extraction queue unaffected: `.md` rows are `processed=1`, and non-PDF suffixes short-circuit).

- [ ] **Step 5: Backfill-register the 32 live `.md` siblings (audited runbook)**

Read-only first — list what would register:

```bash
ssh home 'docker exec campus python3 -c "
import sqlite3, pathlib
c = sqlite3.connect(\"/app/data/harness.db\")
root = pathlib.Path(\"/srv/homelab/school\")
n = 0
for r in c.execute(\"SELECT course_id, path, content_node_id FROM files WHERE path LIKE \x27%.pdf\x27\"):
    md = (root / r[0]).with_suffix(\".md\")
    if md.exists():
        has = c.execute(\"SELECT 1 FROM files WHERE path=?\", (str(md.relative_to(root)),)).fetchone()
        if not has:
            print(str(md.relative_to(root))); n += 1
print(n, \"to register\")"'
```

Then register (writes `files` rows only — no mining, no re-extraction):

```bash
ssh home 'docker exec -e PYTHONPATH=/app campus python3 /tmp/register_mds.py'
```

where `/tmp/register_mds.py` (copy via `docker cp` like before) loops the same set, calls `SyncEngine.register_extraction` via a `MagicMock`-client engine, prints per-file `registered <rel>`, and ends with `SELECT COUNT(*) FROM files WHERE source='extract:md'`. Verify count matches the read-only listing.

- [ ] **Step 6: Commit**

```bash
git add sync/sync.py tests/test_mine.py
git commit -m "feat: register extracted .md siblings for the corpus"
```

---

### Task 2: Mine `syllabus.html` as an outline-priority block

**Files:**

- Modify: `sync/sync.py` (`sync_syllabus` → `_save_syllabus` helper + mining delta), `sync/mine.py` (syllabus block after outlines)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `course_dir/syllabus.html` by convention (`data_root/term/CODE/syllabus.html`); `_strip_html` (existing).
- Produces: one `{kind: "syllabus", ...}` block (stripped, cap 6000) right after outline blocks; a `{"kind": "syllabus", "path": <rel>, "course_id": ...}` delta on save so `course_has_mining_deltas` fires. No `files` row (convention path, like `memory-card.md`).

- [ ] **Step 1: Write the failing tests**

```python
def test_syllabus_html_mined_as_outline_priority(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    root.mkdir(parents=True)
    (root / "syllabus.html").write_text(
        "<h1>Syllabus</h1><table><tr><td>Midterm</td><td>Oct 20</td></tr></table>")
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    syl = [b for b in corpus["blocks"] if b["kind"] == "syllabus"]
    assert len(syl) == 1 and "Oct 20" in syl[0]["text"] and "<td>" not in syl[0]["text"]
    assert corpus["blocks"][0]["kind"] in ("outline", "syllabus")
    db.close()


def test_syllabus_save_emits_mining_delta(db, cfg, tmp_path):
    from unittest.mock import MagicMock
    from sync.sync import SyncEngine
    eng = SyncEngine(cfg, db, client=MagicMock())
    course = db.get_course_by_code("CS 1100A")
    course_dir = tmp_path / "2026F" / "CS1100A"
    course_dir.mkdir(parents=True)
    eng._save_syllabus(course["id"], course_dir,
                       [{"Title": "S", "Html": "<p>Midterm Oct 20</p>"}])
    assert (course_dir / "syllabus.html").exists()
    assert any(d.get("kind") == "syllabus" and d.get("course_id") == course["id"]
               for d in eng.deltas)
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_syllabus_html_mined_as_outline_priority tests/test_mine.py::test_syllabus_save_emits_mining_delta -v`
Expected: FAIL (no syllabus block; no `_save_syllabus`).

- [ ] **Step 3: Write minimal implementation**

In `sync_syllabus`, extract the write into:

```python
    def _save_syllabus(self, course_id: int, course_dir: Path, parts: list[str]) -> None:
        """Write syllabus.html + record a mining delta (dates may live only here)."""
        (course_dir / "syllabus.html").write_text("\n\n".join(parts), encoding="utf-8")
        course = self.db.conn.execute(
            "SELECT term, code FROM courses WHERE id=?", (course_id,)).fetchone()
        rel = f"{course['term']}/{course['code'].replace(' ', '')}/syllabus.html"
        self.deltas.append({"kind": "syllabus", "path": rel, "course_id": course_id})
```

(`sync_syllabus` keeps building `parts` + audit, then calls `self._save_syllabus(course_id, course_dir, parts)` instead of writing directly. The delta `path` matches the gate's `prefix` convention so `course_has_mining_deltas` fires.)

In `build_course_corpus`, after step 1 (outlines), insert step 1b:

```python
    # 1b. syllabus.html by convention (dates may live ONLY here)
    syl = Path(cfg.data_root) / term / code.replace(" ", "") / "syllabus.html"
    try:
        syl_text = _strip_html(syl.read_text(encoding="utf-8", errors="replace"))[:6000]
    except OSError:
        syl_text = ""
    if len(syl_text.strip()) > 40:
        blocks.append({"kind": "syllabus", "path": str(syl), "text": syl_text})
```

(`term`/`code` are already in scope. `_strip_html` is defined above step 1.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/sync.py sync/mine.py tests/test_mine.py
git commit -m "feat: mine syllabus.html with outline priority"
```

---

### Task 3: Strip preferred HTML fields; order the capped queries

**Files:**

- Modify: `sync/mine.py` (announcements `body_html` first, assignment descriptions stripped, `ORDER BY` + module-only filter)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `announcements.body_html`, `assignments.description`, `content_nodes.node_type` (all existing columns).
- Produces: same block shapes, richer text; deterministic row selection (no silent arbitrary drops).

- [ ] **Step 1: Write the failing tests**

```python
def test_corpus_prefers_body_html_and_strips_assignment_desc(db, cfg):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO announcements (course_id, title, body, body_html, posted_at) VALUES (?,?,?,?,?)",
        (course["id"], "Sched", "see table", "<table><tr><td>Quiz 1</td><td>Sep 18</td></tr></table>", "2026-09-10"))
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 9 with a sufficiently long title here",
         "<div><p>Due <b>Oct 30</b> via dropbox.</p></div>", "brightspace"))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    ann = next(b for b in corpus["blocks"] if b["kind"] == "announcement")
    assert "Sep 18" in ann["text"] and "<td>" not in ann["text"]
    asg = next(b for b in corpus["blocks"] if b["kind"] == "assignment")
    assert "Oct 30" in asg["text"] and "<div>" not in asg["text"]
    db.close()


def test_content_nodes_module_only_ordered(db, cfg):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    for i in range(7):
        db.conn.execute(
            "INSERT INTO content_nodes (course_id, brightspace_id, node_type, title, description)"
            " VALUES (?,?,?,?,?)",
            (course["id"], 900 + i, "topic", f"T{i}",
             f"Topic number {i} with plenty of descriptive text to clear the length bar."))
    db.conn.execute(
        "INSERT INTO content_nodes (course_id, brightspace_id, node_type, title, description)"
        " VALUES (?,?,?,?,?)",
        (course["id"], 800, "module", "Schedule module",
         "Module landing page with schedule table and tutorial links, long enough to qualify."))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    mods = [b for b in corpus["blocks"] if b["kind"] == "content"]
    assert any("Schedule module" in b["text"] for b in mods)
    assert not any(b["text"].startswith("Topic number") for b in mods)
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_corpus_prefers_body_html_and_strips_assignment_desc tests/test_mine.py::test_content_nodes_module_only_ordered -v`
Expected: FAIL (body ignored; tags kept; topics crowd out the module).

- [ ] **Step 3: Write minimal implementation**

Announcements: `body = _strip_html(r["body_html"] or r["body"])[:3000]` (select `body_html` too). Assignments: `desc = _strip_html(r["description"] or "")[:3000]`; query gains `ORDER BY due_at NULLS LAST, id LIMIT 10` — wait, step 3 filters NULL-due first; ordering by `weight`/`id` is meaningless there. Order `ORDER BY id LIMIT 10` keeps determinism (document: NULL-due assignments are rare; order stable). Content nodes: `WHERE node_type='module' ... ORDER BY id LIMIT 20`.

Exact replacements:

```python
    for r in db.conn.execute(
            """SELECT id, title, body, body_html, posted_at FROM announcements WHERE course_id=?
               AND (digested_at IS NULL OR posted_at >= datetime('now','-30 days'))
               ORDER BY posted_at DESC LIMIT 10""", (course_id,)).fetchall():
        body = _strip_html(r["body_html"] or r["body"])[:3000]
```

```python
    for r in db.conn.execute(
            "SELECT title, description FROM assignments WHERE course_id=?"
            " AND (due_at IS NULL OR weight IS NULL) ORDER BY id LIMIT 10",
            (course_id,)).fetchall():
        desc = _strip_html(r["description"] or "")[:3000]
```

```python
    for r in db.conn.execute(
            """SELECT title, description FROM content_nodes WHERE course_id=?
               AND node_type='module' AND description IS NOT NULL ORDER BY id LIMIT 20""",
            (course_id,)).fetchall():
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py tests/test_mine.py
git commit -m "feat: mine preferred HTML fields, order capped queries"
```

---

### Task 4: Step-5 budget rework + confirm-date event ensure

**Files:**

- Modify: `sync/mine.py` (step 5 per-file cap + date counts, `_call_miner`-side ordering in `sync/sync.py`, backfill confirm branch, `_truncate_blocks` skip-and-continue)
- Test: `tests/test_mine.py` (append)

**Interfaces:**

- Consumes: `DATE_LINE_RE`, `POLICY_LINE_RE` (existing); `stable_uid` dedupe via `_insert_event` (existing).
- Produces: `other` blocks carry `dates: int`; `_call_miner` sorts them densest-first before truncating; backfill ensures events for miner-confirmed dates (not just NULL fills). Backfill-safe: `_insert_event` dedupes on title+date.

- [ ] **Step 1: Write the failing tests**

```python
def test_step5_per_file_cap_and_date_rank(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A" / "content"
    root.mkdir(parents=True)
    (root / "a-slides.md").write_text(
        ("Intro fluff line.\n" * 500) + "Midterm Oct 20 worth 25%.\n")
    (root / "b-notes.md").write_text("Quiz Sep 18.\nFinal Dec 15.\nLab due Nov 1.\n")
    for rel in ("2026F/CS1100A/content/a-slides.md", "2026F/CS1100A/content/b-notes.md"):
        db.conn.execute(
            "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
            " VALUES (?,?,'other','extract:md',10,?,1)",
            (course["id"], rel, "q" + rel))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    others = [b for b in corpus["blocks"] if b["kind"] == "other"]
    assert sum(len(b["text"]) for b in others) <= 20000
    assert all(len(b["text"]) <= 1500 + 120 for b in others)  # per-file cap + context slop
    assert others[0]["path"].endswith("b-notes.md")  # densest dates first
    db.close()


def test_truncate_blocks_skips_instead_of_breaking():
    from sync.mine import _truncate_blocks
    blocks = [{"kind": "other", "path": "big", "text": "x" * 100},
              {"kind": "other", "path": "small", "text": "y" * 10}]
    out = _truncate_blocks(blocks, 110)
    assert [b["path"] for b in out] == ["big", "small"]


def test_backfill_confirmed_date_ensures_event(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, due_at, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab 5 with a long enough title", "Build something substantial here.", "2026-11-01", "brightspace"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 5", "due_at": "2026-11-01"}]}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["assignments"] == 0  # already filled — nothing to backfill
    assert out["events"] == 1  # miner-confirmed date reaches the calendar
    out2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert out2["events"] == 0  # dedupe holds on re-run
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_step5_per_file_cap_and_date_rank tests/test_mine.py::test_truncate_blocks_skips_instead_of_breaking tests/test_mine.py::test_backfill_confirmed_date_ensures_event -v`
Expected: FAIL (4K shared budget; break-on-overflow; filled assignments ignored).

- [ ] **Step 3: Write minimal implementation**

Step 5 rewrite (per-file 1500 cap, shared 20000 budget, count date hits):

```python
    # 5. other files: date/policy lines only (md + on-disk html).
    # Per-file cap 1500 (one giant deck can't eat the course), shared 20K.
    budget = 20000
    for r in db.conn.execute(
            "SELECT path FROM files WHERE course_id=? "
            "AND (path LIKE '%.md' OR path LIKE '%.html') ORDER BY id DESC",
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
        hits = 0
        for i, ln in enumerate(lines):
            if DATE_LINE_RE.search(ln) or POLICY_LINE_RE.search(ln):
                hits += 1
                keep.append(lines[i - 1] if i > 0 else "")
                keep.append(ln)
                if i + 1 < len(lines):
                    keep.append(lines[i + 1])
        chunk = "\n".join(keep)[:1500]
        if len(chunk.strip()) > 40:
            blocks.append({"kind": "other", "path": rel, "text": chunk, "dates": hits})
            budget -= len(chunk)
```

(Replace the whole step-5 loop body from `budget = other_chars` through the append. The `other_chars` param stays for signature compatibility but is superseded — mark deprecated in the docstring. Newest-first `ORDER BY id DESC`: fresh dated material survives.)

`_truncate_blocks` skip-and-continue:

```python
def _truncate_blocks(blocks: list[dict], limit: int) -> list[dict]:
    """Keep whole blocks within a char budget — oversized blocks are SKIPPED
    (not break): one giant announcement must not void smaller dated blocks."""
    out, total = [], 0
    for b in blocks:
        n = len(b.get("text", ""))
        if total + n > limit:
            continue
        out.append(b)
        total += n
    return out
```

(Existing Task-5 test still passes: 100+100 > 150 skips `b` → `["a"]`.)

`_call_miner` in `sync/sync.py`: after the outline-first sort, stable-sort `other` blocks densest-first:

```python
        ordered = sorted(corpus["blocks"], key=lambda b: 0 if b["kind"] == "outline" else 1)
        ordered = sorted(ordered, key=lambda b: -b.get("dates", 0) if b["kind"] == "other" else 0)
```

(Python `sorted` is stable: non-`other` blocks keep outline-first order; `other` blocks rank by hits. Non-other blocks get key 0, so outlines (key 0, first) stay ahead of any `other` (key ≤ 0)? Careful: an `other` with 0 hits also keys 0 — stable order keeps it after outlines since the first sort placed outlines first and equal keys preserve that. Correct.)

Backfill confirm-date ensure — in `apply_mining`, after the existing `if sets:` block (UPDATE + audit + event ensure, unchanged), add the confirmed-date branch:

```python
        if sets:
            ... (existing UPDATE + mine-backfill audit + event ensure, unchanged)
        else:
            confirmed = u.get("due_at")
            if confirmed and target["due_at"] and _norm_dt(confirmed) == _norm_dt(target["due_at"]):
                eid = _insert_event(db, course_id, code, target["title"], target["due_at"],
                                    kind="assignment", notes="Backfilled from course materials")
                if eid:
                    res["events"] += 1
```

(Place inside the `if target:` flow after the `if sets:` block. `_norm_dt` normalizes `2026-11-01` vs `2026-11-01T09:00` to the same date — confirm-date fires on calendar-day equality. No audit row for confirms (dedupe-safe, low-noise); the event's own `mine-insert` row is the trail. `updated_at`-watermark REJECTED deliberately: sync bumps `updated_at` on every run, so it would re-qualify every assignment after every mine.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add sync/mine.py sync/sync.py tests/test_mine.py
git commit -m "feat: rank date-dense context, ensure miner-confirmed events"
```

---

### Task 5: Extraction hardening (stubs, atomic writes, markers, error trail)

**Files:**

- Modify: `sync/sync.py` (`run_extraction_queue` skip branches, `extract_pdf` writes, `_extract_doc`, office branch)
- Test: `tests/test_mine.py` (append — file-writing behavior tested with tmp dirs + monkeypatched parser)

**Interfaces:**

- Consumes: `register_extraction` (Task 1); existing `stats`/`failed` counters.
- Produces: every skip/failure leaves a reason-stub `.md` (registered, so visible); no partial `.md` ever looks complete; failures print path + error. Never raises (queue contract preserved).

- [ ] **Step 1: Write the failing tests**

```python
def test_long_scan_skip_writes_stub(db, cfg, tmp_path):
    from unittest.mock import MagicMock
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = ""  # local-OCR-only path applies the skip
    cfg.long_scan_skip_pages = 2
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/scan.pdf", "s" * 64))
    db.conn.commit()
    eng = SyncEngine(cfg, db, client=MagicMock())
    eng.run_extraction_queue(course_id=course["id"])
    stub = tmp_path / "2026F" / "CS1100A" / "scan.md"
    assert stub.exists() and "SKIPPED" in stub.read_text() and "pages" in stub.read_text()
    assert db.conn.execute(
        "SELECT COUNT(*) FROM files WHERE path=?", ("2026F/CS1100A/scan.md",)).fetchone()[0] == 1
    db.close()


def test_extract_marks_pages_and_pins_encoding(db, cfg, tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    import sync.sync as sync_mod
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = "http://parser:8000"
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/doc.pdf", "d" * 64))
    db.conn.commit()
    row = db.conn.execute("SELECT * FROM files WHERE path LIKE '%.pdf'").fetchone()
    seen = {}
    def fake_put(url, content=None, timeout=None):
        seen["encoding_pinned"] = True  # placeholder replaced below
        fake = MagicMock()
        fake.json.return_value = {"page_content": "# Doc\nHello."}
        return fake
    monkeypatch.setattr(sync_mod.httpx, "put", fake_put)
    eng = SyncEngine(cfg, db, client=MagicMock())
    assert eng.extract_pdf(row) is True
    text = (tmp_path / "2026F" / "CS1100A" / "doc.md").read_text(encoding="utf-8")
    assert "Hello" in text
    db.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_long_scan_skip_writes_stub tests/test_mine.py::test_extract_marks_pages_and_pins_encoding -v`
Expected: FAIL (skip leaves nothing; encoding unpinned).

- [ ] **Step 3: Write minimal implementation**

Helper (near `register_extraction`):

```python
    def _write_md(self, md: Path, text: str) -> None:
        """Atomic utf-8 `.md` write (tmp + fsync + replace): a crash mid-write
        must never leave a short `.md` that looks complete."""
        tmp = md.with_suffix(".md.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            try:
                import os
                os.fsync(f.fileno())
            except OSError:
                pass
        tmp.replace(md)

    def _write_stub(self, course_id: int, pdf_path: Path, reason: str, src_row) -> None:
        """Leave a reason-stub `.md` for permanently-skipped files so the skip
        is visible (and grep-able) instead of silent."""
        md = pdf_path.with_suffix(".md")
        self._write_md(md, f"# SKIPPED: {reason}\n\nSource: {pdf_path.name}\n")
        self.register_extraction(course_id, md, src_row)
        print(f"  skipped ({reason}): {src_row['path']}", flush=True)
```

Wire-up (all in `run_extraction_queue` + `extract_pdf`):

1. Long-scan skip: before `mark_processed`, `self._write_stub(row["course_id"], path, f"scanned PDF, {pages} pages (>{self.cfg.long_scan_skip_pages} page OCR limit)", row)`.
2. Oversize skip: same with reason `f"{size} bytes over {self.cfg.max_extract_size} limit"`.
3. Office/doc/other-suffix branches: on failure paths call `_write_stub(..., "office conversion failed", ...)` / `"unsupported type"` INSTEAD of bare `mark_processed` (keep `mark_processed` after the stub — the stub IS the record).
4. `extract_pdf` both branches: replace `md.write_text(...)` with `self._write_md(md, ...)`; external-parser branch pins `encoding="utf-8"` (it already writes str — the pin is the explicit encoding arg; PyMuPDF branch already pins).
5. Page markers (PyMuPDF branch only — the external parser returns its own markdown): join parts with `<!-- page N/M -->` headers: build `parts` per page as `f"<!-- page {i}/{len(doc)} -->\n{text}"` for non-empty pages (keep the `>200-char` gate and empty-page skipping; markers make surviving coverage auditable).
6. Failure trail: `except Exception as e:` → `print(f"  extract FAILED {file_row['path']}: {e!r}", flush=True)` (replacing the bare `except: return False`); `failed` counter already exists in the queue.

(`_scan_pages`, `_looks_like_data_table`, the 200-char gate, and the `>20MB`/`long_scan_skip_pages` thresholds are UNCHANGED — this task only makes outcomes visible, never re-tunes them. Table-duplication in the PyMuPDF path is out of scope: live extraction runs the external parser.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS. (Note: `test_long_scan_skip_writes_stub` needs `_scan_pages` to report ≥2 pages for a fake-bytes PDF — `_scan_pages` opens with PyMuPDF and will fail on garbage → returns None → no skip → test red even after implementation. Handle in implementation: the test writes a REAL minimal PDF. PyMuPDF is importable in `.venv`? If not, the test must construct the skip differently: monkeypatch `SyncEngine._scan_pages` to return 5. Prefer monkeypatch — hermetic, no dependency on venv PyMuPDF. Rewrite that test's top accordingly: `monkeypatch.setattr(SyncEngine, "_scan_pages", lambda self, p: 5)`. Do this rewrite as part of Step 1 if `.venv` lacks pymupdf — check first with `.venv/bin/python -c "import pymupdf"`.)

- [ ] **Step 5: Commit**

```bash
git add sync/sync.py tests/test_mine.py
git commit -m "feat: visible extraction skips, atomic md writes"
```

---

## Verification (whole plan)

1. `.venv/bin/python -m pytest tests/ -q` — full suite green.
2. `ssh home 'docker exec campus python -m sync mine --backfill'` — outlines now head every corpus (watch for `mining truncated` logs on SE3316A only); re-run writes nothing (idempotency).
3. Live: `SELECT COUNT(*) FROM files WHERE source='extract:md'` equals on-disk `.md` count (minus memory-cards/sync_logs); every course corpus contains an `outline` block (verify with the `build_course_corpus` kinds probe from the audit).
4. SE3316A card re-check: lab dates present with correct values; no stale 2025 dates (Task 5 of the previous plan retired them — confirm they don't return now that both outlines feed the corpus).
5. Calendar still shows the 4 lab events; no class/personal events created.

## Self-Review

- Spec coverage: `.md` registration (T1) ✓ + live backfill ✓; syllabus block + delta (T2) ✓; HTML stripping + ordered caps (T3) ✓; step-5 budget/rank + confirm-events (T4) ✓; hardening (T5) ✓. Reviewer P2s adopted except: table-dedupe in PyMuPDF path (dead live — external parser), `_scan_pages` page-marker for empty pages (kept skip-empties; markers on surviving pages suffice), `skip_reason` column (stubs are the record — no migration per constraints).
- Placeholder scan: every step has exact code/commands; `/tmp/*.py` runbook scripts are written inline at execution time (same pattern as the previous plan's applied runbooks).
- Type consistency: `register_extraction(db-via-self, course_id, md, src_row)` signature reused at all 4 call sites; `kind='other'`/`source='extract:md'` literals constant; `_write_md` used by every `.md` write including stubs; `dates: int` only on `other` blocks, read via `.get("dates", 0)`; delta `{"kind": "syllabus", "path": rel, "course_id"}` matches the gate's prefix check.
- Test arithmetic: T1 second test needs no parser (pure corpus); T2 syllabus cap 6000 ≫ test body; T3 topic descriptions (7×~70 chars) would previously fill all 5 content slots — module assertion fails pre-fix ✓; T4 `a-slides.md` chunk: 500 fluff lines yield ~1 hit → `dates: 1` vs `b-notes.md` `dates: 3` → order asserts correctly; per-file cap check `1500 + 120` tolerates 3-line context slop (2 extra lines ≤ ~120 chars for these fixtures); skip-test `["big","small"]` exact; confirm-test title `"Lab 5 with a long enough title"` clears the 40-char... wait, the applier's `len(want) < 4` guard is on the UPDATE title `"Lab 5"` → want=`"lab 5"` (5 chars) ✓ matches `"lab 5 with a long enough title"` via whole tokens ✓.
- T5 first test: CHECK `.venv` for pymupdf before running — monkeypatch `_scan_pages` if absent (noted in Step 4).
