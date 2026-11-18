"""AI digest: bounded cards, marker-only links, deterministic degradation."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from sync.digest import make_digest


@pytest.fixture()
def cfg(tmp_path: Path, db_path: Path):
    from sync.config import Config
    return Config(data_root=tmp_path, db_path=db_path, llm_model="test-model",
                  llm_url="http://llm.example/v1")


@pytest.fixture()
def db(db_path: Path):
    from sync.db import DB
    d = DB(db_path)
    yield d
    d.close()


def _report(**overrides: Any) -> Any:
    from sync.report import ChangeCard, SyncReport

    base: dict[str, Any] = dict(
        run_id=99, started_at="2026-11-18T03:00:00",
        finished_at="2026-11-18T03:01:00", duration_s=60.0,
        trigger="cron", status="ok", courses_checked=2, courses_changed=1,
        stats={"files_new": 1, "files_changed": 0, "announcements_new": 1,
               "facts_added": 0, "events_added": 0, "assignments_added": 0},
        changes=[ChangeCard("", 7, "SE 3352A", "announcement", "Room change",
                            "x" * 500,
                            href="/courses/7#announcement-55")],
        failures=[],
    )
    base.update(overrides)
    return SyncReport(**base)


def _fake_post(monkeypatch: pytest.MonkeyPatch, content: str,
               captured: dict[str, Any] | None = None) -> None:
    def post(url: str, **kwargs: Any) -> Any:
        if captured is not None:
            captured["url"] = url
            captured.update(kwargs)
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"choices": [{"message": {"content": content}}]},
        )
    monkeypatch.setattr("sync.digest.httpx.post", post)


def test_no_llm_uses_fallback(cfg):
    cfg.llm_url = ""
    cfg.llm_urls = []
    md, source = make_digest(cfg, "test-model", _report())
    assert source == "deterministic"
    assert "## What changed" in md


def test_marker_substitution(cfg, monkeypatch):
    _fake_post(monkeypatch, "What changed\n[c1]")
    md, source = make_digest(cfg, "test-model", _report())
    assert source == "ai"
    assert "[Room change](/courses/7#announcement-55)" in md
    assert "c1" not in md


def test_raw_model_links_are_stripped(cfg, monkeypatch):
    raw = ("[evil](https://evil.example/x) <https://evil.example/y> "
           "https://evil.example/z\n[c1]")
    _fake_post(monkeypatch, raw)
    md, source = make_digest(cfg, "test-model", _report())
    assert source == "ai"
    assert "evil" not in md
    assert "[Room change](/courses/7#announcement-55)" in md


def test_unknown_marker_dropped(cfg, monkeypatch):
    _fake_post(monkeypatch, "Something odd [c99] happened.")
    md, source = make_digest(cfg, "test-model", _report())
    assert source == "ai"
    assert "c99" not in md


def test_model_failure_uses_fallback(cfg, monkeypatch):
    def fail(url, **kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr("sync.digest.httpx.post", fail)
    md, source = make_digest(cfg, "test-model", _report())
    assert source == "deterministic"
    assert "## What changed" in md


def test_payload_is_bounded(cfg, monkeypatch):
    captured: dict[str, Any] = {}
    _fake_post(monkeypatch, "[c1]", captured)
    make_digest(cfg, "test-model", _report())
    user_text = captured["json"]["messages"][1]["content"]
    assert "[c1]" in user_text
    assert "x" * 241 not in user_text  # excerpt capped at 240 chars


def test_failed_run_does_not_overwrite_digest(db, cfg):
    from sync.sync import SyncEngine

    logs = cfg.data_root / "sync_logs"
    logs.mkdir(parents=True, exist_ok=True)
    (logs / "digest.md").write_text("GOOD DIGEST\n")
    (logs / "digest.meta.json").write_text(
        json.dumps({"generated_at": "2026-11-17T03:00:00", "generated_by": "ai"}))

    run_id = db.start_sync("cron")
    eng = SyncEngine(cfg, db, client=MagicMock())  # type: ignore[arg-type]
    failed = _report(run_id=run_id, status="failed", failures=["boom"])
    eng.write_run_artifacts(failed)

    assert (logs / "digest.md").read_text() == "GOOD DIGEST\n"
    assert json.loads((logs / "digest.meta.json").read_text())["generated_by"] == "ai"
    assert list((logs / "runs").rglob(f"{run_id}.md"))
    db.close()
