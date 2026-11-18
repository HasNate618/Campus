"""In-process daily checker: due calculation, catch-up, and state safety."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _settings_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    for key in ("CAMPUS_AUTO_SYNC_ENABLED", "CAMPUS_AUTO_SYNC_TIME",
                "CAMPUS_AUTO_SYNC_CATCH_UP", "CAMPUS_TIMEZONE"):
        monkeypatch.delenv(key, raising=False)


def _cfg(tmp_path: Path, **overrides):
    from sync.config import Config

    base: dict[str, Any] = dict(data_root=tmp_path, db_path=tmp_path / "h.db",
                auto_sync_enabled=True, auto_sync_time="03:00",
                auto_sync_catch_up=True)
    base.update(overrides)
    return Config(**base)


def _utc(y: int, m: int, d: int, h: int, minute: int) -> dt.datetime:
    return dt.datetime(y, m, d, h, minute, tzinfo=dt.timezone.utc)


def test_parse_clock():
    from api.scheduler import parse_clock  # pyright: ignore[reportMissingImports]

    assert parse_clock("03:00") == dt.time(3, 0)
    assert parse_clock("23:59") == dt.time(23, 59)
    assert parse_clock("24:00") is None
    assert parse_clock("nope") is None


def test_before_time_not_due(tmp_path: Path):
    from api.scheduler import due_date  # pyright: ignore[reportMissingImports]

    cfg = _cfg(tmp_path, timezone="UTC")
    assert due_date(_utc(2026, 11, 18, 2, 59), cfg, None) is None


def test_catch_up_runs_once_after_missed_days(tmp_path: Path):
    from api.scheduler import ScheduleState, due_date  # pyright: ignore[reportMissingImports]

    cfg = _cfg(tmp_path, timezone="UTC")
    now = _utc(2026, 11, 18, 10, 0)  # three days past the slot
    assert due_date(now, cfg, None) == now.date()
    state = ScheduleState(last_date="2026-11-18", last_timezone="UTC")
    assert due_date(now, cfg, state) is None


def test_catch_up_off_window(tmp_path: Path):
    from api.scheduler import due_date  # pyright: ignore[reportMissingImports]

    cfg = _cfg(tmp_path, timezone="UTC", auto_sync_catch_up=False)
    assert due_date(_utc(2026, 11, 18, 3, 5), cfg, None) == dt.date(2026, 11, 18)
    assert due_date(_utc(2026, 11, 18, 3, 30), cfg, None) is None


def test_timezone_boundary(tmp_path: Path):
    from api.scheduler import due_date  # pyright: ignore[reportMissingImports]

    cfg = _cfg(tmp_path, timezone="America/Toronto")  # UTC-5 in November
    assert due_date(_utc(2026, 11, 18, 6, 30), cfg, None) is None
    assert due_date(_utc(2026, 11, 18, 8, 30), cfg, None) == dt.date(2026, 11, 18)


def test_corrupt_state_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.scheduler import read_state, state_path  # pyright: ignore[reportMissingImports]

    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    path = state_path(_cfg(tmp_path))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("not json", encoding="utf-8")
    state = read_state(path)
    assert state.last_date is None
    assert state.last_timezone is None


def test_in_progress_does_not_mark_date(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import api.services as services
    from api.scheduler import AutoSyncScheduler, read_state, state_path  # pyright: ignore[reportMissingImports]

    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    (tmp_path / "settings.yaml").write_text(
        "auto_sync_enabled: true\nauto_sync_time: '03:00'\n"
        "auto_sync_catch_up: true\ntimezone: UTC\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr(
        services, "trigger_sync", lambda **kw: calls.append(kw) or {"status": "in_progress"})
    sched = AutoSyncScheduler()
    result = sched.tick(now=_utc(2026, 11, 18, 8, 30))
    assert result == "in_progress"
    assert calls == [{"trigger": "cron"}]
    assert read_state(state_path(_cfg(tmp_path))).last_date is None


def test_settings_change_observed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import api.services as services
    from api.scheduler import AutoSyncScheduler  # pyright: ignore[reportMissingImports]

    settings = tmp_path / "settings.yaml"
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(settings))
    settings.write_text(
        "auto_sync_enabled: true\nauto_sync_time: '03:00'\n"
        "auto_sync_catch_up: true\ntimezone: UTC\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr(
        services, "trigger_sync", lambda **kw: calls.append(kw) or {"status": "started"})
    sched = AutoSyncScheduler()
    now = _utc(2026, 11, 18, 8, 30)
    assert sched.tick(now=now) == "started"

    settings.write_text(
        "auto_sync_enabled: true\nauto_sync_time: '12:00'\n"
        "auto_sync_catch_up: true\ntimezone: UTC\n", encoding="utf-8")
    assert sched.tick(now=now) == "not_due"
    assert len(calls) == 1
