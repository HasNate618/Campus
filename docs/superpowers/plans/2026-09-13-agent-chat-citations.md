# Agent Chat + Citation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development — one subagent per task, sequential (Tasks 1→4 share `agent/`, `sync/search.py`, `tests/`; do NOT parallelize writers). Review diff between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three verified chat complaints: (a) page citations attribute the wrong page (`p.27` for p.26 content, fabricated `page=1` for unmarked files) while the prompt orders the model to render them; (b) 24-iteration loop with the nudge at 22 and zero cross-turn memory (every follow-up re-surveys from zero); (c) 6000-char result truncation cuts big results mid-row; chips show bare `p.27`/`7` with the source hidden in a tooltip.

**Architecture:** Same agent loop, no new tables/columns (the `chat_messages.tool_name` column already exists and is never written — use it), no new deps/models. Page attribution moves from last-marker to match-position; budgets become enforceable constants; digests persist server-side; chips show source names.

**Tech Stack:** Python 3.12, SQLite (WAL), pytest, `opencode-go/mimo-v2.5` via bifrost (unchanged). Live verification in `campus` container on `home` (agent code runs in the API process — container restart required after deploy). Web has no unit runner — `npm run build` (tsc) + bundle grep is the verification.

## Global Constraints

- Python 3.12, no new dependencies, no schema changes (`chat_messages` already has `tool_name`).
- TDD: failing test first for every Python change; full suite green before each commit.
- Run tests with `.venv/bin/python -m pytest` from the repo root.
- One commit per task, only the files that task lists.
- Backfill-safe, never raise in agent paths (existing contracts preserved).
- Never fabricate page numbers: `None` (chipless page) beats a wrong page.
- Live-data steps read-only first; exact container commands per task.

## File Map

- `sync/search.py` — owns: `_snippet`, `search()` hit shape. Gains: `_snippet_ex` + `match_at` on hits (additive field only).
- `agent/citations.py` — owns: registry, `page_from_chunk_text`, `_page_for_path`, `register_from_tool`, `annotate_result`. Gains: `page_before_offset`, currentPage preference, no-marker→None.
- `agent/chat.py` — owns: loop, `MAX_ITERATIONS`/`NUDGE_AT`, 6000-char cap. Gains: 10/6 budgets, `truncate_result`, digest store/load.
- `agent/context.py` — owns: RULES prompt. Gains: rewritten 2b (chips carry pages; never prose `p.N`).
- `api/routers/chat.py` — owns: persistence (Q/A rows today). Gains: digest store after turn (guarded by session_id).
- `web/src/lib/md.ts` — owns: `chipLabel`/`chipTitle`. Gains: source-name chips.
- `tests/test_citations.py`, `tests/test_search.py`, `tests/test_mine.py` — extend (reuses FakeDb/FakeConn patterns in test_citations.py).

---

### Task 1: Match-position page attribution

**Files:**

- Modify: `sync/search.py` (`_snippet_ex`, `match_at` on the 3 hit-building sites), `agent/citations.py` (`page_before_offset`, search/read/grep branches, `_page_for_path` no-marker→None)
- Test: `tests/test_citations.py`, `tests/test_search.py` (append; update `test_register_from_search_hit` expectation)

**Interfaces:**

- Consumes: hit `{ref, course_id, text, score}` + `result.currentPage` (already computed by `content_read_file`, discarded today).
- Produces: `page_before_offset(text, at) -> int | None`; hits carry `match_at: int` (-1 when no verbatim match). Later tasks rely on `page=None` meaning "unattributable".

- [ ] **Step 1: Write the failing tests**

