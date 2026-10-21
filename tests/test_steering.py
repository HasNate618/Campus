"""A message typed mid-turn is read by the model at the next step.

Without this the only options are "wait" and "stop and start over". The steer is
drained at the step boundary in run_turn, so it arrives as an ordinary user
message in the same conversation — the model sees it before it decides what to do
next, and the tool work already done is kept.
"""

import pytest


def test_a_steer_reaches_the_model_without_restarting_the_turn(db_path, monkeypatch):
    from agent import chat as chat_mod

    class Cfg:
        llm_model = "test-model"
        llm_max_tokens = 0
        llm_request_timeout_s = 30
        llm_tool_choice = None
        data_root = str(db_path.parent)
        llm_api_key = ""
        llm_url = "http://example.invalid/v1"

        def llm_endpoints(self):
            return [self.llm_url]

    seen: list[list[dict]] = []
    pending = ["actually use graphviz, not mermaid"]

    def fake_model_call(cfg, messages, model=None, **kwargs):
        # snapshot: run_turn mutates this list across steps
        seen.append([dict(m) for m in messages])
        return {"role": "assistant", "content": "ok"}, None

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)

    from sync.db import DB
    db = DB(str(db_path))
    steering_calls = {"n": 0}

    def steering():
        steering_calls["n"] += 1
        if steering_calls["n"] == 1:
            return list(pending)
        return []

    answer, _history = chat_mod.run_turn(Cfg(), db, "draw the NFA", course_id=None,
                                         verbose=False, steering=steering)
    db.close()

    assert answer == "ok"
    assert steering_calls["n"] >= 1, "the turn must actually poll for steering"
    texts = [m.get("content") for m in seen[0]]
    assert any(isinstance(t, str) and "actually use graphviz" in t for t in texts), \
        "the steering text must be in the messages sent to the model"


def test_steering_that_raises_cannot_break_the_turn(db_path, monkeypatch):
    from agent import chat as chat_mod

    class Cfg:
        llm_model = "test-model"
        llm_max_tokens = 0
        llm_request_timeout_s = 30
        llm_tool_choice = None
        data_root = str(db_path.parent)
        llm_api_key = ""
        llm_url = "http://example.invalid/v1"

        def llm_endpoints(self):
            return [self.llm_url]

    def fake_model_call(cfg, messages, model=None, **kwargs):
        return {"role": "assistant", "content": "fine"}, None

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)

    from sync.db import DB
    db = DB(str(db_path))

    def exploding_steering():
        raise RuntimeError("queue unavailable")

    answer, _h = chat_mod.run_turn(Cfg(), db, "hello", course_id=None,
                                   verbose=False, steering=exploding_steering)
    db.close()
    assert answer == "fine"
