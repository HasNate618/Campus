"""Search pipeline units — the historically buggiest surface (exact-phrase
matching, snippet windowing, chunking, cosine). Pure functions, no network.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from sync.db import DB


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


# ---------------------------------------------------------------------------
# Same-source duplicates: the index must carry ONE copy, and must actually
# REMOVE the other. `rebuild()` only rewrites changed items, so a ref that
# leaves the corpus is never revisited — exclusion alone would leave the
# duplicate embedded forever.
# ---------------------------------------------------------------------------


def _indexed(db, path, node=None, sha=None):
    db.conn.execute(
        "INSERT INTO files (path, kind, source, content_node_id, sha256) "
        "VALUES (?, 'slide', 'manual', ?, ?)", (path, node, sha))
    db.conn.commit()


def _node(db, nid, title="topic"):
    """files.content_node_id is a real FK and DB turns foreign_keys ON, so a
    node has to exist before a file can point at it."""
    cid = db.conn.execute("SELECT id FROM courses LIMIT 1").fetchone()[0]
    db.conn.execute(
        "INSERT INTO content_nodes (id, course_id, brightspace_id, node_type, title) "
        "VALUES (?, ?, ?, 'topic', ?)", (nid, cid, nid, title))
    db.conn.commit()


def _write_marked_deck(root, rel, lines=40):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("<!-- page 1 -->\n# Slide 1\n"
                 + "\n".join(f"- bullet {i}" for i in range(lines)))
    return p


def _refs(db):
    return {r[0] for r in db.conn.execute("SELECT DISTINCT ref FROM chunks")}


def test_rebuild_excludes_and_prunes_non_canonical_duplicates(tmp_path, db_path):
    from sync.config import Config
    from sync.db import DB
    from sync.search import rebuild

    root = tmp_path / "school"
    (root / "2026F" / "SE3316A" / "content").mkdir(parents=True)
    dup = "2026F/SE3316A/content/Notes-2025/deck.md"
    canon = "2026F/SE3316A/content/Units/deck.md"
    _write_marked_deck(root, dup)
    _write_marked_deck(root, canon)
    # empty embed_model = lexical mode: no /embeddings call, so the whole
    # rebuild runs offline and the test asserts indexing, not network behaviour
    cfg = Config(data_root=root, db_path=db_path)
    db = DB(db_path)

    # Phase 1 — production today: both copies indexed, no collapse evidence yet
    _indexed(db, dup)
    _indexed(db, canon)
    first = rebuild(cfg, db)
    assert first["chunks"] > 0
    assert first["pruned_refs"] == 0
    assert {dup, canon} <= _refs(db)

    # Phase 2 — the same-source evidence arrives: sibling .pdf rows carrying the
    # SAME sha, plus node placement (Units gets its own topic node, Notes-2025
    # hangs off a bucket node many files share)
    _node(db, 1001, "Slides")      # shared bucket
    _node(db, 1002, "Week 1 - Intro")
    _indexed(db, dup[:-3] + ".pdf", node=1001, sha="sha-same")
    _indexed(db, canon[:-3] + ".pdf", node=1002, sha="sha-same")
    db.conn.execute("UPDATE files SET content_node_id=1001 WHERE path=?", (dup,))
    db.conn.execute("UPDATE files SET content_node_id=1002 WHERE path=?", (canon,))
    for i in range(5):
        _indexed(db, f"2026F/SE3316A/content/bucket{i}.md", node=1001)
    db.conn.commit()

    second = rebuild(cfg, db)
    assert second["pruned_refs"] == 1
    assert canon in _refs(db)
    assert dup not in _refs(db)

    # Idempotent: the duplicate's `files` row still exists (sync re-adds it on
    # every run), so a later rebuild must neither prune again nor resurrect it.
    third = rebuild(cfg, db)
    assert third["pruned_refs"] == 0
    assert third["chunks"] == second["chunks"]
    assert dup not in _refs(db)


def test_hit_page_resolves_before_window():
    from sync.search import _hit
    # live IDN case, minimized: the page-11 marker sits before the snippet
    # window, so snippet-only attribution would default to page 1.
    chunk = ("intro stuff\n<!-- page 11 -->\n" + "filler " * 60
             + "IDN homograph attacks target\n<!-- page 12 -->\nnext")
    hit = _hit({"ref": "f.md", "course_id": 1, "text": chunk}, "homograph", 1.0)
    assert hit["text"].startswith("…")  # window cut the marker
    assert hit["page"] == 11
