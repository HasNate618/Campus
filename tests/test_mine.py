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
    assert r1 == {"facts": 1, "events": 1, "exams": 1, "assignments": 1}  # backfill event dupes the miner event (same day, shared words)
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


def test_parser_drops_low_confidence_facts_and_updates():
    from sync.mine import parse_miner_output
    raw = ('{"facts": [{"fact": "Maybe the prof is nice.", "category": "prof-note", "confidence": 0.3}, '
           '{"fact": "Final is worth 45%.", "category": "grading", "confidence": 0.9}], '
           '"events": [], "exams": [], '
           '"assignment_updates": [{"title": "Lab 1", "due_at": "2026-09-14", "confidence": 0.4}, '
           '{"title": "Lab 2", "due_at": "2026-10-09"}]}')
    out = parse_miner_output(raw)
    assert [f["fact"] for f in out["facts"]] == ["Final is worth 45%."]
    assert [u["title"] for u in out["assignment_updates"]] == ["Lab 2"]


def test_titles_match_whole_tokens():
    from sync.mine import _titles_match
    assert _titles_match("Lab 1", "Lab 1 – HTML+CSS") is True
    assert _titles_match("Lab 1", "Lab 10") is False
    assert _titles_match("Midterm", "Midterm Exam") is True
    assert _titles_match("Quiz 9 (nonexistent)", "Lab 1") is False


def test_exam_dedupe_ignores_time_format(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO exams (course_id, title, starts_at, source) VALUES (?,?,?,?)",
        (course["id"], "Midterm", "2026-10-20", "manual"))
    db.conn.commit()
    out = apply_mining(db, course["id"], {
        "facts": [], "events": [],
        "exams": [{"title": "Midterm", "starts_at": "2026-10-20T09:00", "weight": None}],
        "assignment_updates": []}, source="mine:test")
    assert out["exams"] == 0
    db.close()


def test_noise_filter_catches_availability_notices():
    from sync.mine import is_noise_fact
    assert is_noise_fact("SE3352A course outline (outline.pdf) has been posted under Content") is True
    assert is_noise_fact("Week 1 materials are available in both PDF and PPTX formats") is True
    assert is_noise_fact("Final is worth 45%.") is False
    assert is_noise_fact("Office hours are by appointment in TEB.") is False


def test_card_clips_at_word_boundary(db, cfg):
    from agent.memory import build_card
    course = db.get_course_by_code("CS 1100A")
    # 44 + 3x35 chars: char 140 falls strictly inside the 3rd long word,
    # so a naive [:140] chop leaves a mid-word fragment.
    fact = ("Midterm covers chapters one through twelve. "
            + "supercalifragilisticexpialidocious " * 3
            + "ends here with more words pushing past the cap.")
    assert len(fact) > 140 and " " not in fact[114:148]
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], fact, "general", 0.9, "t"))
    db.conn.commit()
    card = build_card(cfg, db, course["id"])
    assert "supercalifragilisticexpialidocious" in card
    assert "supercalifragilisti…" not in card
    db.close()


def test_retire_noise_facts(db):
    from sync.mine import retire_noise_facts
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "3 files were added", "general", 0.9, "sync:2026-09-10"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Final is worth 45%.", "grading", 0.9, "sync:2026-09-10"))
    db.conn.commit()
    assert retire_noise_facts(db, course["id"]) == 1
    assert db.conn.execute(
        "SELECT COUNT(*) FROM memory_facts WHERE course_id=? AND is_active=1",
        (course["id"],)).fetchone()[0] == 1
    db.close()


def test_backfill_fact_without_date_is_not_conflict(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 3", "ReST APIs with many requirements here.", "brightspace"))
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Evaluation: 40% labs (Lab 1 15%, Lab 2 10%, Lab 3 24%), best 8/10 quizzes.", "grading", 0.9, "mine:old"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 3", "due_at": "2026-10-23"}]}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["assignments"] == 1
    assert db.conn.execute(
        "SELECT COUNT(*) FROM audit_log WHERE action='mine-conflict'").fetchone()[0] == 0
    db.close()


