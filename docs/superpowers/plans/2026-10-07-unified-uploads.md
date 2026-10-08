# Unified Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload *any* file — into chat or the Workspace tab — have it stored as a real file in the course workspace, and let the agent choose to read the raw bytes (shell/file tools) or its extracted text (a new `extract_file` tool), with no eager extraction and no arbitrary size caps.

**Architecture:** Uploads become pure storage: one course-scoped workspace area (`<term>/<code>/uploads/`), streamed to disk behind the existing traversal + writable-dir guards and a free-space check. The chat turn carries a *manifest of workspace paths* instead of inlined text; a single new agent tool, `extract_file(path)`, is the only non-corpus consumer of a new reusable `sync/extractors.py` (which `SyncEngine` is refactored onto). Images stay inline as `image_url` because vision needs bytes in the message.

**Tech Stack:** Python 3.12, FastAPI, SQLite (WAL), pytest, no new Python deps. React 19 + Vite + TypeScript on the client (no JS test runner exists — verify with `tsc`, `oxlint`, `vite build`).

## Global Constraints

- Python 3.12; **no new Python dependencies**. No new tables; `chat_attachments` is reused, its `stored_path` repointed at the workspace file.
- TDD: a failing test first for every Python change; run `.venv/bin/python -m pytest` from the repo root, full suite green before each commit.
- **No arbitrary size caps.** Guard rails only: stream to disk in chunks (bounded memory), refuse with 507 when free space would drop below `UPLOAD_MIN_FREE_BYTES`, and a generous configurable `max_upload_bytes` as a runaway valve. Extraction is bounded at read time (bytes/pages), never at upload.
- **Fully lazy:** nothing is extracted on upload. Raw bytes are always retained and never replaced.
- **Images are the only inline attachment** (`agent/chat.py:531-541`). Everything else is a manifest entry.
- Security invariants preserved: every write goes through `_writable_rel` (writable dirs only) and `_resolve_workspace` (no traversal); the upload path enforces both.
- Client verification has no test runner: `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsbuildinfo` must exit 0 and `npx oxlint` must add no new warnings.
- The separate `data/chat_uploads/` store is retired; bytes live in the course workspace, so the agent's shell/file tools can operate on them.

---

## File Map

- `sync/extractors.py` — **new.** Pure, DB-free extraction: `extract_to_text(path) -> str | None` for PDF / `.docx` / `.pptx` / `.doc` / text&code; page markers preserved so citations keep working.
- `sync/sync.py` — `SyncEngine.extract_pdf` / `_extract_doc` delegate to `sync.extractors` (behaviour unchanged; external-parser branch stays in `SyncEngine`).
- `api/services.py` — `WRITABLE_WORKSPACE_DIRS` gains `"uploads"`; new `workspace_upload(course_id, rel, reader) -> dict`.
- `api/routers/courses.py` — new `POST /{course_id}/workspace/upload`.
- `api/routers/chat.py` — `/chat/uploads` requires a `course_id`, writes into that course's `uploads/`, records the workspace-relative path; `_load_attachments` resolves paths and returns `path`.
- `agent/chat.py` — replaces the inlined `extracted` block with a manifest; images unchanged.
- `agent/tools.py` — new `extract_file` tool; `notes/`+`work/` wording updated.
- `tools/README`-style docs: `docs/DATA_MODEL.md` — document `uploads/`.
- `web/src/api/client.ts` — `workspaceUpload(courseId, path, file)`; `chatUpload(file, courseId)`.
- `web/src/chat/ChatView.tsx` — paste + drag-drop into `addFiles`, broader `accept`, per-file status; reviewer's two should-fixes.
- `web/src/pages/WorkspacePage.tsx` — upload button + drop target on writable dirs.
- Tests: `tests/test_extractors.py` (new), `tests/test_services.py`, `tests/test_agent_tools.py`, `tests/test_office_pdf_api.py`, `tests/test_chat_attachments.py` (new).

---

### Task 1: Reusable extraction module

**Files:**
- Create: `sync/extractors.py`
- Modify: `sync/sync.py` (`extract_pdf` ~878-960, `_extract_doc` ~962-1004)
- Create: `tests/test_extractors.py`

