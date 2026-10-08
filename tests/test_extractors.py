"""sync.extractors — pure file→text extraction, shared by sync and the
agent's extract_file tool."""
from __future__ import annotations

from pathlib import Path

import pytest

from sync.extractors import EXTRACTABLE_SUFFIXES, extract_to_text


def test_text_suffix_is_read_verbatim(tmp_path: Path):
    p = tmp_path / "a.md"
    p.write_text("# hi\n", encoding="utf-8")
    assert extract_to_text(p) == "# hi\n"


def test_unsupported_suffix_returns_none(tmp_path: Path):
    p = tmp_path / "a.zip"
    p.write_bytes(b"PK\x03\x04")
    assert extract_to_text(p) is None


def test_missing_file_returns_none(tmp_path: Path):
    assert extract_to_text(tmp_path / "nope.md") is None


def test_digital_pdf_keeps_page_markers(tmp_path: Path):
    # pymupdf's C extension needs libstdc++ on the loader path; skip where the
    # dev environment can't load it rather than failing the whole suite.
    try:
        import pymupdf
    except ImportError:
        pytest.skip("pymupdf shared libraries unavailable")

    p = tmp_path / "d.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "hello page one")
    doc.save(p)
    doc.close()

    out = extract_to_text(p)
    assert out is not None
    assert "<!-- page 1 -->" in out
    assert "hello page one" in out


def test_oversize_returns_none(tmp_path: Path):
    p = tmp_path / "big.md"
    p.write_text("x" * 100, encoding="utf-8")
    assert extract_to_text(p, max_bytes=10) is None


def test_suffixes_cover_office_and_text():
    for s in (
        ".pdf", ".docx", ".pptx", ".doc", ".md", ".txt", ".csv", ".json",
        ".html", ".py", ".yaml", ".ics",
    ):
        assert s in EXTRACTABLE_SUFFIXES