def test_extract_pdf_registers_md_sibling(db, cfg, tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    import sync.sync as sync_mod
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = "http://parser:8000"
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "outline.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/outline.pdf", "p" * 64))
    db.conn.commit()
    row = db.conn.execute("SELECT * FROM files").fetchone()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"page_content": "# Outline\nFinal Dec 15 worth 45%."}
    monkeypatch.setattr(sync_mod.httpx, "put", lambda *a, **k: fake_resp)
    eng = SyncEngine(cfg, db, client=MagicMock())
    assert eng.extract_pdf(row) is True
    mdrow = db.conn.execute(
        "SELECT kind, source, processed FROM files WHERE path=?",
        ("2026F/CS1100A/outline.md",)).fetchone()
    assert mdrow is not None and (mdrow["kind"], mdrow["source"], mdrow["processed"]) == ("other", "manual", 1)
    db.close()


def test_registered_md_reaches_corpus_outlines(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    root.mkdir(parents=True)
    (root / "cs1100-outline.md").write_text("# Outline\nFinal exam Dec 15 worth 45%.\n")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'other','manual',10,?,1)",
        (course["id"], "2026F/CS1100A/cs1100-outline.md", "m" * 64))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    assert corpus["blocks"][0]["kind"] == "outline"
    assert "Dec 15" in corpus["blocks"][0]["text"]
    db.close()


def test_syllabus_html_mined_as_outline_priority(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A"
    root.mkdir(parents=True)
    (root / "syllabus.html").write_text(
        "<h1>Syllabus</h1><p>Important dates and grading policies for the term.</p>"
        "<table><tr><td>Midterm</td><td>Oct 20</td></tr>"
        "<tr><td>Final exam</td><td>Dec 15</td></tr></table>")
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    syl = [b for b in corpus["blocks"] if b["kind"] == "syllabus"]
    assert len(syl) == 1 and "Oct 20" in syl[0]["text"] and "<td>" not in syl[0]["text"]
    assert corpus["blocks"][0]["kind"] in ("outline", "syllabus")
    db.close()


def test_syllabus_save_emits_mining_delta(db, cfg, tmp_path):
    from unittest.mock import MagicMock
    from sync.sync import SyncEngine
    eng = SyncEngine(cfg, db, client=MagicMock())
    course = db.get_course_by_code("CS 1100A")
    course_dir = tmp_path / "2026F" / "CS1100A"
    course_dir.mkdir(parents=True)
    eng._save_syllabus(course["id"], course_dir,
                       [{"Title": "S", "Html": "<p>Midterm Oct 20</p>"}])
    assert (course_dir / "syllabus.html").exists()
    assert any(d.get("kind") == "syllabus" and d.get("course_id") == course["id"]
               for d in eng.deltas)
    db.close()


def test_corpus_prefers_body_html_and_strips_assignment_desc(db, cfg):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO announcements (course_id, title, body, body_html, posted_at) VALUES (?,?,?,?,?)",
        (course["id"], "Sched", "see table", "<table><tr><td>Quiz 1</td><td>Sep 18</td></tr></table>", "2026-09-10"))
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, source) VALUES (?,?,?,?)",
        (course["id"], "Lab 9 with a sufficiently long title here",
         "<div><p>Due <b>Oct 30</b> via dropbox. Submit through the course dropbox folder before midnight.</p></div>", "brightspace"))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    ann = next(b for b in corpus["blocks"] if b["kind"] == "announcement")
    assert "Sep 18" in ann["text"] and "<td>" not in ann["text"]
    asg = next(b for b in corpus["blocks"] if b["kind"] == "assignment")
    assert "Oct 30" in asg["text"] and "<div>" not in asg["text"]
    db.close()