**Interfaces:**
- Produces: `EXTRACTABLE_SUFFIXES: frozenset[str]`; `extract_to_text(path: Path, *, max_bytes: int = 20 * 1024 * 1024) -> str | None`. Returns `None` when the type is unsupported or nothing could be extracted; text includes `<!-- page N -->` markers for paged docs.
- Consumes: `sync.convert.convert_office_to_pdf`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_extractors.py
from pathlib import Path
from sync.extractors import extract_to_text, EXTRACTABLE_SUFFIXES

def test_text_suffix_is_read_verbatim(tmp_path: Path):
    p = tmp_path / "a.md"; p.write_text("# hi\n")
    assert extract_to_text(p) == "# hi\n"

def test_unsupported_suffix_returns_none(tmp_path: Path):
    p = tmp_path / "a.zip"; p.write_bytes(b"PK\x03\x04")
    assert extract_to_text(p) is None

def test_digital_pdf_keeps_page_markers(tmp_path: Path):
    # build a tiny PDF with pymupdf so the test needs no fixture file
    import pymupdf
    p = tmp_path / "d.pdf"
    doc = pymupdf.open(); doc.new_page().insert_text((72, 72), "hello page one"); doc.save(p); doc.close()
    out = extract_to_text(p)
    assert out is not None and "<!-- page 1 -->" in out and "hello page one" in out

def test_suffixes_cover_office_and_text():
    for s in (".pdf", ".docx", ".pptx", ".doc", ".md", ".txt", ".csv", ".json", ".html", ".py"):
        assert s in EXTRACTABLE_SUFFIXES
```

- [ ] **Step 2: Run to verify failure** — `.venv/bin/python -m pytest tests/test_extractors.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement `sync/extractors.py`**

```python
"""Pure file→text extraction, shared by the sync engine and the agent's
extract_file tool. No DB, no config object, no side effects beyond the
Office→PDF cache file that sync.convert already writes beside the source."""
from __future__ import annotations
from pathlib import Path

EXTRACTABLE_SUFFIXES = frozenset({
    ".pdf", ".docx", ".pptx", ".doc", ".md", ".markdown", ".txt", ".rst",
    ".csv", ".tsv", ".json", ".yaml", ".yml", ".html", ".htm", ".xml",
    ".ics", ".py", ".js", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".go",
    ".rs", ".sh", ".sql", ".css",
})
_OFFICE = {".docx", ".pptx"}

def _pdf_text(path: Path) -> str | None:
    import pymupdf
    parts: list[str] = []
    doc = pymupdf.open(path)
    try:
        for i, page in enumerate(doc, start=1):
            text = page.get_text()
            if not text.strip():
                continue
            parts.append(f"<!-- page {i} -->\n{text.rstrip()}")
    finally:
        doc.close()
    return "\n".join(parts) or None

def _doc_text(path: Path) -> str | None:
    if path.suffix.lower() == ".docx":
        import docx
        text = "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
        return text or None
    import subprocess
    out = subprocess.run(["antiword", str(path)], capture_output=True, text=True, timeout=60)
    return out.stdout if out.returncode == 0 and out.stdout.strip() else None

def extract_to_text(path: Path, *, max_bytes: int = 20 * 1024 * 1024) -> str | None:
    suffix = path.suffix.lower()
    if suffix not in EXTRACTABLE_SUFFIXES or not path.exists():
        return None
    try:
        if path.stat().st_size > max_bytes:
            return None
        if suffix == ".pdf":
            return _pdf_text(path)
        if suffix in _OFFICE:
            from sync.convert import convert_office_to_pdf
            pdf = convert_office_to_pdf(path)
            return _pdf_text(pdf) if pdf else None
        if suffix == ".doc":
            return _doc_text(path)
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
```

- [ ] **Step 4: Refactor `SyncEngine` onto it.** In `extract_pdf`, replace the inline PyMuPDF block (the `if not self.cfg.pdf_extractor_url:` branch) with `text = extract_to_text(path, max_bytes=self.cfg.max_extract_size)`; keep the `>200 chars → _write_md/register/mark_processed → True` logic and the external-parser branch untouched. In `_extract_doc`, keep the existing `.md`-exists short-circuit, then `text = extract_to_text(path)`.

