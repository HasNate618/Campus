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
    assert r1 == {"facts": 1, "events": 2, "exams": 1, "assignments": 1}
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
        " AND action IN ('mine-insert','mine-backfill')").fetchone()[0] == 5
    db.close()


def test_mine_course_writes_fact_and_counts(db, cfg, monkeypatch):
    from sync.sync import SyncEngine
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Midterm", "Covers units 1-4 including binary arithmetic and logic gates.", "brightspace"))
    db.conn.commit()
    fake = {"facts": [{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}],
            "events": [], "exams": [], "assignment_updates": []}
    import sync.sync as sync_mod
    monkeypatch.setattr(sync_mod.SyncEngine, "_call_miner", lambda self, c: fake)
    from unittest.mock import MagicMock
    eng = SyncEngine(cfg, db, client=MagicMock())
    out = eng.mine_course(course["id"], force=True)
    assert eng.course_has_mining_deltas(course["id"]) is False  # bare DB: gate works
    assert out == {"facts": 1, "events": 0, "exams": 0, "assignments": 0}
    assert db.conn.execute(
        "SELECT COUNT(*) FROM memory_facts WHERE course_id=?",
        (course["id"],)).fetchone()[0] == 1
    db.close()


def test_card_filters_noise_and_keeps_grading(db, cfg):
    from agent.memory import build_card
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "5 slides were added", "general", 0.9, "sync:2026-09-10"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "2 files were posted", "logistics", 0.9, "sync:2026-09-10"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Midterm is worth 20%; final 45%; pass needs 50% on the final.", "grading", 0.9, "t"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab sessions begin the week of 2026-09-21.", "scheduling", 0.8, "t"))
    db.conn.commit()
    card = build_card(cfg, db, course["id"])
    assert "slides were added" not in card
    assert "files were posted" not in card
    assert "Midterm is worth 20%" in card
    assert "week of 2026-09-21" in card
    assert card.index("Midterm is worth 20%") < card.index("week of 2026-09-21")
    db.close()


def test_render_sync_log_deterministic():
    from sync.sync import render_sync_log
    md = render_sync_log("2026-09-11",
        {"files_new": 3, "files_changed": 1},
        [{"code": "SE 3352A", "files_new": 3, "files_changed": 1,
          "announcements_new": 0,
          "mined": {"facts": 4, "events": 2, "exams": 0, "assignments": 1}}])
    assert "SE 3352A" in md and "3 new" in md
    assert "mined +4 facts" in md and "+2 events" in md and "backfilled 1 assignment" in md
    assert "Nothing new" in render_sync_log("2026-09-11", {}, [])


def test_parser_rejects_class_and_personal_events():
    from sync.mine import parse_miner_output
    raw = ('{"facts": [], "events": ['
           '{"title": "Lecture", "starts_at": "2026-09-16T12:30", "kind": "class", "confidence": 0.9}, '
           '{"title": "Dentist", "starts_at": "2026-09-17", "kind": "personal", "confidence": 0.9}, '
           '{"title": "Lab 1 due", "starts_at": "2026-09-18", "kind": "assignment", "confidence": 0.9}], '
           '"exams": [], "assignment_updates": []}')
    out = parse_miner_output(raw)
    assert [e["title"] for e in out["events"]] == ["Lab 1 due"]


def test_apply_skips_class_events_even_if_parsed(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    mined = {"facts": [], "events": [
        {"title": "Lecture", "starts_at": "2026-09-16T12:30", "kind": "class"}],
        "exams": [], "assignment_updates": []}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["events"] == 0
    assert db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    db.close()


def test_backfill_creates_assignment_event(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 2", "Build a longer page with many parts.", "brightspace"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 2", "due_at": "2026-10-09"}]}
    r1 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r1["assignments"] == 1 and r1["events"] == 1
    row = db.conn.execute(
        "SELECT title, starts_at, kind FROM events WHERE course_id=?",
        (course["id"],)).fetchone()
    assert (row["title"], row["starts_at"], row["kind"]) == ("Lab 2", "2026-10-09", "assignment")
    r2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert r2 == {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    db.close()


def test_apply_stores_raw_provenance(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    raw = '{"facts": [{"fact": "Final is worth 45%.", "confidence": 0.9}]}'
    apply_mining(db, course["id"], {"facts": [{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}],
                                    "events": [], "exams": [], "assignment_updates": []},
                 source="mine:test", raw=raw)
    row = db.conn.execute(
        "SELECT detail FROM audit_log WHERE action='mine-run'").fetchone()
    assert row is not None and "Final is worth 45%" in row["detail"]
    db.close()


def test_backfill_conflicting_fact_is_flagged(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 3", "ReST APIs with many requirements here.", "brightspace"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab 3 is on ReST APIs due Oct 31.", "assignment", 0.9, "mine:old"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 3", "due_at": "2026-10-23"}]}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["assignments"] == 1  # still fills the NULL
    row = db.conn.execute(
        "SELECT detail FROM audit_log WHERE action='mine-conflict'").fetchone()
    assert row is not None and "Oct 31" in row["detail"]
    db.close()


def test_outlines_prefer_current_term(cfg, db, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    (root / "content").mkdir(parents=True)
    (root / "old-outline-2025.md").write_text("# Old\nMidterm Oct 1 worth 10%.\n")
    (root / "new-outline-2026.md").write_text("# New\nMidterm Oct 20 worth 25%.\n")
    for rel in ("2026F/CS1100A/old-outline-2025.md", "2026F/CS1100A/new-outline-2026.md"):
        db.conn.execute(
            "INSERT INTO files (course_id, path, size, sha256, processed) VALUES (?,?,?,?,1)",
            (course["id"], rel, 10, "y" + rel))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"], excerpt_chars=40)
    assert corpus["blocks"][0]["path"].endswith("new-outline-2026.md")
    db.close()


def test_truncate_blocks_keeps_whole_blocks():
    from sync.mine import _truncate_blocks
    blocks = [{"kind": "outline", "path": "a", "text": "x" * 100},
              {"kind": "other", "path": "b", "text": "y" * 100}]
    out = _truncate_blocks(blocks, 150)
    assert [b["path"] for b in out] == ["a"]
    assert sum(len(b["text"]) for b in out) <= 150