def test_content_nodes_module_only_ordered(db, cfg):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    for i in range(7):
        db.conn.execute(
            "INSERT INTO content_nodes (course_id, brightspace_id, node_type, title, description)"
            " VALUES (?,?,?,?,?)",
            (course["id"], 900 + i, "topic", f"T{i}",
             f"Topic number {i} with plenty of descriptive text to clear the length bar."))
    db.conn.execute(
        "INSERT INTO content_nodes (course_id, brightspace_id, node_type, title, description)"
        " VALUES (?,?,?,?,?)",
        (course["id"], 800, "module", "Schedule module",
         "Module landing page with schedule table and tutorial links, long enough to qualify."))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    mods = [b for b in corpus["blocks"] if b["kind"] == "content"]
    # content blocks carry the description (not the title): assert on its text
    assert any("tutorial links" in b["text"] for b in mods)
    assert not any(b["text"].startswith("Topic number") for b in mods)
    db.close()


def test_step5_per_file_cap_and_date_rank(db, cfg, tmp_path):
    from sync.mine import build_course_corpus
    course = db.get_course_by_code("CS 1100A")
    root = tmp_path / "2026F" / "CS1100A" / "content"
    root.mkdir(parents=True)
    (root / "a-slides.md").write_text(
        ("Intro fluff line.\n" * 500) + "Midterm Oct 20 worth 25%.\n")
    (root / "b-notes.md").write_text("Quiz Sep 18.\nFinal Dec 15.\nLab due Nov 1.\n")
    for rel in ("2026F/CS1100A/content/a-slides.md", "2026F/CS1100A/content/b-notes.md"):
        db.conn.execute(
            "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
            " VALUES (?,?,'other','manual',10,?,1)",
            (course["id"], rel, "q" + rel))
    db.conn.commit()
    corpus = build_course_corpus(cfg, db, course["id"])
    others = [b for b in corpus["blocks"] if b["kind"] == "other"]
    assert sum(len(b["text"]) for b in others) <= 20000
    assert all(len(b["text"]) <= 1500 + 120 for b in others)  # per-file cap + context slop
    assert others[0]["path"].endswith("b-notes.md")  # densest dates first
    db.close()


def test_truncate_blocks_skips_instead_of_breaking():
    from sync.mine import _truncate_blocks
    blocks = [{"kind": "other", "path": "big", "text": "x" * 100},
              {"kind": "other", "path": "small", "text": "y" * 10}]
    out = _truncate_blocks(blocks, 110)
    assert [b["path"] for b in out] == ["big", "small"]


def test_backfill_confirmed_date_ensures_event(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO assignments (course_id, title, description, due_at, source) VALUES (?,?,?,?,?)",
        (course["id"], "Lab 5 with a long enough title", "Build something substantial here.", "2026-11-01", "brightspace"))
    db.conn.commit()
    mined = {"facts": [], "events": [], "exams": [],
             "assignment_updates": [{"title": "Lab 5", "due_at": "2026-11-01"}]}
    out = apply_mining(db, course["id"], mined, source="mine:test")
    assert out["assignments"] == 0  # already filled — nothing to backfill
    assert out["events"] == 1  # miner-confirmed date reaches the calendar
    out2 = apply_mining(db, course["id"], mined, source="mine:test")
    assert out2["events"] == 0  # dedupe holds on re-run
    db.close()


def test_long_scan_skip_writes_stub(db, cfg, tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = ""  # local-OCR-only path applies the skip
    cfg.long_scan_skip_pages = 2
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "scan.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/scan.pdf", "s" * 64))
    db.conn.commit()
    # hermetic: .venv pymupdf is broken (libstdc++), so fake a 5-page scan
    monkeypatch.setattr(SyncEngine, "_scan_pages", lambda self, p: 5)
    eng = SyncEngine(cfg, db, client=MagicMock())
    eng.run_extraction_queue(course_id=course["id"])
    stub = tmp_path / "2026F" / "CS1100A" / "scan.md"
    assert stub.exists() and "SKIPPED" in stub.read_text() and "pages" in stub.read_text()
    assert db.conn.execute(
        "SELECT COUNT(*) FROM files WHERE path=?", ("2026F/CS1100A/scan.md",)).fetchone()[0] == 1
    db.close()