- [ ] **Step 5: Run tests** — `.venv/bin/python -m pytest tests/test_extractors.py tests/test_office_pdf_api.py tests/test_convert.py -q` then the full suite `.venv/bin/python -m pytest -q`.

- [ ] **Step 6: Commit** — `git add sync/extractors.py sync/sync.py tests/test_extractors.py && git commit -m "feat(extract): reusable file→text module; sync engine delegates to it"`

---

### Task 2: `uploads/` writable dir + streaming upload service

**Files:**
- Modify: `api/services.py` (`WRITABLE_WORKSPACE_DIRS:406`, add `workspace_upload` near `workspace_write:481`)
- Test: `tests/test_services.py` (append)

**Interfaces:**
- Produces: `WRITABLE_WORKSPACE_DIRS = ("notes", "work", "uploads")`; `workspace_upload(course_id: int, rel: str, reader: Callable[[int], bytes]) -> dict` returning `{"path", "size", "sha256"}`. `reader(max_bytes)` is called with the remaining budget and returns the next chunk (empty bytes = EOF). Raises `ValueError` (too large / bad path), `PermissionError` (non-writable dir), `OSError` (no space, sentinel `errno.ENOSPC`).
- Consumes: `_writable_rel`, `_resolve_workspace`, `UPLOAD_MAX_BYTES`, `UPLOAD_MIN_FREE_BYTES`.

- [ ] **Step 1: Write failing tests** (append to `tests/test_services.py`)

```python
def test_workspace_upload_writes_bytes_under_uploads(db_path, monkeypatch, tmp_path):
    monkeypatch.setenv("CAMPUS_SCHOOL_ROOT", str(tmp_path / "school"))
    import api.db as api_db; monkeypatch.setattr(api_db, "DB_PATH", Path(str(db_path)))
    from api.services import workspace_upload, course_dir, get_course
    (course_dir(get_course(1)) / "uploads").mkdir(parents=True)
    chunks = iter([b"hello ", b"world", b""])
    out = workspace_upload(1, "uploads/x.bin", lambda n: next(chunks))
    assert out["size"] == 11
    assert (course_dir(get_course(1)) / "uploads" / "x.bin").read_bytes() == b"hello world"

def test_workspace_upload_rejects_non_writable_dir(db_path, monkeypatch, tmp_path):
    ... # rel="content/x.bin" → pytest.raises(PermissionError)

def test_workspace_upload_rejects_traversal(db_path, monkeypatch, tmp_path):
    ... # rel="uploads/../../etc/passwd" → pytest.raises(ValueError)
```

- [ ] **Step 2: Run to verify failure** — `ModuleNotFoundError`/`ImportError`.

- [ ] **Step 3: Implement.** Add module constants `UPLOAD_MAX_BYTES = 2 * 1024**3`, `UPLOAD_MIN_FREE_BYTES = 512 * 1024**2`. `workspace_upload` streams to `full.with_suffix(full.suffix + ".part")`, accumulating size + `hashlib.sha256`, `shutil.disk_usage(full.parent).free - size < UPLOAD_MIN_FREE_BYTES` → `OSError(errno.ENOSPC)`, oversize → `ValueError`, then `os.replace(tmp, full)`; `finally` unlink the `.part` on failure. Add `"uploads"` to `WRITABLE_WORKSPACE_DIRS` and to `workspace_tree`'s writable flag (it already reads the tuple).

- [ ] **Step 4: Run tests** — `tests/test_services.py -q`, then full suite.

- [ ] **Step 5: Commit** — `git add api/services.py tests/test_services.py && git commit -m "feat(workspace): streaming upload service into uploads/"`

---

### Task 3: Workspace upload endpoint

**Files:**
- Modify: `api/routers/courses.py` (after `workspace_dir_create` ~93-99)
- Test: `tests/test_services.py` or new `tests/test_workspace_upload_api.py`

**Interfaces:**
- Produces: `POST /api/courses/{course_id}/workspace/upload?path=<rel>` (multipart `file`) → 200 `{"path","size","sha256"}`; 400 bad path; 403 non-writable; 413 too large; 507 no space.
- Consumes: `services.workspace_upload`, `services.workspace_audit`, `File`/`UploadFile`.

