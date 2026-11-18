"""Pure report/digest rendering — no DB, no network, deterministic output."""
from __future__ import annotations

from typing import Any


def _report(**overrides: Any):
    from sync.report import ChangeCard, SyncReport

    base: dict[str, Any] = dict(
        run_id=42,
        started_at="2026-11-18T03:00:00",
        finished_at="2026-11-18T03:01:42",
        duration_s=102.0,
        trigger="cron",
        status="ok",
        courses_checked=6,
        courses_changed=1,
        stats={"files_new": 2, "files_changed": 1, "announcements_new": 1,
               "facts_added": 1, "pdfs_extracted": 0},
        changes=[ChangeCard("c1", 7, "SE 3352A", "file_new", "Week 11 slides.pdf",
                            href="/courses/7/content/12?file=9")],
        failures=[],
        warnings=[],
    )
    base.update(overrides)
    return SyncReport(**base)


def test_log_omits_unchanged_courses():
    from sync.report import ChangeCard, render_sync_log

    md = render_sync_log(_report(changes=[
        ChangeCard("c1", 7, "SE 3352A", "file_new", "Week 11 slides.pdf",
                   href="/courses/7/content/12?file=9"),
    ]))
    assert "SE 3352A" in md
    assert "[Week 11 slides.pdf](/courses/7/content/12?file=9)" in md
    assert "no changes" not in md
    assert "SE 3309A" not in md


def test_log_has_operational_header():
    md = __import__("sync.report", fromlist=["render_sync_log"]).render_sync_log(_report())
    assert "# Sync run 42 · 2026-11-18 03:00 · 1m 42s · ok · scheduled" in md
    assert "Checked 6 courses · 1 changed" in md
    assert "## Problems\n\nNone." in md


def test_extraction_skips_are_not_failures():
    from sync.report import render_sync_log

    md = render_sync_log(_report(
        warnings=["1 skipped (unsupported type)"],
        failures=[],
    ))
    assert "1 skipped (unsupported type)" in md
    assert md.index("1 skipped") < md.index("## Problems")
    assert "## Problems\n\nNone." in md


def test_fallback_digest_has_links_and_empty_case():
    from sync.report import render_digest_fallback

    md = render_digest_fallback(_report())
    assert "## What changed" in md
    assert "[Week 11 slides.pdf](/courses/7/content/12?file=9)" in md

    empty = render_digest_fallback(_report(changes=[], stats={}, courses_changed=0))
    assert "Nothing new in Brightspace since the last sync." in empty
    assert "## What changed" not in empty


def test_link_helpers_prefer_content_node():
    from sync.report import announcement_href, content_href

    course = {"id": 7, "term": "2026F", "code": "SE 3352A"}
    assert content_href(course, 9, 12, "2026F/SE3352A/content/Week11.pdf") == (
        "/courses/7/content/12?file=9")
    assert content_href(course, 9, None, "2026F/SE3352A/content/Week11.pdf") == (
        "/courses/7/workspace?path=content%2FWeek11.pdf")
    assert content_href(course, 9, None, "elsewhere/Week11.pdf") is None
    assert announcement_href(7, 55) == "/courses/7#announcement-55"


def test_strip_model_links():
    from sync.report import strip_model_links, substitute_card_links
    from sync.report import ChangeCard

    cards = [ChangeCard("c1", 7, "SE 3352A", "file_new", "Week 11 slides.pdf",
                        href="/courses/7/content/12?file=9")]
    raw = ("[evil](https://evil.example/x) <https://evil.example/y> "
           "https://evil.example/z\n[c1]")
    cleaned = strip_model_links(raw)
    assert "evil" not in cleaned
    out = substitute_card_links(cleaned, cards)
    assert "[Week 11 slides.pdf](/courses/7/content/12?file=9)" in out
    assert "c1" not in out