def test_extract_marks_pages_and_pins_encoding(db, cfg, tmp_path, monkeypatch):
    from unittest.mock import MagicMock
    import sync.sync as sync_mod
    from sync.sync import SyncEngine
    cfg.pdf_extractor_url = "http://parser:8000"
    (tmp_path / "2026F" / "CS1100A").mkdir(parents=True)
    pdf = tmp_path / "2026F" / "CS1100A" / "doc.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,?,0)",
        (course["id"], "2026F/CS1100A/doc.pdf", "d" * 64))
    db.conn.commit()
    row = db.conn.execute("SELECT * FROM files WHERE path LIKE '%.pdf'").fetchone()
    def fake_put(url, content=None, timeout=None):
        fake = MagicMock()
        fake.json.return_value = {"page_content": "# Doc\nHello."}
        return fake
    monkeypatch.setattr(sync_mod.httpx, "put", fake_put)
    eng = SyncEngine(cfg, db, client=MagicMock())
    assert eng.extract_pdf(row) is True
    text = (tmp_path / "2026F" / "CS1100A" / "doc.md").read_text(encoding="utf-8")
    assert "Hello" in text
    db.close()


def test_fact_dupes_paraphrase_gate():
    from sync.mine import _fact_dupes
    assert _fact_dupes("Professor: Samarabandu, Email: jagath@uwo.ca, Office: TEB 351",
                        "Instructor: Prof. Samarabandu, email: jagath@uwo.ca, office: TEB 351") is True
    assert _fact_dupes("Midterm Oct 20 worth 25%", "Midterm Oct 21 worth 25%") is False
    assert _fact_dupes("Final is worth 45%", "Midterm is worth 20%") is False
    assert _fact_dupes("Labs need 5 commits", "Labs need 10 commits") is False
    assert _fact_dupes("iClicker code: XWAH", "iClicker class code for SE 3316A: XWAH") is True


def test_apply_skips_paraphrase_facts_and_retitled_events(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO memory_facts (course_id, fact, category, confidence, source) VALUES (?,?,?,?,?)",
        (course["id"], "Instructor: Prof. X, email: x@uwo.ca.", "prof-note", 0.9, "mine:old"))
    db.conn.execute(
        "INSERT INTO events (course_id, kind, title, starts_at, ics_uid) VALUES (?,?,?,?,?)",
        (course["id"], "assignment", "Project Approval", "2026-09-25", "u" * 16))
    db.conn.commit()
    out = apply_mining(db, course["id"], {
        "facts": [{"fact": "Professor X, Email: x@uwo.ca.", "category": "prof-note", "confidence": 0.9}],
        "events": [{"title": "Project Approval from TA", "starts_at": "2026-09-25", "kind": "assignment"}],
        "exams": [], "assignment_updates": []}, source="mine:test")
    assert out == {"facts": 0, "events": 0, "exams": 0, "assignments": 0}
    db.close()


def test_exam_event_dupes_exams_row(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO exams (course_id, title, starts_at, source) VALUES (?,?,?,?)",
        (course["id"], "Midterm Test", "2026-10-27", "manual"))
    db.conn.commit()
    out = apply_mining(db, course["id"], {
        "facts": [],
        "events": [{"title": "Midterm Test (Tentative Date)", "starts_at": "2026-10-27",
                      "kind": "exam", "notes": "Closed book."}],
        "exams": [], "assignment_updates": []}, source="mine:test")
    assert out["events"] == 0  # exams-table row already covers this date+title
    db.close()


def test_exam_dupes_exams_row(db):
    from sync.mine import apply_mining
    course = db.get_course_by_code("CS 1100A")
    db.conn.execute(
        "INSERT INTO exams (course_id, title, starts_at, weight, source) VALUES (?,?,?,?,?)",
        (course["id"], "Midterm Test", "2026-10-27", 20.0, "manual"))
    db.conn.commit()
    out = apply_mining(db, course["id"], {
        "facts": [], "events": [],
        "exams": [{"title": "Midterm exam", "starts_at": "2026-10-27", "weight": 0.2}],
        "assignment_updates": []}, source="mine:test")
    assert out["exams"] == 0  # same-day retitled exam row already covers it
    db.close()
