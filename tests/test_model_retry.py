"""A provider blip must not end the turn.

Nineteen of thirty failed turns in three weeks were the same string: "Client
error '400 Bad Request' for url .../chat/completions". Bifrost's own log shows
the upstream returning error then success three seconds later, so the failure was
transient and a retry would have answered the question.
"""

import httpx
import pytest

from agent import chat as chat_mod


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "http://bifrost:8080/v1/chat/completions")
    resp = httpx.Response(code, request=req, text='{"error":"x"}')
    return httpx.HTTPStatusError(f"Client error '{code}'", request=req, response=resp)


class _Cfg:
    llm_retry_attempts = 3


def test_a_blipped_provider_is_retried_and_the_turn_survives(monkeypatch):
    calls = {"n": 0}

    def fake_once(*a, **k):
        calls["n"] += 1
        if calls["n"] < 3:
            raise _status_error(400)          # what bifrost returns on a blip
        return {"role": "assistant", "content": "hello"}, None

    monkeypatch.setattr(chat_mod, "_model_call_once", fake_once)
    monkeypatch.setattr(chat_mod, "_time", None, raising=False)
    monkeypatch.setattr("time.sleep", lambda s: None)

    msg, usage = chat_mod._model_call(_Cfg(), [{"role": "user", "content": "hi"}])
    assert msg["content"] == "hello"
    assert calls["n"] == 3


def test_a_payload_the_provider_keeps_rejecting_still_fails(monkeypatch):
    calls = {"n": 0}

    def always_400(*a, **k):
        calls["n"] += 1
        raise _status_error(400)

    monkeypatch.setattr(chat_mod, "_model_call_once", always_400)
    monkeypatch.setattr("time.sleep", lambda s: None)

    with pytest.raises(httpx.HTTPStatusError):
        chat_mod._model_call(_Cfg(), [{"role": "user", "content": "hi"}])
    assert calls["n"] == 3          # bounded: it must not retry forever


def test_a_permanent_client_error_is_not_retried(monkeypatch):
    calls = {"n": 0}

    def unauthorised(*a, **k):
        calls["n"] += 1
        raise _status_error(401)

    monkeypatch.setattr(chat_mod, "_model_call_once", unauthorised)
    monkeypatch.setattr("time.sleep", lambda s: None)

    with pytest.raises(httpx.HTTPStatusError):
        chat_mod._model_call(_Cfg(), [{"role": "user", "content": "hi"}])
    assert calls["n"] == 1


def test_timeouts_are_retryable():
    assert chat_mod._retryable_model_error(httpx.ReadTimeout("timed out"))
    assert chat_mod._retryable_model_error(_status_error(503))
    assert not chat_mod._retryable_model_error(_status_error(401))
    assert not chat_mod._retryable_model_error(ValueError("bad argument"))


def test_empty_messages_are_dropped_but_tool_traffic_is_kept():
    messages = [
        {"role": "system", "content": "you are helpful"},
        {"role": "user", "content": ""},                     # the poison entry
        {"role": "user", "content": "a real question"},
        {"role": "assistant", "content": ""},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "content": ""},
        {"role": "user", "content": [{"type": "text", "text": "  "}]},
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:x"}}]},
    ]
    chat_mod._drop_empty_messages(messages)
    roles = [(m["role"], bool(m.get("tool_calls") or m.get("tool_call_id"))) for m in messages]
    assert len(messages) == 5
    assert ("user", False) in roles                      # the real question
    assert all("a real question" != m.get("content") or True for m in messages)
    # tool call and its result survive, an image-only message survives
    assert sum(1 for m in messages if m.get("tool_calls") or m.get("tool_call_id")) == 2
    assert any(isinstance(m.get("content"), list) and m["content"][0].get("type") == "image_url"
               for m in messages)
    assert not any(m.get("content") == "" and not m.get("tool_calls")
                   and not m.get("tool_call_id") for m in messages)
