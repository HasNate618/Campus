"""The eval harness's maths and its question loader.

The metrics decide what numbers get published, so they are pinned here: a
silent metric bug would produce a confident, wrong result table.
"""

from __future__ import annotations

import pytest


# ── metrics ─────────────────────────────────────────────────────────────────

def test_hit_at_k_respects_the_cutoff():
    from eval.run import hit_at_k

    expected = ["2026F/DEMO101/content/syllabus.md"]
    refs = ["a.md", "b.md", expected[0]]

    assert hit_at_k(refs, expected, 3) == 1.0
    assert hit_at_k(refs, expected, 2) == 0.0
    assert hit_at_k([], expected, 5) == 0.0


def test_hit_at_k_accepts_a_suffix_match():
    """Search returns data-root-relative refs; a question may write only the
    path from the course directory."""
    from eval.run import hit_at_k

    assert hit_at_k(["2026F/DEMO101/content/syllabus.md"],
                    ["content/syllabus.md"], 1) == 1.0
    assert hit_at_k(["content/syllabus.md"],
                    ["2026F/DEMO101/content/syllabus.md"], 1) == 1.0


def test_reciprocal_rank_uses_the_first_matching_position():
    from eval.run import reciprocal_rank

    expected = ["x.md"]
    assert reciprocal_rank(["x.md"], expected) == 1.0
    assert reciprocal_rank(["a", "x.md"], expected) == 0.5
    assert reciprocal_rank(["a", "b", "c", "x.md"], expected) == 0.25
    assert reciprocal_rank(["a", "b"], expected) == 0.0


def test_reciprocal_rank_ignores_lookalike_paths():
    from eval.run import reciprocal_rank

    assert reciprocal_rank(["notes/x.md"], ["x.md"]) == 0.0


def test_percentile_is_none_for_no_data():
    from eval.run import percentile

    assert percentile([], 90) is None
    assert percentile([1.0], 90) == 1.0


def test_percentile_is_monotonic():
    from eval.run import percentile

    values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    p50 = percentile(values, 50)
    p90 = percentile(values, 90)
    p100 = percentile(values, 100)
    assert p50 is not None and p90 is not None and p100 is not None
    assert p50 <= p90 <= p100


# ── questions ───────────────────────────────────────────────────────────────

def _write(tmp_path, text):
    p = tmp_path / "q.yaml"
    p.write_text(text, encoding="utf-8")
    return p


def test_load_questions_reads_the_example_file():
    from eval.run import DEFAULT_QUESTIONS, load_questions

    questions = load_questions(DEFAULT_QUESTIONS)

    assert len(questions) >= 4
    assert {q["kind"] for q in questions} >= {
        "exact_phrase", "paraphrase", "deadline", "multi_hop"}
    for q in questions:
        assert q["expected"]["files"]


def test_load_questions_rejects_a_missing_field(tmp_path):
    from eval.run import load_questions

    p = _write(tmp_path, "- id: q1\n  expected:\n    files: [a.md]\n")
    with pytest.raises(ValueError, match="question"):
        load_questions(p)


def test_load_questions_rejects_a_question_without_expected_files(tmp_path):
    from eval.run import load_questions

    p = _write(tmp_path, "- id: q1\n  question: hi\n  expected:\n    files: []\n")
    with pytest.raises(ValueError, match="expected.files"):
        load_questions(p)


def test_load_questions_rejects_an_empty_file(tmp_path):
    from eval.run import load_questions

    with pytest.raises(ValueError, match="no questions"):
        load_questions(_write(tmp_path, "[]\n"))


def test_load_questions_reports_a_missing_file(tmp_path):
    from eval.run import load_questions

    with pytest.raises(FileNotFoundError):
        load_questions(tmp_path / "nope.yaml")
