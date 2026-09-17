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

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 1)
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

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)
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

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)
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

    reg = CitationRegistry(FakeDb(), type("Cfg", (), {"data_root": "/tmp"})(), 3)
    # snippet markers alone would resolve to 12; the search-time
    # full-chunk resolution says 11 — the hit page must win.
    cites = reg.register_from_tool("search_corpus", {"hits": [{
        "ref": "2026F/SE3316A/content/f.md", "course_id": 3,
        "text": "…match here\n<!-- page 12 -->\nend",
        "match_at": 8, "page": 11}]})
    assert cites and cites[0]["page"] == 11
