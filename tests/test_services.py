"""API services contracts (DB->frontend mapping)."""
from __future__ import annotations


def test_list_files_hides_md_siblings(db):
    from api.services import list_files
    course = db.execute(
        "SELECT id FROM courses WHERE code='CS 1100A'").fetchone()
    cid = course["id"]
    db.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,1)",
        (cid, "2026F/CS1100A/lec01.pdf", "a" * 64))
    db.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'other','manual',10,?,1)",
        (cid, "2026F/CS1100A/lec01.md", "b" * 64))
    db.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'other','manual',10,?,1)",
        (cid, "2026F/CS1100A/orphan.md", "c" * 64))
    db.commit()
    paths = [f["path"] for f in list_files(cid)]
    assert "2026F/CS1100A/lec01.pdf" in paths
    assert "2026F/CS1100A/lec01.md" not in paths  # sibling served via Extracted-text toggle
    assert "2026F/CS1100A/orphan.md" in paths  # no brother row: stays visible
    db.close()
