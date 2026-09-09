# tests/test_convert.py
from pathlib import Path
from sync import convert


def test_is_office_source(tmp_path: Path):
    assert convert.is_office_source(Path("a.pptx"))
    assert convert.is_office_source(Path("A.DOCX"))
    assert not convert.is_office_source(Path("a.pdf"))
    assert not convert.is_office_source(Path("a.ppt"))


def test_converted_pdf_path():
    assert convert.converted_pdf_path(Path("/d/Lecture.pptx")) == Path("/d/Lecture.pdf")
    assert convert.converted_pdf_path(Path("/d/Notes.docx")) == Path("/d/Notes.pdf")


def test_skip_fresh_returns_existing(tmp_path: Path, monkeypatch):
    src = tmp_path / "S.pptx"
    src.write_bytes(b"fake")
    dest = tmp_path / "S.pdf"
    dest.write_bytes(b"pdf")
    import os
    os.utime(dest, (src.stat().st_mtime + 10, src.stat().st_mtime + 10))
    monkeypatch.setattr(convert, "_run_soffice", lambda *a, **k: (_ for _ in ()).throw(AssertionError("soffice must not run")))
    assert convert.convert_office_to_pdf(src) == dest


def test_missing_soffice_returns_none(tmp_path: Path, monkeypatch):
    src = tmp_path / "M.pptx"
    src.write_bytes(b"fake")
    monkeypatch.setattr(convert.shutil, "which", lambda _: None)
    assert convert.convert_office_to_pdf(src) is None


def test_non_office_returns_none(tmp_path: Path):
    p = tmp_path / "x.pdf"
    p.write_bytes(b"fake")
    assert convert.convert_office_to_pdf(p) is None
