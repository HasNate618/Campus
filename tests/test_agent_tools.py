"""Agent tool-surface sanity: terminal_run blocklist + mutate safety rules.

The blocklist is the security boundary between the chat agent and the
host/container — a regression here is a real vulnerability, so the rules
deserve tests. TERMINAL_BLOCKLIST holds regex STRINGS; terminal_run compiles
them at call time, so the tests compile the same way.
"""

from __future__ import annotations

import re

import pytest


@pytest.fixture()
def compiled():
    from agent.tools import TERMINAL_BLOCKLIST
    return [re.compile(p) for p in TERMINAL_BLOCKLIST]


def test_blocklist_rejects_dangerous_commands(compiled):
    dangerous = [
        "sudo rm -rf /",
        "systemctl stop campus",
        "nixos-rebuild switch",
        "docker exec campus bash",
        "cat ~/.campus/token.json",
        "python -m sync auth",
        "chmod 777 /etc/passwd",
    ]
    for cmd in dangerous:
        assert any(r.search(cmd) for r in compiled), cmd


def test_blocklist_allows_benign_commands(compiled):
    benign = [
        "ls -la notes/",
        "rg 'deadline' content/",
        "echo hello",
        "cd work && mkdir lab3",
    ]
    for cmd in benign:
        assert not any(r.search(cmd) for r in compiled), cmd


# ---------------------------------------------------------------------------
# Page-addressed reads (plan 2026-09-21, Tasks 2).
#
# content_read_file only touches `db` on the overview/ branch, so a None db is
# safe for every test below; cfg is a stub exposing data_root.
# ---------------------------------------------------------------------------


@pytest.fixture()
def page_cfg(tmp_path, db_path):
    """A real Config over the throwaway corpus each test builds under tmp_path.
    A stub can't satisfy content_read_file(db: DB, cfg: Config), and a real
    Config is what test_mine.py already uses — same pattern, same fixtures
    (db_path comes from tests/conftest.py)."""
    from sync.config import Config
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    return Config(data_root=root, db_path=db_path)


@pytest.fixture()
def page_db(db_path):
    from sync.db import DB
    d = DB(db_path)
    yield d
    d.close()


def _deck(tmp_path, pages=74, lines_per_page=15, pad=0):
    """A marked deck. `pad` chars are appended to every bullet so a test can
    push the fixture over PAGE_READ_BUDGET: at pad=0 the 74-page deck is only
    ~15.6 KB, well under the 32 000 budget, so nothing would ever truncate."""
    root = tmp_path / "school"
    (root / "2026F" / "SE3316A" / "content").mkdir(parents=True)
    body = []
    for pg in range(1, pages + 1):
        body.append(f"<!-- page {pg} -->")
        body.append(f"# Slide {pg}")
        body.extend(f"- bullet {pg}.{i}" + "x" * pad
                    for i in range(lines_per_page - 2))
    p = root / "2026F" / "SE3316A" / "content" / "deck.md"
    p.write_text("\n".join(body))
    return root, "2026F/SE3316A/content/deck.md"


def test_parse_pages_accepts_single_and_range():
    from agent.tools import parse_pages
    assert parse_pages("57") == (57, 57)
    assert parse_pages("57-60") == (57, 60)
    assert parse_pages(" 7 - 9 ") == (7, 9)
    for bad in ("", "abc", "0", "9-3", "1-"):
        with pytest.raises(ValueError):
            parse_pages(bad)


def test_read_file_by_page_range(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "57-58"})
    assert r["pageStart"] == 57 and r["pageEnd"] == 58
    assert r["pagesInFile"] == 74
    assert r["content"].startswith("<!-- page 57 -->")
    assert "<!-- page 59 -->" not in r["content"]


def test_read_file_single_page_matches_the_real_failure(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "57"})
    assert r["pageStart"] == 57 == r["pageEnd"]
    assert "# Slide 57" in r["content"]


def test_read_file_page_out_of_range_is_an_error(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "99"})
    assert "error" in r and r["pagesInFile"] == 74


