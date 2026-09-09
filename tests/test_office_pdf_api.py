"""Converted-PDF serving contract (monkeypatched DB + school root)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest


@pytest.fixture()
def office_db(tmp_path: Path, monkeypatch):
    db = tmp_path / "harness.db"
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    with open("schema.sql") as f:
        conn.executescript(f.read())
    conn.execute("INSERT INTO courses (code,name,term) VALUES (?,?,?)", ("T 1000A", "T", "2026F"))
    conn.commit()
    conn.close()
    import api.config as _cfg
    import api.db as _db
    import api.services as _svc
    monkeypatch.setattr(_cfg, "DB_PATH", db)
    monkeypatch.setattr(_db, "DB_PATH", db)
    monkeypatch.setattr(_svc, "SCHOOL_ROOT", root)
    return db, root


def test_office_with_pdf_sibling_reports_pdf_format(office_db):
    _, root = office_db
    from api import services
    import api.db as _db
    src = root / "2026F" / "T1000A" / "content" / "D.pptx"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"fake-pptx")
    (src.with_suffix(".pdf")).write_bytes(b"%PDF-1.4 fake")
    (src.with_suffix(".md")).write_text("# Deck\n\nHello", encoding="utf-8")
    with _db.get_conn() as c:
        c.execute(
            "INSERT INTO files (course_id,path,kind,source,sha256,size,processed) VALUES (1,?, 'other','brightspace','x',1,0)",
            (str(src.relative_to(root)),))
        c.commit()
    f = services.get_file(1)
    assert f is not None
    content = services.get_file_content(1)
    assert content["format"] == "pdf"
    assert content["rawUrl"] == "/api/files/1/converted-pdf"
    assert "Hello" in content["content"]
    assert services.get_converted_pdf_path(1) == src.with_suffix(".pdf")


def test_office_without_sibling_is_download(office_db):
    _, root = office_db
    from api import services
    import api.db as _db
    src = root / "2026F" / "T1000A" / "content" / "E.docx"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"fake-docx")
    with _db.get_conn() as c:
        c.execute(
            "INSERT INTO files (course_id,path,kind,source,sha256,size,processed) VALUES (1,?, 'other','brightspace','y',1,0)",
            (str(src.relative_to(root)),))
        c.commit()
    content = services.get_file_content(1)
    assert content["format"] == "download"
    assert services.get_converted_pdf_path(1) is None
