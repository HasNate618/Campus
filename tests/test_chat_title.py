"""Tests for first-exchange chat title generation (agent/chat.py)."""
from __future__ import annotations

import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _chat_db(tmp_path: Path):
    dbp = tmp_path / "t.db"
    conn = sqlite3.connect(dbp)
    conn.row_factory = sqlite3.Row
    conn.executescript((REPO / "schema.sql").read_text())
    sid = conn.execute(
        "INSERT INTO chat_sessions (course_id, title) VALUES (NULL, 'New chat')"
    ).lastrowid
    conn.commit()

    class DB:
        pass
    db = DB()
    db.conn = conn

    class Cfg:
        data_root = str(tmp_path)
        llm_model = "test-model"
    return db, Cfg(), sid, conn


def _add_exchange(conn, sid, n=1):
    for _ in range(n):
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)",
            (sid, "user", "What is the iClicker code?"))
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)",
            (sid, "assistant", "The code is XWAH [cite:1]."))
    conn.commit()


def test_clean_title():
    from agent.chat import clean_title
    assert clean_title('  "IDN Homograph Attacks"  ') == "IDN Homograph Attacks"
    assert clean_title("**When is Lab 1 due?**") == "When is Lab 1 due?"
    assert clean_title("# Title\nwith newline") == "Title with newline"
    assert len(clean_title("x" * 200)) <= 60
    assert clean_title("") == ""
    assert clean_title('""') == ""


def test_generate_title_first_exchange(tmp_path, monkeypatch):
    import agent.chat as chat_mod
    db, cfg, sid, conn = _chat_db(tmp_path)
    _add_exchange(conn, sid, 1)
    seen = {}

    def fake_model_call(c, messages, model=None, **kw):
        seen["model"] = model
        assert len(messages) == 1 and messages[0]["role"] == "user"
        return ({"role": "assistant", "content": '"iClicker Join Code" '}, None)

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)
    title = chat_mod.generate_session_title(db, cfg, sid, "session-model",
                                            "What is the code?", "XWAH [cite:1]")
    assert title == "iClicker Join Code"
    assert seen["model"] == "session-model"  # same model as the first message
    row = conn.execute("SELECT title FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    assert row["title"] == "iClicker Join Code"
    conn.close()


def test_generate_title_defaults_to_config_model(tmp_path, monkeypatch):
    import agent.chat as chat_mod
    db, cfg, sid, conn = _chat_db(tmp_path)
    _add_exchange(conn, sid, 1)
    seen = {}

    def fake_model_call(c, messages, model=None, **kw):
        seen["model"] = model
        return ({"role": "assistant", "content": "Lab dates"}, None)

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)
    assert chat_mod.generate_session_title(db, cfg, sid, None, "q", "a") == "Lab dates"
    assert seen["model"] == "test-model"
    conn.close()


def test_generate_title_skips_later_turns(tmp_path, monkeypatch):
    import agent.chat as chat_mod
    db, cfg, sid, conn = _chat_db(tmp_path)
    _add_exchange(conn, sid, 2)
    called = []

    def fake_model_call(*a, **k):
        called.append(True)
        return ({"role": "assistant", "content": "X"}, None)

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)
    assert chat_mod.generate_session_title(db, cfg, sid, "m", "q", "a") is None
    assert not called  # no wasted LLM call past the first exchange
    row = conn.execute("SELECT title FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    assert row["title"] == "New chat"
    conn.close()


def test_generate_title_failure_keeps_placeholder(tmp_path, monkeypatch):
    import agent.chat as chat_mod
    db, cfg, sid, conn = _chat_db(tmp_path)
    _add_exchange(conn, sid, 1)

    def boom(*a, **k):
        raise RuntimeError("endpoint down")

    monkeypatch.setattr(chat_mod, "_model_call", boom)
    assert chat_mod.generate_session_title(db, cfg, sid, "m", "q", "a") is None
    row = conn.execute("SELECT title FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    assert row["title"] == "New chat"
    conn.close()
