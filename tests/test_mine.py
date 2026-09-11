"""Tests for autonomous sync mining (sync/mine.py + wiring)."""
from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def cfg(tmp_path: Path, db_path: Path):
    from sync.config import Config
    return Config(data_root=tmp_path, db_path=db_path)


@pytest.fixture()
def db(db_path: Path):
    from sync.db import DB
    d = DB(db_path)
    yield d
    d.close()


def test_stable_uid_deterministic():
    from sync.mine import stable_uid
    a = stable_uid("SE 3352A", "Lab 1 due", "2026-09-14")
    b = stable_uid("SE 3352A", "Lab 1 due", "2026-09-14")
    c = stable_uid("SE 3352A", "Lab 2 due", "2026-09-14")
    assert a == b and len(a) == 16
    assert a != c


def test_build_course_corpus_outlines_first(cfg, db, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    (root / "content").mkdir(parents=True)
    (root / "course-outline.md").write_text(
        "# Outline\nFinal exam Dec 15 worth 45%.\n")
    (root / "content" / "week1.md").write_text(
        "# Week 1\nNothing dated here, just intro.\n")
    for rel in ("2026F/CS1100A/course-outline.md", "2026F/CS1100A/content/week1.md"):
        db.conn.execute(
            "INSERT INTO files (course_id, path, size, sha256, processed)"
            " VALUES (?,?,?,?,1)",
            (course["id"], rel, 10, "x" + rel))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    assert corpus["blocks"][0]["kind"] == "outline"
    assert "2026-09-14" not in str(corpus)  # nothing dated, no leakage


def test_parse_miner_output_coerces_and_drops():
    from sync.mine import parse_miner_output
    raw = '{"facts": [{"fact": "Midterm is 25%", "category": "bogus", "confidence": 0.9}], '
    raw += '"events": [{"title": "Lab 1 due", "starts_at": "2026-09-14", "kind": "assignment"}, '
    raw += '{"title": "Maybe quiz", "starts_at": "2026-10-01", "kind": "exam", "confidence": 0.2}], '
    raw += '"exams": [{"title": "Midterm", "starts_at": "sometime soon"}, '
    raw += '{"title": "Final", "starts_at": "2026-12-15", "confidence": 0.3}], '
    raw += '"assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14"}]}'
    out = parse_miner_output("```json\n" + raw + "\n```")
    assert out["facts"][0]["category"] == "general"
    assert len(out["events"]) == 1  # low-confidence rumor dropped
    assert out["events"][0]["starts_at"] == "2026-09-14"
    assert out["exams"] == []  # bad date + low confidence dropped
    assert out["assignment_updates"][0]["due_at"] == "2026-09-14"


def test_apply_mining_dedupes_and_backfills(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 1 – HTML+CSS", "Build a page.", "brightspace"))
    db.conn.commit()
    mined = {
        "facts": [{"fact": "2 files were added", "category": "general", "confidence": 0.9},
                  {"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}],
        "events": [{"title": "Lab 1 due", "starts_at": "2026-09-14",
                      "ends_at": None, "kind": "assignment", "notes": None}],
        "exams": [{"title": "Midterm", "starts_at": "2026-10-20", "weight": 25.0,
                     "notes": None}],
        "assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14", "weight": None},
                               {"title": "Quiz 9 (nonexistent)", "due_at": "2026-10-01", "weight": None}],
    }
    r1 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r1 == {"facts": 1, "events": 1, "exams": 1, "assignments": 1}
    assert db.conn.execute(
        "SELECT COUNT(*) FROM assignments WHERE course_id=?",
        (course["id"],)).fetchone()[0] == 1  # non-matching update creates nothing
    r2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r2 == {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    assert db.conn.execute(
        "SELECT due_at FROM assignments WHERE course_id=?",
        (course["id"],)).fetchone()[0] == "2026-09-14"
    assert db.conn.execute(
        "SELECT COUNT(*) FROM audit_log WHERE actor='sync'"
        " AND action IN ('mine-insert','mine-backfill')").fetchone()[0] == 4
    db.close()
