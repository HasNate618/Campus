"""The scheduler and manual button share one guarded trigger path."""
from __future__ import annotations

from types import SimpleNamespace

import pytest


class _FakeThread:
    def __init__(self, target, daemon=None):
        self.target = target

    def start(self):
        self.target()


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    def close(self):
        pass


class _FakeStore:
    def __init__(self, *args, **kwargs):
        pass

    def load(self):
        return "token"


class _FakeConn:
    def execute(self, query, args=()):
        return SimpleNamespace(fetchone=lambda: {"code": "CS 1100A"})


class _FakeDB:
    def __init__(self, path):
        self.conn = _FakeConn()

    # trigger_sync reserves the run row before the engine starts, so the live
    # log has a stable id from its first line. Without these the background
    # thread dies on AttributeError and the trigger label is never captured.
    def start_sync(self, trigger):
        return 1

    def finish_sync(self, run_id, status, error=None, **kw):
        pass

    def close(self):
        pass


@pytest.fixture()
def capture_sync(monkeypatch: pytest.MonkeyPatch):
    import api.services as services
    import sync.db as db_mod
    import sync.d2l as d2l_mod
    import sync.sync as sync_mod
    import sync.token_store as token_mod

    calls: list[dict] = []

    class FakeEngine:
        def __init__(self, cfg, db, client):
            pass

        def run(self, **kwargs):
            calls.append(kwargs)
            return 0

    monkeypatch.setattr(services, "threading", SimpleNamespace(Thread=_FakeThread))
    monkeypatch.setattr(d2l_mod, "D2LClient", _FakeClient)
    monkeypatch.setattr(sync_mod, "SyncEngine", FakeEngine)
    monkeypatch.setattr(token_mod, "TokenStore", _FakeStore)
    monkeypatch.setattr(db_mod, "DB", _FakeDB)
    monkeypatch.setattr(services, "_sync_in_progress", False)
    return calls


def test_scheduled_trigger_label(capture_sync: list[dict]):
    from api.services import trigger_sync

    out = trigger_sync(trigger="cron")
    assert out["status"] == "started"
    # run_id is passed through so the engine adopts the reserved row instead of
    # inserting a second one; the label is what this test is about.
    assert capture_sync == [{"code": None, "trigger": "cron", "run_id": 1}]


def test_manual_trigger_default(capture_sync: list[dict]):
    from api.services import trigger_sync

    trigger_sync()
    assert capture_sync == [{"code": None, "trigger": "manual", "run_id": 1}]


def test_overlap_guard(capture_sync: list[dict], monkeypatch: pytest.MonkeyPatch):
    import api.services as services

    monkeypatch.setattr(services, "_sync_in_progress", True)
    out = services.trigger_sync(trigger="cron")
    assert out["status"] == "in_progress"
    assert capture_sync == []
