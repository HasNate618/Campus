"""Turn-scoped citation registry — maps harness refs to cite_ids for [cite:N] markers."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from sync.config import Config
from sync.db import DB

PAGE_RE = re.compile(r"<!--\s*page\s+(\d+)\s*-->", re.I)


def build_page_index(lines: list[str]) -> list[tuple[int, int]]:
    """(line_no, page_no) sorted by line. Content before first marker is page 1."""
    index: list[tuple[int, int]] = [(0, 1)]
    for i, line in enumerate(lines):
        m = PAGE_RE.search(line)
        if m:
            index.append((i, int(m.group(1))))
    return index


def page_at_line(index: list[tuple[int, int]], line: int) -> int:
    page = 1
    for ln, pg in index:
        if ln > line:
            break
        page = pg
    return page


def page_from_chunk_text(text: str) -> int | None:
    """Last <!-- page N --> marker inside a search snippet/chunk."""
    pages = [int(m.group(1)) for m in PAGE_RE.finditer(text)]
    return pages[-1] if pages else None


def _label_for_ref(ref: str, db: DB) -> str:
    if ref.startswith("overview/"):
        try:
            nid = int(ref.split("/")[1])
        except (IndexError, ValueError):
            return ref
        row = db.conn.execute(
            "SELECT title FROM content_nodes WHERE id=?", (nid,),
        ).fetchone()
        return row["title"] if row else ref
    name = Path(ref).name
    if name.endswith(".md"):
        name = name[:-3]
    return name or ref


def _resolve_file(db: DB, course_id: int | None, ref: str) -> tuple[int | None, int | None, str]:
    """Return (file_id, node_id, kind) for a harness ref."""
    if ref.startswith("overview/"):
        try:
            nid = int(ref.split("/")[1])
        except (IndexError, ValueError):
            return None, None, "overview"
        q = "SELECT id FROM content_nodes WHERE id=?"
        params: list = [nid]
        if course_id is not None:
            q += " AND course_id=?"
            params.append(course_id)
        row = db.conn.execute(q, params).fetchone()
        return None, row["id"] if row else nid, "overview"

    if ref.startswith("announcements/"):
        return None, None, "announcement"

    q = "SELECT id, content_node_id, path FROM files WHERE path=?"
    params = [ref]
    if course_id is not None:
        q += " AND course_id=?"
        params.append(course_id)
    row = db.conn.execute(q, params).fetchone()
    if row:
        return row["id"], row["content_node_id"], "file"

    # suffix match — refs from search may omit term prefix variants.
    # Extracted .md files are stored in the DB under their .pdf path, so also
    # try the .pdf name variant when the ref ends in .md.
    if course_id is not None:
        candidates = [Path(ref).name]
        if Path(ref).suffix.lower() == ".md":
            candidates.append(Path(ref).with_suffix(".pdf").name)
        for name in candidates:
            row = db.conn.execute(
                "SELECT id, content_node_id, path FROM files WHERE course_id=? AND path LIKE ? "
                "ORDER BY length(path) LIMIT 1",
                (course_id, f"%{name}"),
            ).fetchone()
            if row:
                return row["id"], row["content_node_id"], "file"
    return None, None, "file"


def _pdf_file_id(db: DB, course_id: int | None, md_ref: str) -> int | None:
    """When ref is extracted .md, find the original .pdf file id if synced."""
    pdf_ref = str(Path(md_ref).with_suffix(".pdf"))
    q = "SELECT id FROM files WHERE path=?"
    params: list = [pdf_ref]
    if course_id is not None:
        q += " AND course_id=?"
        params.append(course_id)
    row = db.conn.execute(q, params).fetchone()
    return row["id"] if row else None


@dataclass
class CitationRegistry:
    db: DB
    cfg: Config
    default_course_id: int | None = None
    _next_id: int = 1
    _seen: set[tuple] = field(default_factory=set)
    sources: list[dict] = field(default_factory=list)

    def _dedupe_key(self, ref: str, excerpt: str, page: int | None) -> tuple:
        return (ref, excerpt[:120], page)

    def register(
        self,
        ref: str,
        *,
        course_id: int | None = None,
        label: str | None = None,
        excerpt: str = "",
        page: int | None = None,
        line: int | None = None,
    ) -> dict | None:
        cid = course_id if course_id is not None else self.default_course_id
        key = self._dedupe_key(ref, excerpt, page)
        if key in self._seen:
            for s in self.sources:
                if self._dedupe_key(s["ref"], s.get("excerpt", ""), s.get("page")) == key:
                    return s
            return None
        self._seen.add(key)

        file_id, node_id, kind = _resolve_file(self.db, cid, ref)
        lbl = label or _label_for_ref(ref, self.db)
        pdf_file_id = None
        if ref.endswith(".md") and file_id:
            pdf_file_id = _pdf_file_id(self.db, cid, ref)

        cite = {
            "id": self._next_id,
            "ref": ref,
            "label": lbl,
            "excerpt": excerpt[:240],
            "page": page,
            "line": line,
            "courseId": cid,
            "fileId": pdf_file_id or file_id,
            "nodeId": node_id,
            "kind": kind,
        }
        self._next_id += 1
        self.sources.append(cite)
        return cite

    def _page_for_path(self, ref: str, line: int | None, text: str | None = None) -> int | None:
        pg = page_from_chunk_text(text or "")
        if pg is not None:
            return pg
        if line is None or ref.startswith("overview/"):
            return None
        root = Path(self.cfg.data_root).resolve()
        full = (root / ref).resolve()
        if not full.is_file():
            sibling = full.with_suffix(".md")
            if sibling.is_file():
                full = sibling
            else:
                return None
        try:
            lines = full.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return None
        idx = build_page_index(lines)
        return page_at_line(idx, line)

    def register_from_tool(self, tool: str, result: dict, args: dict | None = None) -> list[dict]:
        if not isinstance(result, dict) or result.get("error"):
            return []
        args = args or {}
        out: list[dict] = []

        if tool == "search_corpus":
            for hit in result.get("hits") or []:
                ref = hit.get("ref")
                if not ref:
                    continue
                text = hit.get("text") or ""
                cite = self.register(
                    ref,
                    course_id=hit.get("course_id"),
                    excerpt=text,
                    page=page_from_chunk_text(text),
                )
                if cite:
                    out.append(cite)

        elif tool == "content_read_file":
            ref = result.get("path")
            if not ref:
                return out
            offset = int(result.get("offset") or 0)
            content = result.get("content") or ""
            chunk_lines = content.splitlines()
            page = self._page_for_path(ref, offset, content)
            cite = self.register(
                ref,
                excerpt=content[:240],
                page=page,
                line=offset if chunk_lines else None,
            )
            if cite:
                out.append(cite)

        elif tool == "content_grep":
            for m in result.get("matches") or []:
                ref = m.get("path")
                if not ref:
                    continue
                snippet = m.get("snippet") or ""
                line = m.get("line")
                if line is None and ":" in snippet:
                    # rg format sometimes lands in snippet — best-effort skip
                    pass
                page = self._page_for_path(ref, line, snippet) if line is not None else page_from_chunk_text(snippet)
                cite = self.register(ref, excerpt=snippet, page=page, line=line)
                if cite:
                    out.append(cite)

        return out

    def annotate_result(self, tool: str, result: dict, new_cites: list[dict]) -> dict:
        """Attach cite_ids to tool JSON the model sees."""
        if not new_cites or not isinstance(result, dict) or result.get("error"):
            return result
        annotated = dict(result)
        annotated["sources"] = [
            {"cite_id": c["id"], "ref": c["ref"], "label": c["label"],
             **({"page": c["page"]} if c.get("page") else {})}
            for c in new_cites
        ]
        return annotated


def resolve_ref(db: DB, course_id: int, ref: str) -> dict | None:
    """Map a harness ref to UI navigation targets."""
    file_id, node_id, kind = _resolve_file(db, course_id, ref)
    if kind == "overview" and node_id:
        return {"kind": "overview", "courseId": course_id, "nodeId": node_id}
    if file_id:
        pdf_id = _pdf_file_id(db, course_id, ref) if ref.endswith(".md") else None
        return {
            "kind": "file",
            "courseId": course_id,
            "fileId": pdf_id or file_id,
            "nodeId": node_id,
            "ref": ref,
            "isPdf": bool(pdf_id or ref.lower().endswith(".pdf")),
        }
    if kind == "announcement":
        return {"kind": "announcement", "courseId": course_id, "ref": ref}
    return None
