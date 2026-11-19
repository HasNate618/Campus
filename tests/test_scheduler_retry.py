"""A failed scheduled run must not cancel the rest of the day.

The production failure this covers: the 05:00 slot fired, the token had expired,
the run failed in the same second — and the day was marked done, because the
state was written when trigger_sync returned 'started' (which happens before the
background thread does any work). No further attempt happened that day.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _settings_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    for key in ("CAMPUS_AUTO_SYNC_ENABLED", "CAMPUS_AUTO_SYNC_TIME",
                "CAMPUS_AUTO_SYNC_CATCH_UP", "CAMPUS_TIMEZONE"):
        monkeypatch.delenv(key, raising=False)
    (tmp_path / "settings.yaml").write_text(
        "auto_sync_enabled: true\nauto_sync_time: '05:00'\n"
        "auto_sync_catch_up: true\ntimezone: UTC\n", encoding="utf-8")


def _cfg(tmp_path: Path, **overrides):
    from sync.config import Config

    base: dict[str, Any] = dict(data_root=tmp_path, db_path=tmp_path / "h.db",
                                auto_sync_enabled=True, auto_sync_time="05:00",
                                auto_sync_catch_up=True, timezone="UTC")
    base.update(overrides)
    return Config(**base)


def _utc(h: int, minute: int = 0, day: int = 19) -> dt.datetime:
    return dt.datetime(2026, 11, day, h, minute, tzinfo=dt.timezone.utc)


def _run(run_id: int, status: str, trigger: str = "cron",
         started: str = "2026-11-19 05:00:51") -> dict:
    return {"id": run_id, "status": status, "trigger": trigger, "started_at": started}


def _patch(monkeypatch, runs: list[dict], outcome: str = "started"):
    import api.services as services

    calls: list[dict] = []
    monkeypatch.setattr(services, "list_sync_runs", lambda limit=10: runs)
    monkeypatch.setattr(
        services, "trigger_sync",
        lambda **kw: calls.append(kw) or {"status": outcome})
    return calls


def test_failed_run_leaves_the_day_due(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The exact production case: a failed cron run must not settle the day."""
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    calls = _patch(monkeypatch, [_run(187, "failed")])
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)

    assert sched.tick(now=_utc(5, 0)) == "started"
    state = read_state(state_path(cfg))
    assert state.last_date == "2026-11-19"
    assert state.attempts == 1
    # Not settled: the run failed.
    assert state.last_success_date is None

    # 31 minutes later the spacing has elapsed, so the day is retried.
    assert sched.tick(now=_utc(5, 31)) == "started"
    assert len(calls) == 2
    assert read_state(state_path(cfg)).attempts == 2


def test_successful_run_settles_the_day(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    runs = [_run(187, "failed")]
    calls = _patch(monkeypatch, runs)
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)

    assert sched.tick(now=_utc(5, 0)) == "started"
    # The retry succeeded: a later cron row for the same local date is ok.
    runs.insert(0, _run(188, "ok", started="2026-11-19 05:31:10"))
    assert sched.tick(now=_utc(5, 31)) == "not_due"
    state = read_state(state_path(cfg))
    assert state.last_success_date == "2026-11-19"
    assert len(calls) == 1  # no second launch once settled

    # And it stays settled for the rest of the day.
    assert sched.tick(now=_utc(23, 0)) == "not_due"
    assert len(calls) == 1


def test_retry_is_spaced_not_every_tick(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.scheduler import AutoSyncScheduler

    calls = _patch(monkeypatch, [_run(187, "failed")])
    sched = AutoSyncScheduler()
    assert sched.tick(now=_utc(5, 0)) == "started"
    # The tick runs every 60s; a failing run must not be relaunched each minute.
    assert sched.tick(now=_utc(5, 1)) == "not_due"
    assert sched.tick(now=_utc(5, 15)) == "not_due"
    assert sched.tick(now=_utc(5, 29)) == "not_due"
    assert len(calls) == 1
    assert sched.tick(now=_utc(5, 30)) == "started"
    assert len(calls) == 2


def test_attempts_are_capped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.scheduler import (MAX_ATTEMPTS_PER_DAY, AutoSyncScheduler,
                               read_state, state_path)

    calls = _patch(monkeypatch, [_run(187, "failed")])
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)
    # Space attempts far enough apart that only the cap can stop them.
    for i in range(MAX_ATTEMPTS_PER_DAY + 2):
        sched.tick(now=_utc(5, 0) + dt.timedelta(minutes=31 * i))
    assert len(calls) == MAX_ATTEMPTS_PER_DAY
    assert read_state(state_path(cfg)).attempts == MAX_ATTEMPTS_PER_DAY


def test_manual_success_does_not_settle_the_schedule(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A sync the user ran by hand is not the scheduled slot succeeding."""
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    calls = _patch(monkeypatch, [_run(190, "ok", trigger="manual")])
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)
    assert sched.tick(now=_utc(5, 0)) == "started"
    assert sched.tick(now=_utc(5, 31)) == "started"
    assert len(calls) == 2
    assert read_state(state_path(cfg)).last_success_date is None


def test_partial_counts_as_done(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Some courses synced: retrying all day would re-hit the same bad course."""
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    _patch(monkeypatch, [_run(187, "partial")])
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)
    assert sched.tick(now=_utc(5, 0)) == "started"
    assert sched.tick(now=_utc(6, 0)) == "not_due"
    assert read_state(state_path(cfg)).last_success_date == "2026-11-19"


def test_next_day_starts_fresh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    calls = _patch(monkeypatch, [_run(187, "failed")])
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)
    for i in range(3):
        sched.tick(now=_utc(5, 0) + dt.timedelta(minutes=31 * i))
    assert len(calls) == 3
    # Yesterday exhausted its attempts; today is a new slot with a fresh budget.
    assert sched.tick(now=_utc(5, 0, day=20)) == "started"
    state = read_state(state_path(cfg))
    assert state.last_date == "2026-11-20"
    assert state.attempts == 1


def test_old_state_file_without_the_new_fields_is_an_unsettled_attempt(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A state written by the previous version must not be read as success."""
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    cfg = _cfg(tmp_path)
    state_path(cfg).write_text(
        '{"last_date": "2026-11-19", "last_timezone": "UTC"}', encoding="utf-8")
    state = read_state(state_path(cfg))
    assert state.last_success_date is None
    assert state.attempts == 0

    calls = _patch(monkeypatch, [_run(187, "failed")])
    sched = AutoSyncScheduler()
    # attempts=0 and no timestamp, so it is due again immediately.
    assert sched.tick(now=_utc(6, 0)) == "started"
    assert len(calls) == 1


def test_settle_survives_a_run_history_read_failure(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A DB hiccup must not crash the tick or mark the day done."""
    import api.services as services
    from api.scheduler import AutoSyncScheduler, read_state, state_path

    def boom(limit=10):
        raise RuntimeError("db is locked")

    monkeypatch.setattr(services, "list_sync_runs", boom)
    calls: list[dict] = []
    monkeypatch.setattr(
        services, "trigger_sync",
        lambda **kw: calls.append(kw) or {"status": "started"})
    sched = AutoSyncScheduler()
    cfg = _cfg(tmp_path)
    assert sched.tick(now=_utc(5, 0)) == "started"
    assert read_state(state_path(cfg)).last_success_date is None