```python
def test_page_before_offset_uses_preceding_marker():
    from agent.citations import page_before_offset
    text = "intro\n<!-- page 2 -->\nmatched phrase\n<!-- page 3 -->\nend"
    at = text.index("matched phrase")
    assert page_before_offset(text, at) == 2
    assert page_before_offset(text, -1) == 2  # no offset: first marker
    assert page_before_offset("no markers here", 5) is None


def test_search_hit_carries_match_offset():
    # search() itself needs embeddings — test at the unit level:
    from sync.search import _snippet_ex
    text = "x" * 500 + "needle phrase here" + "y" * 500
    snip, at = _snippet_ex(text, "needle phrase")
    assert "needle phrase" in snip and at >= 0 and snip[at:at + 13] == "needle phrase"


def test_read_file_prefers_current_page():
    from agent.citations import CitationRegistry
    # FakeDb/FakeConn pattern from test_registry_dedupes_same_ref
    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)
    cites = reg.register_from_tool("content_read_file", {
        "path": "2026F/CS1100A/content/a.md", "offset": 0,
        "content": "a\n<!-- page 5 -->\nzzz\n<!-- page 9 -->\nend",
        "currentPage": 5})
    assert cites and cites[0]["page"] == 5
```

(Define the shared FakeDb/FakeConn once at module top if missing — check the file; `test_register_from_search_hit` defines them inline per-test today. Also read that test fully: its hit has no `match_at` and its text's expectation encodes last-marker — update it to expect preceding-marker with an explicit `match_at`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_citations.py -q`
Expected: FAIL (no `page_before_offset`/`_snippet_ex`; read_file ignores currentPage).

- [ ] **Step 3: Write minimal implementation**

`sync/search.py` (keep `_snippet(text, query) -> str` signature + behavior for the 2 existing tests):

```python
def _snippet_ex(text: str, query: str, width: int = 240) -> tuple[str, int]:
    """(snippet, match_at): match_at is the char offset of the query match
    inside the snippet, or -1 when there is no verbatim match."""
    q = (query or "").strip().lower()
    i = text.lower().find(q) if q else -1
    if i < 0:
        return text[:400], -1
    start = max(0, i - width // 2)
    end = min(len(text), i + len(q) + width // 2)
    snip = f"{'…' if start > 0 else ''}{text[start:end]}{'…' if end < len(text) else ''}"
    return snip, (i - start + (1 if start > 0 else 0))


def _snippet(text: str, query: str, width: int = 240) -> str:
    return _snippet_ex(text, query, width)[0]
```

(Verify `_snippet` output is byte-identical to today: same slicing + ellipsis — the existing tests lock this. Then attach `match_at` at the 3 hit-building sites: `"text": _snippet(...)` → build via `_snippet_ex` once per site:
`snip, at = _snippet_ex(r["text"], query)` then `"text": snip, "match_at": at`.)

`agent/citations.py`:

```python
def page_before_offset(text: str, at: int | None) -> int | None:
    """Page governing char offset `at`: last `<!-- page N -->` strictly
    before it. No markers → None (never fabricate). at<0/None → first
    marker's page (mirrors build_page_index's pre-marker convention)."""
    marks = [(m.start(), int(m.group(1))) for m in PAGE_RE.finditer(text or "")]
    if not marks:
        return None
    if at is None or at < 0:
        return marks[0][1]
    page = 1
    for pos, pg in marks:
        if pos < at:
            page = pg
        else:
            break
    return page
```

Hmm — `page = 1` default vs None when all markers follow `at`: build_page_index seeds pre-marker content as page 1, so default 1 is convention-consistent (markers exist, content precedes them all). Keep `page = 1`.

Branches:

- search: `page=page_before_offset(text, hit.get("match_at", -1))`.
- read_file: `page = result.get("currentPage"); if page is None: page = self._page_for_path(ref, offset, content)`.
- grep: unchanged code path (already line-positional), BUT `_page_for_path` gains the no-marker guard:

```python
        try:
            lines = full.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return None
        if not any(PAGE_RE.search(ln) for ln in lines):
            return None  # unmarked file: unattributable, not page 1
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_citations.py tests/test_search.py -q`
Expected: all PASS (update `test_register_from_search_hit` + keep `test_page_from_chunk_text_uses_last_marker` — the helper stays for fallback paths).

- [ ] **Step 5: Commit**

```bash
git add sync/search.py agent/citations.py tests/test_citations.py tests/test_search.py
git commit -m "feat: attribute citation pages by match position"
```

---

### Task 2: Enforceable loop budget + Rule 2/2b rewrite

**Files:**

- Modify: `agent/chat.py` (constants), `agent/context.py` (rule 2b)
- Test: `tests/test_mine.py` (append — no agent test file exists; follow the plan pattern of pinning down behavior)

**Interfaces:**

- Consumes: nothing new.
- Produces: `MAX_ITERATIONS = 10`, `NUDGE_AT = 6`. Prompt never orders prose page numbers.

- [ ] **Step 1: Write the failing test**

```python
def test_chat_loop_budget_is_enforceable():
    import agent.chat as chat_mod
    assert chat_mod.MAX_ITERATIONS == 10
    assert chat_mod.NUDGE_AT == 6
    assert chat_mod.NUDGE_AT < chat_mod.MAX_ITERATIONS - 2  # nudge leaves room to comply
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_chat_loop_budget_is_enforceable -v`
Expected: FAIL (24/22 today).

- [ ] **Step 3: Write minimal implementation**

`agent/chat.py`: `MAX_ITERATIONS = 10`, `NUDGE_AT = 6  # after this many rounds, tell the model to stop calling tools`. Nothing else in the loop changes (the nudge mechanics already exist).

`agent/context.py`: replace rule 2b with:

```
2b. The citation system attributes pages automatically (see the `page` field in
    tool "sources") and the chip renders source + page itself. NEVER write page
    numbers in prose — no "[cite:1, p.59]", no "on page 59". State the fact with
    a bare [cite:N] chip only.
```

(Keep rule 2 verbatim. The old 2b's `[cite:1, p.59]` example directly contradicts rule 2 — that contradiction is the bug.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/chat.py agent/context.py tests/test_mine.py
git commit -m "feat: enforce chat tool budget, chips own page display"
```

---

### Task 3: Cross-turn tool memory via `chat_messages.tool_name`

**Files:**

- Modify: `agent/chat.py` (`store_turn_digest`, `load_turn_digest`, `run_turn` accepts prior context), `api/routers/chat.py` (store after turn, load before turn)
- Test: `tests/test_mine.py` (append — sqlite tmp DB; no server needed)

**Interfaces:**

- Consumes: `chat_messages(session_id, role, content, tool_name)` (column exists, never written); `run_turn(..., history, ...)` (existing).
- Produces: per-turn digest rows (`role='tool'`, real tool names); next turn receives ≤2000 chars of prior findings. Skipped entirely when `session_id` is None.

- [ ] **Step 1: Write the failing tests**

```python
def test_turn_digest_roundtrip(tmp_path):
    import sqlite3
    from agent.chat import store_turn_digest, load_turn_digest
    dbp = tmp_path / "t.db"
    conn = sqlite3.connect(dbp)
    conn.executescript(open("schema.sql").read())
    class DB:
        conn = conn
    store_turn_digest(DB(), 7, [
        {"tool": "course_map", "args": {"course": "SE 3309A"}, "result": "x" * 800},
        {"tool": "content_read_file", "args": {"path": "a.md"}, "result": "y" * 800}])
    digest = load_turn_digest(DB(), 7)
    assert "course_map" in digest and "content_read_file" in digest
    assert len(digest) <= 2000
    assert load_turn_digest(DB(), 999) == ""  # unknown session: nothing
    conn.close()


def test_turn_digest_skips_without_session(tmp_path):
    import sqlite3
    from agent.chat import store_turn_digest
    dbp = tmp_path / "t2.db"
    conn = sqlite3.connect(dbp)
    conn.executescript(open("schema.sql").read())
    class DB:
        conn = conn
    store_turn_digest(DB(), None, [{"tool": "course_map", "args": {}, "result": "x"}])
    assert conn.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 0
    conn.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_turn_digest_roundtrip tests/test_mine.py::test_turn_digest_skips_without_session -v`
Expected: FAIL (no helpers today).

- [ ] **Step 3: Write minimal implementation**

`agent/chat.py`:

```python
_DIGEST_CHARS = 2000
_PER_TOOL_CHARS = 400


def store_turn_digest(db, session_id: int | None, items: list[dict]) -> None:
    """Persist compact per-tool digests (role='tool' rows) so the next turn
    reuses findings instead of re-surveying. Skipped without session_id."""
    if session_id is None:
        return
    for it in items or []:
        res = str(it.get("result") or "")[:_PER_TOOL_CHARS]
        db.conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, tool_name)"
            " VALUES (?,?,?,?)",
            (session_id, "tool", f"args={it.get('args', {})} result={res}",
             it.get("tool", "")))
    db.conn.commit()


