"""Search pipeline units — the historically buggiest surface (exact-phrase
matching, snippet windowing, chunking, cosine). Pure functions, no network.
"""

from __future__ import annotations

import math

import pytest


def test_chunk_paragraph_aware():
    from sync.search import _chunk
    text = "para one\n\npara two\n\npara three"
    # small cap → paragraphs stay intact, split at paragraph boundaries
    chunks = _chunk(text, size=15)
    assert all(p in "\n".join(chunks) for p in ("para one", "para two", "para three"))
    # no paragraph is ever split mid-text
    for c in chunks:
        assert c.strip() in ("para one", "para two", "para three") or "\n\n" in c


def test_chunk_soft_cap_packs_small_paragraphs():
    from sync.search import _chunk
    text = "aa\n\nbb\n\ncc"
    # generous cap → all three tiny paragraphs pack into one chunk
    chunks = _chunk(text, size=50)
    assert len(chunks) == 1
    assert "aa" in chunks[0] and "cc" in chunks[0]


def test_chunk_single_huge_paragraph_stays_one():
    from sync.search import _chunk
    text = "word " * 200  # 1000 chars, no newlines — one paragraph
    chunks = _chunk(text, size=800)
    # a single paragraph is never hard-split (soft cap by design)
    assert len(chunks) == 1
    assert chunks[0] == text.rstrip()


def test_cosine():
    from sync.search import _cosine
    assert _cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert _cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert _cosine([1, 1], [1, 1]) == pytest.approx(1.0)
    assert _cosine([], []) == 0.0


def test_snippet_windows_around_match():
    """The regression that cost hours: the matched phrase sat at char 490 of
    a 627-char chunk and the flat first-400 cut it out of the snippet."""
    from sync.search import _snippet
    text = ("x" * 400) + "THE PHRASE IS HERE" + ("y" * 300)
    snip = _snippet(text, "the phrase")
    assert "THE PHRASE" in snip
    # windowed: leading ellipsis because we started past 0
    assert snip.startswith("…")
    assert snip.count("THE PHRASE") == 1


def test_snippet_short_text_no_ellipsis():
    from sync.search import _snippet
    text = "short text with the phrase here"
    snip = _snippet(text, "the phrase")
    assert "the phrase" in snip.lower()
    assert not snip.startswith("…")


def _chunks_table(db) -> None:
    """search.py creates `chunks` lazily in rebuild(); tests create it the
    same way (schema.sql intentionally leaves it out — it's an index)."""
    db.conn.execute(
        """CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id INTEGER, ref TEXT, chunk_idx INTEGER,
            text TEXT, embedding BLOB, src_hash TEXT)"""
    )
    db.conn.commit()


def _search_db(db_path) -> "DB":
    """search functions take sync.db.DB (has .conn), not a raw connection."""
    from sync.db import DB
    return DB(db_path)


def test_lexical_hits_finds_phrase(db_path):
    """A chunk containing the full query verbatim must be a phrase hit even
    when semantic ranking would bury it."""
    from sync.search import _lexical_hits
    sdb = _search_db(db_path)
    _chunks_table(sdb)

    sdb.conn.execute(
        "INSERT INTO chunks (course_id, ref, chunk_idx, text, embedding, src_hash) "
        "VALUES (1, 'overview/999', 0, ?, x'', 'test')",
        ("welcome text … Email Response Time policy says 24h … end",))
    sdb.conn.commit()
    phrase_ids, _ = _lexical_hits(sdb, 1, '"Email Response Time"')
    assert len(phrase_ids) == 1


def test_lexical_hits_strips_quotes(db_path):
    from sync.search import _lexical_hits
    sdb = _search_db(db_path)
    _chunks_table(sdb)

    sdb.conn.execute(
        "INSERT INTO chunks (course_id, ref, chunk_idx, text, embedding, src_hash) "
        "VALUES (1, 'overview/998', 0, 'The exact answer phrase lives here', x'', 'test')")
    sdb.conn.commit()
    phrase_ids, _ = _lexical_hits(sdb, 1, '“exact answer phrase”')
    assert len(phrase_ids) == 1


def test_strip_html():
    from sync.search import _strip_html
    assert _strip_html("<p>Hello <b>world</b></p>") == "Hello world"
    assert _strip_html("plain text") == "plain text"
