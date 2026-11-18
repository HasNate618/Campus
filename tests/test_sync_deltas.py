"""Delta capture carries the IDs a digest needs to link back to content."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

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


class FakeClient:
    def __init__(self, payload=None, news=None):
        self.payload = payload
        self.news = news or []

    def le(self, org_unit: int, path: str) -> str:
        return f"https://lms.example{path}"

    def get_raw(self, url: str):
        return self.payload

    def get(self, url: str):
        return self.news


def test_topic_file_delta_has_ids(db, cfg, monkeypatch):
    from sync.sync import SyncEngine

    course = db.get_course_by_code("CS 1100A")
    node_id = db.upsert_content_node(course["id"], {
        "brightspace_id": 4242, "node_type": "topic", "topic_type": "file",
        "title": "Week 11", "url": None,
    })
    course_dir = cfg.data_root / course["term"] / course["code"].replace(" ", "")
    course_dir.mkdir(parents=True, exist_ok=True)
    client = FakeClient(SimpleNamespace(
        content=b"%PDF-1.4\nfake pdf",
        headers={"content-disposition": 'attachment; filename="week11.pdf"'},
    ))
    eng = SyncEngine(cfg, db, client=client)  # type: ignore[arg-type]
    eng._download_topic_file(course["id"], 12345, 4242, "Week 11",
                             course_dir / "content", [])

    assert len(eng.deltas) == 1
    d = eng.deltas[0]
    assert d["kind"] == "file_new"
    assert d["course_id"] == course["id"]
    assert d["title"] == "week11.pdf"
    assert d["node_id"] == node_id
    assert d["file_id"] > 0
    db.close()


def test_announcement_delta_has_announcement_id(db, cfg):
    from sync.sync import SyncEngine

    course = db.get_course_by_code("CS 1100A")
    news = [{
        "Id": 9001, "Title": "Room change", "Body": {"Text": "Friday moves to MTH 201."},
        "StartDate": "2026-11-20T09:00:00Z",
    }]
    eng = SyncEngine(cfg, db, client=FakeClient(news=news))  # type: ignore[arg-type]
    eng.sync_news(course["id"], 12345)

    assert len(eng.deltas) == 1
    assert eng.deltas[0]["kind"] == "announcement"
    ann_id = db.conn.execute(
        "SELECT id FROM announcements WHERE brightspace_id=9001").fetchone()[0]
    assert eng.deltas[0]["announcement_id"] == ann_id
    db.close()


def test_extraction_hard_failure_recorded(db, cfg, monkeypatch):
    from sync.sync import SyncEngine

    course = db.get_course_by_code("CS 1100A")
    rel = f"{course['term']}/CS1100A/broken.pdf"
    path = cfg.data_root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4\nbroken")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'slide','brightspace',10,'abc',0)", (course["id"], rel))
    db.conn.commit()

    eng = SyncEngine(cfg, db, client=FakeClient())  # type: ignore[arg-type]
    monkeypatch.setattr(eng, "extract_pdf", lambda row: False)
    eng.run_extraction_queue(course["id"])

    assert len(eng.extraction_failures) == 1
    assert rel in eng.extraction_failures[0]
    db.close()


def test_extraction_skips_are_not_failures(db, cfg):
    from sync.sync import SyncEngine

    course = db.get_course_by_code("CS 1100A")
    rel = f"{course['term']}/CS1100A/skeleton.zip"
    path = cfg.data_root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"PK\x03\x04")
    db.conn.execute(
        "INSERT INTO files (course_id, path, kind, source, size, sha256, processed)"
        " VALUES (?,?,'other','brightspace',4,'zip',0)", (course["id"], rel))
    db.conn.commit()

    eng = SyncEngine(cfg, db, client=FakeClient())  # type: ignore[arg-type]
    eng.run_extraction_queue(course["id"])

    assert eng.extraction_failures == []
    db.close()
