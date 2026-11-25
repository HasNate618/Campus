"""Regression tests for the auditor's remaining timezone findings."""
from __future__ import annotations

import datetime as dt

import pytest

from agent.timeutil import parse_harness_dt
from sync.config import Config


@pytest.fixture
def cfg(tmp_path):
    return Config(data_root=tmp_path, db_path=tmp_path / "h.db",
                  timezone="America/Toronto")


def test_assignment_state_compares_instants_not_strings(cfg):
    from agent.tools import _assignment_state

    past_utc = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z")
    future_utc = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z")
    assert _assignment_state({"due_at": past_utc}, cfg) == "overdue"
    assert _assignment_state({"due_at": future_utc}, cfg) == "open"

    # A naive local deadline that is still in the future in Toronto must not be
    # declared overdue because its string sorts below a UTC 'now'.
    tomorrow = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).strftime(
        "%Y-%m-%dT%H:%M:%S")
    assert _assignment_state({"due_at": tomorrow}, cfg) == "open"


def test_events_next_days_exposes_a_local_deadline(monkeypatch):
    import api.services as services

    # CI has no settings.yaml, so the zone would fall back to UTC. Pin it via
    # the documented env override that Config.load reads on every call.
    monkeypatch.setenv("CAMPUS_TIMEZONE", "America/Toronto")
    monkeypatch.setattr(services, "_rows",
                        lambda q, args: [{"id": 1, "starts_at": "2026-12-07T04:59:59.000Z"}])
    monkeypatch.setattr(services, "_dedupe_deadlines", lambda rows: rows)
    rows = services.events_next_days(7)
    assert rows[0]["starts_at"] == "2026-12-07T04:59:59.000Z"  # raw preserved
    assert rows[0]["starts_at_local"] == "Sun Dec 06, 2026 23:59"
    assert rows[0]["timezone"] == "America/Toronto"


def test_naive_due_at_is_parsed_as_utc(cfg):
    d = parse_harness_dt("2026-11-29T23:59", cfg)
    assert d.tzinfo == dt.timezone.utc
    assert d.astimezone(cfg and __import__("zoneinfo").ZoneInfo("America/Toronto")).hour == 18
