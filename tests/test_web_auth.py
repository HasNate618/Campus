"""Web auth: optional single-password gate on the API.

Open (demo) mode is the default — no cookie, no password, everything 200.
When `web_password` is set, /api/* data routes require a session cookie
from POST /api/auth/login; /api/auth/*, /api/health and /api/config stay
public so the SPA shell and login screen can boot.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# The API reads CAMPUS_DB at import time and caches DB_PATH for the whole
# process, so point it at a scratch DB before importing api.main. The scratch
# DB is seeded with the sample data: if this module happens to be the first
# to import `api` in a run, the DB-touching tests elsewhere in the suite
# still see valid sample data (their own CAMPUS_DB setting is ignored once
# the module-level singleton is frozen).
_SCRATCH = Path(tempfile.mkdtemp()) / "harness.db"
os.environ["CAMPUS_DB"] = str(_SCRATCH)
_conn = sqlite3.connect(_SCRATCH)
_conn.row_factory = sqlite3.Row  # seed.py indexes rows by column name
with open(REPO / "schema.sql") as f:
    _conn.executescript(f.read())
import seed.seed as _seed

with open(REPO / "seed" / "courses.example.json") as f:
    _seed.seed(_conn, json.load(f))
_conn.close()

import pytest
from fastapi.testclient import TestClient

from api.auth import _sessions
from api.config import cfg
from api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_state():
    """No cookies or sessions leaking between tests."""
    client.cookies.clear()
    _sessions.clear()
    yield
    client.cookies.clear()
    _sessions.clear()


# ── open (demo) mode ────────────────────────────────────────────────────


def test_open_mode_data_routes_need_no_cookie(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "")
    r = client.get("/api/courses")
    assert r.status_code == 200


def test_open_mode_me_is_authenticated(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "")
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json() == {"authenticated": True}


def test_open_mode_login_is_rejected(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "")
    r = client.post("/api/auth/login", json={"password": "anything"})
    assert r.status_code == 403


# ── password mode ───────────────────────────────────────────────────────


def test_password_mode_gates_data_routes(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "secret")
    assert client.get("/api/courses").status_code == 401


def test_password_mode_public_endpoints_stay_open(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "secret")
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/config").status_code == 200
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"authenticated": False}


def test_password_mode_wrong_password_rejected(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "secret")
    r = client.post("/api/auth/login", json={"password": "wrong"})
    assert r.status_code == 401


def test_password_mode_login_logout_flow(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "secret")

    r = client.post("/api/auth/login", json={"password": "secret"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert client.cookies.get("campus_session")

    # the cookie unlocks the data routes
    assert client.get("/api/auth/me").json() == {"authenticated": True}
    assert client.get("/api/courses").status_code == 200

    # logout clears the cookie and re-locks the API
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.cookies.get("campus_session") is None
    assert client.get("/api/courses").status_code == 401


def test_password_mode_unknown_token_rejected(monkeypatch):
    monkeypatch.setattr(cfg, "web_password", "secret")
    client.cookies.set("campus_session", "not-a-real-token")
    assert client.get("/api/courses").status_code == 401