def load_turn_digest(db, session_id: int | None) -> str:
    """Prior turns' tool findings, newest last, capped — for injection into
    the next turn's context. '' when none."""
    if session_id is None:
        return ""
    rows = db.conn.execute(
        "SELECT tool_name, content FROM chat_messages WHERE session_id=? AND role='tool'"
        " ORDER BY id DESC LIMIT 8", (session_id,)).fetchall()
    if not rows:
        return ""
    lines = [f"- {r['tool_name']}: {(r['content'] or '')[:_PER_TOOL_CHARS]}"
             for r in reversed(rows)]
    return ("PREVIOUS TURN TOOL FINDINGS (already fetched — reuse, do not re-call):\n"
            + "\n".join(lines))[:_DIGEST_CHARS]
```

Wiring (read `run_turn` + `build_system_prompt` signatures first — ground, don't guess):

- `run_turn(..., prior_context: str = "")`: include `prior_context` in the system prompt (or as a leading system message — follow whichever the code already does for similar injections).
- `api/routers/chat.py`: after `run_turn` returns (next to the Q/A inserts, inside `if req.session_id:`): build `items` from `full_history` (assistant messages with `tool_calls` + the following `tool`-role message contents — cap 8 most recent pairs) and call `store_turn_digest(db, req.session_id, items)`; before `run_turn`: `prior = load_turn_digest(db, req.session_id)` and pass it in. Guard everything so a digest failure never breaks the turn (wrap in try/except like the reasoning-cache calls nearby).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/chat.py api/routers/chat.py tests/test_mine.py
git commit -m "feat: persist cross-turn tool digests"
```