def test_read_file_pages_unavailable_without_markers(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    root = tmp_path / "school"
    (root / "2026F" / "CS1100A" / "notes").mkdir(parents=True)
    (root / "2026F" / "CS1100A" / "notes" / "plain.md").write_text(
        "no markers\nat all\n")
    r = content_read_file(page_db, page_cfg,
                          {"path": "2026F/CS1100A/notes/plain.md", "pages": "3"})
    assert "error" in r and r.get("pagesInFile") is None


def test_read_file_truncates_on_a_page_boundary_with_a_continuation_note(
        tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file, PAGE_READ_BUDGET
    _, rel = _deck(tmp_path, pages=74, lines_per_page=15, pad=50)
    # Precondition: the fixture MUST exceed the budget, or this test cannot fail
    # for the right reason (at pad=0 the deck is ~15.6 KB and nothing truncates).
    assert (page_cfg.data_root / rel).stat().st_size > PAGE_READ_BUDGET
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "1-74"})
    assert r["truncated"] is True and r["pageEnd"] < 74   # budget cut it
    # Whole-page delivery: the last delivered page is present and the next one
    # is not — a mid-page slice fails one of these two.
    assert f"<!-- page {r['pageEnd']} -->" in r["content"]
    assert f"<!-- page {r['pageEnd'] + 1} -->" not in r["content"]
    assert f'"{r["pageEnd"] + 1}-74"' in r["note"]   # note names the continuation
    assert len(r["content"]) <= PAGE_READ_BUDGET


def test_read_file_offset_mode_still_works_and_reports_pages(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "offset": 0, "limit": 5})
    assert r["offset"] == 0 and "total_lines" in r
    assert r["pagesInFile"] == 74                 # discovery for offset-mode reads


def test_pages_wins_over_offset(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg,
                          {"path": rel, "pages": "57", "offset": 0, "limit": 3})
    assert r["pageStart"] == 57 and "<!-- page 57 -->" in r["content"]


def test_pages_on_a_pdf_path_resolves_to_the_md_sibling(tmp_path, page_cfg, page_db):
    from pathlib import Path as _P
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    (page_cfg.data_root / rel).with_suffix(".pdf").write_bytes(
        b"%PDF-1.4 not a real pdf")
    r = content_read_file(page_db, page_cfg,
                          {"path": str(_P(rel).with_suffix(".pdf")), "pages": "57"})
    assert r["pageStart"] == 57 and "# Slide 57" in r["content"]


def test_over_wide_page_range_is_clamped_not_flagged_truncated(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "70-99"})
    assert r["truncated"] is False      # nothing was actually dropped
    assert r["pageEnd"] == 74           # clamped to the real page count
    assert '"75-99"' not in r["note"]  # must not name pages that do not exist


def test_pages_read_reports_the_starting_page_for_citations(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg, {"path": rel, "pages": "57-60"})
    # Citation attribution falls back to the LAST marker in the text, which would
    # file a page-57 answer under p.60 — so currentPage must be set explicitly.
    assert r["currentPage"] == 57


def test_single_page_larger_than_the_budget_is_reported_truncated(
        tmp_path, monkeypatch, page_cfg, page_db):
    import agent.tools as tools
    _, rel = _deck(tmp_path, pages=3, lines_per_page=40, pad=400)
    monkeypatch.setattr(tools, "PAGE_READ_BUDGET", 4_000)
    r = tools.content_read_file(page_db, page_cfg, {"path": rel, "pages": "1"})
    assert r["truncated"] is True       # hard-cut first page is NOT a full read
    assert "offset/limit" in r["note"]   # and the model is told how to get the rest


def test_explicit_null_offset_and_limit_do_not_raise(tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg,
                          {"path": rel, "offset": None, "limit": None})
    assert "error" not in r and r["offset"] == 0


def test_garbage_offset_and_limit_fall_back_instead_of_raising(
        tmp_path, page_cfg, page_db):
    from agent.tools import content_read_file
    _, rel = _deck(tmp_path)
    r = content_read_file(page_db, page_cfg,
                          {"path": rel, "offset": "abc", "limit": []})
    assert "error" not in r and r["offset"] == 0
    assert len(r["content"].splitlines()) <= 200   # limit fell back to 200
