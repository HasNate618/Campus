"""Schedule API contract — the shape the frontend depends on (web/src/types.ts).

These tests lock the DB→API mapping: day letters, 12h formatting, block
grouping by (kind, section), block/meeting ordering, and that pilot
courses without sessions are excluded.
"""

from __future__ import annotations

import json
import os

import pytest


def _schedule():
    """Import get_schedule against the fixture DB (CAMPUS_DB set by conftest)."""
    from api.services import get_schedule
    return get_schedule()


def test_schedule_shape(db):
    sched = _schedule()
    assert isinstance(sched, list) and sched
    c = sched[0]
    for key in ("id", "code", "name", "credit", "mode", "blocks"):
        assert key in c
    assert c["credit"] == "0.50"
    assert c["mode"] == "In Person"
    block = c["blocks"][0]
    for key in ("type", "section", "crn", "meetings"):
        assert key in block
    assert block["type"] in ("LEC", "LAB", "TUT")
    assert block["crn"] > 0
    m = block["meetings"][0]
    for key in ("day", "start", "end"):
        assert key in m
    assert m["day"] in ("M", "Tu", "W", "Th", "F", "Sa", "Su")


def test_time_12h_format(db):
    from api.services import _fmt_12h
    assert _fmt_12h("11:30") == "11:30 AM"
    assert _fmt_12h("18:30") == "6:30 PM"
    assert _fmt_12h("09:30") == "9:30 AM"
    assert _fmt_12h("00:30") == "12:30 AM"
    assert _fmt_12h("12:00") == "12:00 PM"
    assert _fmt_12h("23:59") == "11:59 PM"


def test_schedule_meetings_match_seed(db, seed_json):
    """The sample courses' sessions must appear exactly as seeded
    (rooms + times + days)."""
    from api.services import DAY_LETTERS
    sched = {c["code"].replace(" ", ""): c for c in _schedule()}
    for course in seed_json["courses"]:
        if not course.get("sessions"):
            continue
        key = course["code"].replace(" ", "")
        assert key in sched, f"{course['code']} missing from schedule"
        got = {
            (m["day"], m["start"], m["end"], m.get("room", ""))
            for b in sched[key]["blocks"] for m in b["meetings"]
        }
        expect = {
            (DAY_LETTERS[s["day"]], _12h(s["start"]), _12h(s["end"]), s.get("room", ""))
            for s in course["sessions"]
        }
        assert got == expect, f"{course['code']}: {got} != {expect}"


DAY_LETTERS = {0: "M", 1: "Tu", 2: "W", 3: "Th", 4: "F", 5: "Sa", 6: "Su"}


def _12h(t: str) -> str:
    hh, mm = t.split(":")
    h = int(hh) % 12 or 12
    return f"{h}:{mm} {'AM' if int(hh) < 12 else 'PM'}"


def test_blocks_grouped_by_kind_section(db):
    sched = _schedule()
    for c in sched:
        keys = [(b["type"], b["section"]) for b in c["blocks"]]
        assert len(keys) == len(set(keys)), f"{c['code']}: duplicate blocks {keys}"
        # sorted LEC < LAB < TUT
        order = [{"LEC": 0, "LAB": 1, "TUT": 2}[t] for t, _ in keys]
        assert order == sorted(order)


def test_courses_without_sessions_excluded(db):
    """Pilot fixture courses (no sessions) must not appear in the schedule."""
    sched = [c["code"].replace(" ", "") for c in _schedule()]
    assert all(s in sched for s in ("CS1100A", "ENG3300A"))  # have sessions
