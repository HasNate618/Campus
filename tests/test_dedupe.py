"""The canonical-path rule for same-source duplicate documents.

Ten documents in the live corpus are extracted and indexed twice, once under
`content/Notes-2025/` (or `Notes-2026/`) and once under `content/Units/`. The
source PDFs are byte-identical, so one answer could be cited to two paths and
`offset/limit` reads of the "same" page disagreed by ten lines.

The rule that picks the winner must be derived from data, not from a folder
name — these tests pin the shape rather than the spelling.
"""

from __future__ import annotations

import sqlite3


def _rec(path, node=None, node_load=1, sha="same", course=1):
    return {"path": path, "course_id": course, "content_node_id": node,
            "node_load": node_load, "source_sha": sha}


def test_singletons_produce_no_mapping():
    from sync.dedupe import plan_canonical
    assert plan_canonical([_rec("2026F/A/content/only.md")]) == {}


def test_document_specific_node_beats_a_shared_bucket():
    from sync.dedupe import plan_canonical
    recs = [_rec("2026F/A/content/Notes-2025/x.md", node=1, node_load=23),
            _rec("2026F/A/content/Units/x.md", node=2, node_load=2)]
    assert plan_canonical(recs) == {
        "2026F/A/content/Notes-2025/x.md": "2026F/A/content/Units/x.md"}


def test_lowest_node_load_wins_not_a_load_of_exactly_one():
    """The live shape, with the live numbers.

    The per-document topic node is linked by BOTH the .md and its extracted
    .pdf, so its load is 2 — not 1 — while the shared "Slides" bucket node has
    load 23. A `node_load <= 1` heuristic calls both candidates specific, falls
    through to lexicographic order, and picks `Notes-2025`. That is the
    opposite of the confirmed decision, so the discriminator is *fewest*
    linking files, not a magic threshold.
    """
    from sync.dedupe import plan_canonical
    recs = [_rec("c/Notes-2025/x.md", node=2638, node_load=23),
            _rec("c/Units/x.md", node=2668, node_load=2)]
    assert plan_canonical(recs)["c/Notes-2025/x.md"] == "c/Units/x.md"


def test_no_hardcoded_folder_names_in_the_decision():
    """Folders renamed: the rule must follow node specificity, not `Units`.

    `t/aaa/bucket` sorts BEFORE `t/zzz/inbox`, so lexicographic order alone
    would pick the shared-bucket copy. Only the node load can rescue this.
    """
    from sync.dedupe import plan_canonical
    recs = [_rec("t/zzz/inbox/x.md", node=7, node_load=2),
            _rec("t/aaa/bucket/x.md", node=8, node_load=4)]
    assert plan_canonical(recs) == {"t/aaa/bucket/x.md": "t/zzz/inbox/x.md"}


def test_different_source_shas_are_not_duplicates():
    """Same basename, provably different source PDFs -> two real documents."""
    from sync.dedupe import plan_canonical
    recs = [_rec("a/x.md", node=1, node_load=2, sha="aaa"),
            _rec("b/x.md", node=2, node_load=2, sha="bbb")]
    assert plan_canonical(recs) == {}


def test_no_source_evidence_leaves_same_name_files_alone():
    """Without a sibling .pdf there is no evidence these are one document
    extracted twice — two plain markdown files may legitimately share a name."""
    from sync.dedupe import plan_canonical
    recs = [_rec("a/x.md", sha=None), _rec("b/x.md", sha=None)]
    assert plan_canonical(recs) == {}


def test_one_known_source_sha_is_enough_to_pair():
    """Unknown is not the same as different: one side having the .pdf row is
    enough to establish the pairing."""
    from sync.dedupe import plan_canonical
    recs = [_rec("b/x.md", sha="same"), _rec("a/x.md", sha=None)]
    assert plan_canonical(recs) == {"b/x.md": "a/x.md"}


