"""Citation registry — page markers and cite_id assignment."""

from __future__ import annotations

from agent.citations import (
    build_page_index,
    page_at_line,
    page_from_chunk_text,
    CitationRegistry,
)


def test_page_at_line_follows_markers():
    lines = [
        "intro",
        "<!-- page 2 -->",
        "page two",
        "<!-- page 5 -->",
        "page five",
    ]
    idx = build_page_index(lines)
    assert page_at_line(idx, 0) == 1
    assert page_at_line(idx, 1) == 2
    assert page_at_line(idx, 2) == 2
    assert page_at_line(idx, 4) == 5


def test_page_from_chunk_text_uses_last_marker():
    text = "before\n<!-- page 3 -->\nmatched phrase\n<!-- page 7 -->\nend"
    assert page_from_chunk_text(text) == 7


def test_registry_dedupes_same_ref():
    class FakeConn:
        def execute(self, *a, **k):
            return self

        def fetchone(self):
            return None

    class FakeDb:
        conn = FakeConn()

    # The fakes satisfy the runtime contract (only .conn.execute/fetchone are
    # touched); they are deliberately not real DB/Config instances.
    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 1)  # type: ignore[arg-type]
    a = reg.register("Winter2026/CS101/content/a.md", excerpt="same")
    b = reg.register("Winter2026/CS101/content/a.md", excerpt="same")
    assert a is not None
    assert b is not None
    assert a["id"] == b["id"]
    assert len(reg.sources) == 1


def test_register_from_search_hit():
    class FakeConn:
        def execute(self, *a, **k):
            return self

        def fetchone(self):
            return None

    class FakeDb:
        conn = FakeConn()

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)  # type: ignore[arg-type]
    text = "<!-- page 4 -->\nmatched phrase here\n<!-- page 9 -->\ntail"
    cites = reg.register_from_tool(
        "search_corpus",
        {
            "hits": [
                {
                    "ref": "Winter2026/CS101/content/syllabus.md",
                    "course_id": 3,
                    "text": text,
                    "match_at": text.index("matched phrase"),
                }
            ]
        },
    )
    assert len(cites) == 1
    assert cites[0]["id"] == 1
    assert cites[0]["page"] == 4  # preceding marker, not the last one
    assert cites[0]["courseId"] == 3


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
    snip, at, _ = _snippet_ex(text, "needle phrase")
    assert "needle phrase" in snip and at >= 0 and snip[at:at + 13] == "needle phrase"


def test_read_file_prefers_current_page():
    from agent.citations import CitationRegistry

    class FakeConn:
        def execute(self, *a, **k):
            return self

        def fetchone(self):
            return None

    class FakeDb:
        conn = FakeConn()

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)  # type: ignore[arg-type]
    cites = reg.register_from_tool("content_read_file", {
        "path": "2026F/CS1100A/content/a.md", "offset": 0,
        "content": "a\n<!-- page 5 -->\nzzz\n<!-- page 9 -->\nend",
        "currentPage": 5})
    assert cites and cites[0]["page"] == 5


def test_chunk_page_mid_chunk_falls_back_to_first_marker():
    from agent.citations import chunk_page
    # windowed chunk starting mid-page: first visible marker is nearest
    # knowable page — never the page-1 default.
    text = "mid-page content match here\n<!-- page 12 -->\nend"
    assert chunk_page(text, text.index("match")) == 12
    assert chunk_page("no markers here", 5) is None
    assert chunk_page("<!-- page 4 -->\nmatch here", -1) == 4


def test_register_from_search_prefers_hit_page():
    from agent.citations import CitationRegistry

    class FakeConn:
        def execute(self, *a, **k):
            return self

        def fetchone(self):
            return None

    class FakeDb:
        conn = FakeConn()

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)  # type: ignore[arg-type]
    # snippet markers alone would resolve to 12; the search-time
    # full-chunk resolution says 11 — the hit page must win.
    cites = reg.register_from_tool("search_corpus", {"hits": [{
        "ref": "2026F/SE3316A/content/f.md", "course_id": 3,
        "text": "…match here\n<!-- page 12 -->\nend",
        "match_at": 8, "page": 11}]})
    assert cites and cites[0]["page"] == 11


def test_line_at_page_and_pages_in_file():
    from agent.citations import build_page_index, line_at_page, pages_in_file
    # Lines listed directly, as elsewhere in this file: `"lit\n…".splitlines()`
    # types as list[LiteralString] on a narrowed literal, which list[str] rejects.
    lines = ["title", "<!-- page 1 -->", "a", "b",
             "<!-- page 2 -->", "c", "<!-- page 3 -->", "d"]
    idx = build_page_index(lines)
    assert line_at_page(idx, 1) == 0      # pre-marker content belongs to page 1
    assert line_at_page(idx, 2) == 4
    assert line_at_page(idx, 3) == 6
    assert line_at_page(idx, 4) is None   # no such page
    assert pages_in_file(idx) == 3