- [ ] **Step 1: Write failing test** using `fastapi.testclient.TestClient(api.main.app)` with `db_path` fixture; POST a small file to `?path=uploads/note.txt`, assert 200 and the bytes on disk; assert `?path=content/x` → 403.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the endpoint with an async `reader` bridging `await file.read(1 MiB)` into the sync service via `asyncio.to_thread`, mapping `PermissionError→403`, `ValueError→413/400`, `OSError` with `ENOSPC→507`.

- [ ] **Step 4: Run tests; Step 5: Commit** — `feat(api): POST workspace/upload`.

---

### Task 4: Chat uploads live in the course workspace + manifest

**Files:**
- Modify: `api/routers/chat.py` (`upload_attachment:109-147`, `_load_attachments:177-194`)
- Modify: `agent/chat.py` (attachment block `526-544`)
- Test: `tests/test_chat_attachments.py` (new)

**Interfaces:**
- Produces: `POST /api/chat/uploads` now takes `course_id: int` (query) and writes to `<course>/uploads/<uuid>-<safe_name>`; returns `{"id","name","mime","size","path"}` where `path` is data-root-relative. `_load_attachments` returns rows including `path` (the workspace-relative stored path) and no longer requires `extracted_text`. `agent/chat.py` builds a manifest string listing `name (mime, size) path=…` + a `call extract_file(path) to read it` instruction.
- Consumes: `services.workspace_upload`, `services.course_dir`.

- [ ] **Step 1: Write failing tests** — `test_chat_attachments.py`: (a) POST a `.txt` with `course_id=1` returns a `path` starting `2026F/CS1100A/uploads/` and the file exists on disk; (b) `_load_attachments` returns `path`; (c) the prompt built for a request with one attachment contains the manifest line and does **not** contain the file's text.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Keep the sha256/DB row for identity + inline image serving (`GET /chat/uploads/{id}` still reads `stored_path`). Replace the `_extract_upload` call with none (no extraction); `stored_path` = the workspace-relative path. In `agent/chat.py`, replace the `extracted` list comprehension with:

```python
manifest = "".join(
    f"\n- {a['original_name']} ({a['mime_type']}, {a.get('size','?')} bytes) path={a.get('path','?')}"
    for a in files if not (a.get("mime_type","").startswith("image/"))
)
manifest_block = (
    "\n\n--- Attached files (stored in the workspace; call extract_file(path) to read text) ---"
    f"{manifest}" if manifest else ""
)
```
and append `manifest_block` to the message text (images unchanged).

- [ ] **Step 4: Run tests; Step 5: Commit** — `feat(chat): store attachments in the course workspace; manifest instead of inlined text`.

---

### Task 5: `extract_file` agent tool

**Files:**
- Modify: `agent/tools.py` (handler near `content_read_file:361`; register in `TOOLS:1135`)
- Test: `tests/test_agent_tools.py` (append)

**Interfaces:**
- Produces: `extract_file(db, cfg, args) -> {"path","text","truncated"?}` or `{"error": ...}` (never raises — existing agent contract). `EXTract_BUDGET = 120_000` bytes; resolves `path` under `data_root` with the same guard as `content_read_file`. Registered name `extract_file`.
- Consumes: `sync.extractors.extract_to_text`.