---

### Task 4: Per-tool truncation tiers + source-name chips

**Files:**

- Modify: `agent/chat.py` (`truncate_result`), `web/src/lib/md.ts` (`chipLabel`)
- Test: `tests/test_mine.py` for the Python half (append); web verified by `npm run build` + bundle grep (no unit runner exists)

**Interfaces:**

- Consumes: tool `name` (already in the loop).
- Produces: `truncate_result(name, result) -> str`; chips read `{short label}[ p.N]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_truncate_result_tiers():
    from agent.chat import truncate_result
    assert len(truncate_result("course_map", {"x": "z" * 20000})) == 12000
    assert len(truncate_result("content_grep", {"x": "z" * 20000})) == 6000
    assert truncate_result("anything", {"error": "boom"}) == {"error": "boom"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_mine.py::test_truncate_result_tiers -v`
Expected: FAIL (no helper; inline `[:6000]` today).

- [ ] **Step 3: Write minimal implementation**

`agent/chat.py` (at the `json.dumps(result, default=str)[:6000]` site):

```python
_TOOL_RESULT_CAPS = {"course_map": 12000}


def truncate_result(name: str, result: dict) -> str:
    """Per-tool history cap: course_map is the orienting call — cutting it
    mid-row costs more calls later. Errors pass through untouched."""
    if not isinstance(result, dict) or result.get("error"):
        return result
    return json.dumps(result, default=str)[:_TOOL_RESULT_CAPS.get(name, 6000)]
```

`web/src/lib/md.ts`:

```ts
function shortLabel(s: string, n = 28): string {
  const t = (s || '').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** Chip shows the source, not a bare number: "se3316a-2025-00-intro-course p27". */
function chipLabel(c: CitationMeta, id: number): string {
  const base = shortLabel(c.label || c.ref)
  if (c.page != null && c.page > 0) return `${base} p.${c.page}`
  return base || String(id)
}
```

(Backend `_label_for_ref` already strips `.md` and resolves `overview/` node titles like "Guide Documents" — no backend change needed. Keep `chipTitle` as the full tooltip.)