def test_pages_in_file_none_without_markers():
    from agent.citations import build_page_index, pages_in_file
    idx = build_page_index(["notes", "no markers", "here"])
    assert idx == [(0, 1)]
    assert pages_in_file(idx) is None     # NOT 1 — absence is not page one


def test_lines_for_pages_spans_to_next_page_or_eof():
    from agent.citations import build_page_index, lines_for_pages
    # See the note in test_line_at_page_and_pages_in_file on listing lines.
    lines = ["<!-- page 1 -->", "a", "<!-- page 2 -->", "b", "c",
             "<!-- page 3 -->", "d"]
    idx = build_page_index(lines)
    total = len(lines)
    assert lines_for_pages(idx, 2, 2, total) == (2, 5)   # ends where page 3 begins
    assert lines_for_pages(idx, 1, 3, total) == (0, total)  # to EOF
    assert lines_for_pages(idx, 9, 9, total) is None
    assert lines_for_pages(idx, 3, 2, total) is None     # inverted


def test_lines_for_pages_rejects_an_empty_span():
    from agent.citations import build_page_index, lines_for_pages
    # Page 1 was blank and skipped during extraction, so its marker never
    # appears and page 2's marker sits on line 0. Page 1's span would be empty —
    # that must read as "not present", not as a successful empty read.
    idx = build_page_index(["<!-- page 2 -->", "a", "<!-- page 3 -->", "b"])
    assert lines_for_pages(idx, 1, 1, 4) is None


def test_bound_pages_keeps_whole_pages():
    from agent.citations import bound_pages
    lines = ["<!-- page 1 -->", "a" * 50, "<!-- page 2 -->", "b" * 50,
             "<!-- page 3 -->", "c" * 50]
    # Char arithmetic: page 1 = 66 chars, pages 1-2 = 133, pages 1-3 = 200 exactly.
    kept, pages = bound_pages(lines, 150)
    assert pages == 2 and kept[-1] == "b" * 50   # page 3 (200 chars) exceeds 150
    kept1, pages1 = bound_pages(lines, 10_000)
    assert pages1 == 3 and len(kept1) == len(lines)
    # The budget is inclusive (the cut triggers on `> budget`, not `>=`), so an
    # exactly-fitting budget keeps the last page. Pinned so a worker tuning the
    # comparison cannot silently flip the boundary.
    kept_exact, pages_exact = bound_pages(lines, 200)
    assert pages_exact == 3 and len(kept_exact) == len(lines)


def test_bound_pages_hard_cuts_an_oversized_first_page():
    from agent.citations import bound_pages
    lines = ["<!-- page 1 -->"] + ["x" * 100 for _ in range(10)]
    kept, pages = bound_pages(lines, 250)
    assert pages == 1 and 0 < len(kept) < len(lines)


# ---------------------------------------------------------------------------
# read_window — the single streaming pass every page-addressed read depends on.
# It had no direct test; it was only exercised through content_read_file.
# ---------------------------------------------------------------------------


def test_read_window_counts_every_line_and_collects_markers_whole_file():
    """The window is bounded by offset/limit, but `total` and the page index
    must describe the WHOLE file — that is what lets a large transcript report
    its real length and lets a later call page to any part of it."""
    from agent.citations import read_window

    lines = ["intro", "<!-- page 2 -->", "a", "<!-- page 5 -->", "b", "c"]
    window, total, index = read_window(lines, 2, 2)
    assert window == ["a", "<!-- page 5 -->"]     # the requested slice only
    assert total == 6                              # every line counted
    assert index == [(0, 1), (1, 2), (3, 5)]       # markers from the whole file


def test_read_window_past_the_end_still_reports_the_real_total():
    """The regression this function was written for: slicing the text made
    total_lines describe only the part that had been read, so a large file
    appeared to end early and the model could never page past it."""
    from agent.citations import read_window

    lines = [f"line {i}" for i in range(500)]
    window, total, _ = read_window(lines, 4000, 200)
    assert window == []
    assert total == 500


def test_read_window_strips_only_line_endings():
    from agent.citations import read_window

    window, total, _ = read_window(["a\r\n", "b\n"], 0, 2)
    assert window == ["a", "b"]
    assert total == 2