def test_same_basename_in_different_courses_never_merges():
    """`content/x.md` exists in many courses; grouping must be course-scoped."""
    from sync.dedupe import plan_canonical
    recs = [_rec("2026F/AAA/content/x.md", course=1),
            _rec("2026F/BBB/content/x.md", course=2)]
    assert plan_canonical(recs) == {}


def test_linked_beats_unlinked_before_lexicographic_ordering():
    from sync.dedupe import plan_canonical
    recs = [_rec("a/x.md"), _rec("b/x.md", node=5, node_load=2)]
    assert plan_canonical(recs) == {"a/x.md": "b/x.md"}


def test_unlinked_candidates_fall_back_to_lexicographic():
    from sync.dedupe import plan_canonical
    recs = [_rec("b/x.md"), _rec("a/x.md")]
    assert plan_canonical(recs) == {"b/x.md": "a/x.md"}


def test_three_way_group_maps_every_loser_to_the_winner():
    from sync.dedupe import plan_canonical
    recs = [_rec("a/x.md", node=1, node_load=9),
            _rec("b/x.md", node=2, node_load=4),
            _rec("c/x.md", node=3, node_load=2)]
    assert plan_canonical(recs) == {"a/x.md": "c/x.md", "b/x.md": "c/x.md"}


def test_resolve_is_identity_for_unknown_paths():
    from sync.dedupe import resolve
    assert resolve("totally/new.md", {"a/x.md": "b/x.md"}) == "totally/new.md"
    assert resolve("a/x.md", {"a/x.md": "b/x.md"}) == "b/x.md"


# ---------------------------------------------------------------------------
# canonical_map: the read-only DB adapter. Real DB, real rows — the pure rule
# above is only useful if this glue reads `files` the way production does.
# ---------------------------------------------------------------------------

def _files_table(rows):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE files (path TEXT, course_id INTEGER, "
                 "content_node_id INTEGER, sha256 TEXT)")
    conn.executemany("INSERT INTO files VALUES (?,?,?,?)", rows)
    conn.commit()
    return conn


def test_canonical_map_reads_sibling_pdf_shas_and_node_loads():
    rows = [
        ("2026F/A/content/Notes-2025/x.md", 1, 2638, None),
        ("2026F/A/content/Units/x.md", 1, 2668, None),
        ("2026F/A/content/Notes-2025/x.pdf", 1, 2638, "sha-same"),
        ("2026F/A/content/Units/x.pdf", 1, 2668, "sha-same"),
    ]
    # node 2638 is the shared bucket: 21 more files link it, so its load is 23.
    rows += [(f"2026F/A/content/other{i}.md", 1, 2638, None) for i in range(21)]
    conn = _files_table(rows)

    from sync.dedupe import canonical_map
    assert canonical_map(conn) == {
        "2026F/A/content/Notes-2025/x.md": "2026F/A/content/Units/x.md"}


def test_canonical_map_is_empty_when_sources_differ():
    conn = _files_table([
        ("2026F/A/content/Notes-2025/x.md", 1, 1, None),
        ("2026F/A/content/Units/x.md", 1, 2, None),
        ("2026F/A/content/Notes-2025/x.pdf", 1, 1, "sha-a"),
        ("2026F/A/content/Units/x.pdf", 1, 2, "sha-b"),
    ])
    from sync.dedupe import canonical_map
    assert canonical_map(conn) == {}


def test_canonical_map_never_raises_without_a_files_table():
    """Called from the indexing path AND from agent tool paths, where a failure
    must degrade to 'no collapse', never take the caller down."""
    from sync.dedupe import canonical_map
    assert canonical_map(sqlite3.connect(":memory:")) == {}


def test_canonical_map_is_a_noop_for_a_single_file():
    conn = _files_table([("2026F/A/content/only.md", 1, 1, None)])
    from sync.dedupe import canonical_map
    assert canonical_map(conn) == {}