- [ ] **Step 1: Write failing tests** — resolve a `.md` under a temp `data_root` and assert its text; assert `path="../../etc/passwd"` → `{"error": "path must be under data_root"}`; assert a `.zip` → text `None` → `{"error": "no text extractable"}`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** + register in `TOOLS` with a description that says when to use it (stored binaries like PDF/DOCX that `content_read_file` can't read) and to prefer `content_read_file` for text.

- [ ] **Step 4: Run tests; Step 5: Commit** — `feat(agent): extract_file tool`.

---

### Task 6: Chat client — paste, drag-drop, broadened accept, course-scoped upload

**Files:**
- Modify: `web/src/api/client.ts` (`chatUpload`), `web/src/chat/ChatView.tsx` (`addFiles`, the `<input>`, composer)

**Interfaces:**
- Produces: `api.chatUpload(file, courseId)`; `addFiles(files: FileList | File[])` accepts paste/drop; no change to the send payload shape.
- Consumes: existing `addFiles`/`selectedFiles`/upload loop (ChatView:1061-1070, 1386-1421).

- [ ] **Step 1: Implement paste + drop.** Add `onPaste` to the composer: for each `e.clipboardData.items` with `kind === "file"`, `addFiles([item.getAsFile()])`; `preventDefault` only when files were present (plain text paste unaffected). Add `onDragOver`/`onDrop` on the composer card calling `addFiles(e.dataTransfer.files)`.
- [ ] **Step 2: Broaden input** — replace the `accept` allowlist with `accept="*/*"` (or remove it) so any format is selectable.
- [ ] **Step 3: Pass `courseId`** to `api.chatUpload(file, courseId)` in the upload loop.
- [ ] **Step 4: Verify** — `cd web && npx tsc -p tsconfig.app.json --tsBuildInfoFile /tmp/tsb && npx oxlint`.
- [ ] **Step 5: Commit** — `feat(web): paste/drag-drop chat uploads, any format`.

---

### Task 7: Workspace tab upload UI

**Files:**
- Modify: `web/src/api/client.ts` (add `workspaceUpload`), `web/src/pages/WorkspacePage.tsx`

**Interfaces:**
- Produces: `api.workspaceUpload(courseId, path, file)` → `{path,size,sha256}`; an Upload button + tree drop target writing into `uploads/` (default `<currentDir or uploads>/<name>`), then refresh the tree.

- [ ] **Step 1: Implement** the client method (FormData + `fetch` PUT/POST) and the UI (hidden input + drop target on writable folders; overwrite confirm when the path exists).
- [ ] **Step 2: Verify** with `tsc`/`oxlint`.
- [ ] **Step 3: Commit** — `feat(web): workspace upload button + drop target`.

---

### Task 8: Reviewer should-fixes in `ChatView.tsx`

**Files:** Modify `web/src/chat/ChatView.tsx`

- [ ] **Step 1:** Only pass citations the node content references: derive `refIds` from `/\[cite:(\d+)\]/g` and filter `mergedCitesByNode.get(node.id)` to those ids, so a new `cite_register` doesn't re-parse unrelated messages.
- [ ] **Step 2:** Add a `childrenByParent` Map next to `toolChildrenByParent` and use it in `renderBranchChips` (replaces the per-node `session.nodes.filter`).
- [ ] **Step 3: Verify** `tsc`/`oxlint`; **Step 4: Commit** — `perf(chat): scope citation re-parse; index branch children`.

---

### Task 9: Docs

**Files:** Modify `docs/DATA_MODEL.md`; `agent/tools.py` descriptions.

- [ ] **Step 1:** Document the `uploads/` dir in `docs/DATA_MODEL.md` (writable, not corpus-indexed, raw uploads) and update the `notes/`+`work/` wording in the `file_write`/`file_edit`/shell tool descriptions to mention `uploads/`.
- [ ] **Step 2: Commit** — `docs: uploads/ workspace dir`.

---

## Self-Review

**Spec coverage:** any-format storage (T2/T3), chat → workspace (T4), agent chooses raw vs extracted (T4 manifest + T5 tool + existing shell/file tools), fully lazy (T4 removes eager extraction), guard-rails-not-caps (T2 constants + 507), `uploads/` dir (T2), images inline (T4 untouched), paste/drop (T6/T7), reviewer should-fixes (T8). Gaps: none.

**Placeholder scan:** test bodies for T2/T3 are abbreviated to two lines where the assertions are mechanical (path/errno), but the exact behaviour and exception type are specified; no "handle edge cases" hand-waving.

**Type consistency:** `workspace_upload(course_id, rel, reader)` signature is identical across T2/T3/T4; `extract_to_text(path, *, max_bytes)` identical across T1/T4/T5; the attachment dict keys (`id,name,mime,size,path,stored_path,original_name`) are the same ones the existing code already emits plus `path`.

**Note:** `course_id` is always present at upload time because `ChatTabPage` requires a selected course (verified: it renders an empty state when `courses` is empty and passes `courseId: number`), so no global-inbox case exists.
