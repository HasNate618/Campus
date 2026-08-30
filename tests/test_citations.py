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
    cites = reg.register_from_tool(
        "search_corpus",
        {
            "hits": [
                {
                    "ref": "Winter2026/CS101/content/syllabus.md",
                    "course_id": 3,
                    "text": "<!-- page 4 -->\n48 hour email policy",
                }
            ]
        },
    )
    assert len(cites) == 1
    assert cites[0]["id"] == 1
    assert cites[0]["page"] == 4
    assert cites[0]["courseId"] == 3