- [ ] **Step 4: Run tests + build to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_mine.py -q` (all PASS), then `cd web && npm run build 2>&1 | tail -2` (tsc clean) and `grep -c "shortLabel" dist/assets/index-*.js` (≥1 — proves the chip code shipped).

- [ ] **Step 5: Commit**

```bash
git add agent/chat.py web/src/lib/md.ts tests/test_mine.py
git commit -m "feat: truncation tiers, source-name citation chips"
```

---

### Task 5: Deploy + live verification

**Files:** None (ops + checks only — no code).
**Requires:** Tasks 1–4 pushed.

- [ ] **Step 1: Push + pull**

```bash
git push origin main && ssh home "cd ~/campus && git pull"
```

- [ ] **Step 2: Rebuild web + restart campus (agent code runs in the API process)**

```bash
cd web && npm run build && scp -qr dist home:campus/web/dist-new && ssh home 'cd ~/campus/web && mv dist dist-bak-$(date +%Y%m%d-%H%M) && mv dist-new dist && docker restart campus && sleep 8 && docker exec campus python3 -c "import agent.chat; print(agent.chat.MAX_ITERATIONS, agent.chat.NUDGE_AT)"'
```

Expected: `10 6`.

- [ ] **Step 3: Live plumbing checks (no LLM calls)**

```bash
ssh home 'docker exec -e PYTHONPATH=/app campus python3 /tmp/verify_chat.py'
```

where `/tmp/verify_chat.py` (via `docker cp`): (a) `search_corpus` hit includes `match_at` (call `sync.search.search` on "iClicker" for SE 3316A, assert key present); (b) `page_before_offset` on a real marked file snippet returns the preceding page; (c) `load_turn_digest` on an unknown session returns ""; (d) `SELECT COUNT(*) FROM chat_messages WHERE role='tool'` runs (column readable).

- [ ] **Step 4: One live model turn (smoke, not asserted)**

Pipe one question through the terminal REPL non-interactively and report (not gate): does the answer use bare `[cite:N]` chips with no prose `p.N`, and does the emitted `citations` payload carry source labels? Record the outcome in the final report whatever it is.

- [ ] **Step 5: No commit.** Report the outcome (per-task commits already cover the code).

---

## Verification (whole plan)

1. `.venv/bin/python -m pytest tests/ -q` — full suite green.
2. Session-100 replay reasoning (static): Lab 1 answer's cites would now attribute preceding pages; unmarked-file cites carry no page; follow-up turns reuse digests instead of re-running course_map.
3. Chips read `se3316a-2025-00-intro-course p27` / `Guide Documents` (label + optional page), never bare `7`.
4. No turn can exceed 10 model rounds; nudge fires at 6.

## Self-Review

- Spec coverage: match-position attribution (T1) ✓ + no-fabrication guard ✓; budget constants (T2) ✓ + prompt contradiction (T2) ✓; cross-turn digests (T3) ✓; truncation tiers (T4) ✓ + chip labels (T4) ✓; deploy + live checks (T5) ✓. Deferred deliberately: backfilling page markers to unmarked `.md`s (can't know true pagination without re-parsing PDFs — honest `None` instead); raising facts/files tool limits (fine today per the analysis); semantic turn memory (digests are extractive by design).
- Placeholder scan: every step has exact code/commands; T5's model-turn check is explicitly report-not-gate (LLM wording is non-deterministic).
- Type consistency: `match_at: int` (-1 sentinel) flows search→hits→register; `page: int | None` flows register→sources→chips; `prior_context: str` flows load→run_turn→prompt (exact injection point grounded at implementation); digest rows are `role='tool'` + real tool names, capped 400/row and 2000/turn.
- Test arithmetic: T1 `_snippet_ex` byte-identity with `_snippet` (existing tests lock it); `test_register_from_search_hit` update is flagged for the worker to read first (its current text isn't quoted here — the worker MUST open it before editing); T3 schema.sql executes clean (chat_messages columns verified live: id, session_id, role, content, tool_name, created_at, digested_at); T4 `truncate_result` lengths exact (12000/6000/error passthrough).
