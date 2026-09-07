"""Stable session affinity for LLM traffic (Bifrost PR #6818 compatible).

Campus sends a generic x-session-id (one stable value per conversation) plus
a Campus User-Agent on chat-completion calls. It must NEVER send the
provider-specific x-opencode-session header itself — Bifrost's transport
resolves affinity (verbatim x-opencode-session, else the session identity
incl. x-session-id, else a synth UUID) and forwards upstream on
opencode-family calls only.
"""

from agent.chat import (
    LLM_USER_AGENT,
    llm_headers,
    llm_session_headers,
    sanitize_session_id,
)
from sync.config import Config


def _cfg() -> Config:
    cfg = Config()
    cfg.llm_api_key = ""
    return cfg


def test_llm_headers_identifies_as_campus():
    headers = llm_headers(_cfg())
    assert headers["User-Agent"] == "Campus/0.1"
    assert LLM_USER_AGENT == "Campus/0.1"
    assert "Authorization" not in headers  # keyless stays keyless


def test_llm_headers_keeps_bearer_auth():
    cfg = _cfg()
    cfg.llm_api_key = "sk-test"
    headers = llm_headers(cfg)
    assert headers["Authorization"] == "Bearer sk-test"
    assert headers["User-Agent"] == "Campus/0.1"
    assert "python-httpx" not in headers["User-Agent"]


def test_sanitize_passes_through_uuids():
    convo = "550e8400-e29b-41d4-a716-446655440000"
    assert sanitize_session_id(convo) == convo


def test_sanitize_trims_and_strips_unsafe():
    assert sanitize_session_id("  abc-1  ") == "abc-1"
    # spaces / CRLF / controls / non-ASCII are removed, not forwarded
    assert sanitize_session_id("ab c") == "abc"
    assert sanitize_session_id("ab\r\nX-Injected: 1") == "abX-Injected1"  # ':' also stripped
    assert sanitize_session_id("conversación-1") == "conversacin-1"


def test_sanitize_rejects_unusable():
    assert sanitize_session_id(None) is None
    assert sanitize_session_id("") is None
    assert sanitize_session_id("   ") is None
    assert sanitize_session_id("   \r\n  ") is None


def test_sanitize_caps_length():
    long_id = "a" * 300
    out = sanitize_session_id(long_id)
    assert out == "a" * 255


def test_session_headers_send_generic_only():
    headers = llm_session_headers("conv-123")
    assert headers == {"x-session-id": "conv-123"}
    # provider-specific headers must never be emitted by Campus
    assert "x-opencode-session" not in headers
    assert "x-bf-session-id" not in headers
    assert "x-bf-eh-x-opencode-session" not in headers


def test_session_headers_omit_when_unusable():
    assert llm_session_headers(None) == {}
    assert llm_session_headers("") == {}
    assert llm_session_headers("  \r\n ") == {}
