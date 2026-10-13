"""`[[file:path]]` references must resolve to a file the workspace can show.

The four bugs these tests pin all came from one mistake: the marker path and
the workspace tree path are written in DIFFERENT dialects. A model writes
`2026F/CS1100A/uploads/notes.txt` (data-root-relative); the tree indexes
`uploads/notes.txt` (course-relative). Everything downstream that compared the
two silently missed, so the chip 404'd, selected nothing, and its Download link
pointed at a path missing the term/code prefix.

The load-bearing test is
`test_resolve_ref_returns_a_path_the_workspace_tree_can_find`: it asserts the
two dialects agree by composing the resolver against the tree, which is exactly
the property no single-function test could see.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


@pytest.fixture()
def ref_env(tmp_path: Path, monkeypatch):
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    with open("schema.sql") as f:
        conn.executescript(f.read())
    conn.execute(
        "INSERT INTO courses (code,name,term) VALUES (?,?,?)",
        ("CS 1100A", "Introduction to Programming", "2026F"),
    )
    conn.commit()
    conn.close()
    import api.config as _cfg
    import api.db as _db
    import api.services as _svc
    monkeypatch.setattr(_cfg, "DB_PATH", db)
    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "SCHOOL_ROOT", root)
    up = root / "2026F" / "CS1100A" / "uploads"
    up.mkdir(parents=True)
    (up / "notes.txt").write_text("hello from the workspace")
    return root


def _resolve_ref(course_id: int, ref: str):
    from api import services

    return services.resolve_ref(course_id, ref)


def _course(course_id: int) -> dict:
    from api import services

    c = services.get_course(course_id)
    assert c is not None, "course exists in the fixture"
    return c


def _tree_paths(course_id: int) -> set[str]:
    from api import services

    def walk(nodes):
        for n in nodes:
            yield n["path"]
            yield from walk(n.get("children") or [])

    tree = services.workspace_tree(course_id)
    assert tree is not None, "course exists in the fixture"
    return set(walk(tree["nodes"]))


# --- bug 2: the marker path never selected the file -------------------------


def test_resolve_ref_maps_a_data_root_path_to_the_workspace_form(ref_env):
    hit = _resolve_ref(1, "2026F/CS1100A/uploads/notes.txt")
    assert hit is not None
    assert hit["kind"] == "workspace"
    # The client needs the COURSE-relative form: it cannot derive the prefix.
    assert hit["rel"] == "uploads/notes.txt"


def test_resolve_ref_returns_a_path_the_workspace_tree_can_find(ref_env):
    """The invariant that was actually broken.

    Whatever `resolve_ref` hands back has to be an address the tree can serve,
    or the client looks up a path that does not exist. The two functions speak
    different dialects; this pins that they agree.
    """
    hit = _resolve_ref(1, "2026F/CS1100A/uploads/notes.txt")
    assert hit is not None
    assert hit["rel"] in _tree_paths(1)


def test_resolve_ref_accepts_the_course_relative_form_too(ref_env):
    hit = _resolve_ref(1, "uploads/notes.txt")
    assert hit is not None
    assert hit["rel"] == "uploads/notes.txt"



def test_resolve_ref_returns_none_for_a_path_outside_the_course(ref_env):
    """The fallback must not become a way to read the rest of the disk."""
    assert _resolve_ref(1, "../../../etc/passwd") is None


def test_resolve_ref_returns_none_for_a_missing_file(ref_env):
    assert _resolve_ref(1, "2026F/CS1100A/uploads/nope.txt") is None


# --- bug 1: Download 404'd on every text file -------------------------------


def test_workspace_read_returns_asset_for_a_text_file(ref_env):
    from api import services

    r = services.workspace_read(1, "uploads/notes.txt")
    # Binary files always carried `asset`; text did not, so the Download
    # control had nothing to link to.
    assert r["viewable"] is True
    assert r["asset"] == "/api/assets/2026F/CS1100A/uploads/notes.txt"


def test_workspace_read_asset_percent_encodes_the_filename(ref_env):
    from api import services

    p = ref_env / "2026F" / "CS1100A" / "uploads" / "draft #1.md"
    p.write_text("wip")
    r = services.workspace_read(1, "uploads/draft #1.md")
    # `#` would have truncated the URL into a fragment.
    assert r["asset"] == "/api/assets/2026F/CS1100A/uploads/draft%20%231.md"


def test_workspace_read_asset_carries_the_prefix_for_a_binary(ref_env):
    from api import services

    p = ref_env / "2026F" / "CS1100A" / "uploads" / "img.png"
    p.write_bytes(b"\x89PNG")
    r = services.workspace_read(1, "uploads/img.png")
    assert r["viewable"] is False
    # The bug: this used to come out as /api/assets/uploads/img.png.
    assert r["asset"] == "/api/assets/2026F/CS1100A/uploads/img.png"


# --- chat uploads and the Upload button used different naming ---------------


def test_unique_upload_name_keeps_a_readable_name_when_free(ref_env):
    from api import services

    course = _course(1)
    assert services.unique_upload_name(course, "report.pdf") == "report.pdf"


def test_unique_upload_name_suffixes_only_on_collision(ref_env):
    from api import services

    course = _course(1)
    up = ref_env / "2026F" / "CS1100A" / "uploads"
    assert services.unique_upload_name(course, "report.pdf") == "report.pdf"
    (up / "report.pdf").write_text("x")
    assert services.unique_upload_name(course, "report.pdf") == "report-2.pdf"
    (up / "report-2.pdf").write_text("x")
    assert services.unique_upload_name(course, "report.pdf") == "report-3.pdf"


def test_unique_upload_name_preserves_the_extension(ref_env):
    from api import services

    course = _course(1)
    up = ref_env / "2026F" / "CS1100A" / "uploads"
    (up / "data.tar.gz").write_text("x")
    # Stripping the extension here would store `data-2` and the agent would
    # never know what it was meant to read.
    assert services.unique_upload_name(course, "data.tar.gz") == "data-2.tar.gz"


def test_unique_upload_name_leaves_an_unknown_course_alone(ref_env):
    """The plain name must survive so workspace_upload can raise the 400."""
    from api import services

    assert services.unique_upload_name({}, "report.pdf") == "report.pdf"
