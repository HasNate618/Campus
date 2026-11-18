"""Digest API reads the new layout first, with legacy fallback."""
from __future__ import annotations

import json
from pathlib import Path


def test_get_digest_prefers_new_layout(tmp_path: Path, monkeypatch):
    import api.services as services

    logs = tmp_path / "sync_logs"
    logs.mkdir()
    (logs / "digest.md").write_text("# New digest\n", encoding="utf-8")
    (logs / "digest.meta.json").write_text(json.dumps({
        "generated_at": "2026-11-18T03:00:00", "generated_by": "ai",
    }), encoding="utf-8")
    monkeypatch.setattr(services, "SCHOOL_ROOT", tmp_path)

    out = services.get_digest()
    assert out["markdown"] == "# New digest\n"
    assert out["generated_at"] == "2026-11-18T03:00:00"
    assert out["generated_by"] == "ai"
    assert out["source"] == str(logs / "digest.md")


def test_get_digest_legacy_fallback(tmp_path: Path, monkeypatch):
    import api.services as services

    logs = tmp_path / "sync_logs"
    logs.mkdir()
    legacy = logs / "2026-11-17.md"
    legacy.write_text("# Legacy\n", encoding="utf-8")
    monkeypatch.setattr(services, "SCHOOL_ROOT", tmp_path)

    out = services.get_digest()
    assert out["markdown"] == "# Legacy\n"
    assert out["generated_at"] == "2026-11-17"
    assert out["generated_by"] == "legacy"


def test_get_digest_empty(tmp_path: Path, monkeypatch):
    import api.services as services

    monkeypatch.setattr(services, "SCHOOL_ROOT", tmp_path)
    out = services.get_digest()
    assert out["markdown"] == ""
    assert out["generated_by"] == "legacy"
