"""Config precedence + portability: defaults < config.yaml < env vars.

The public repo must run with NO personal configuration — these tests
lock in that contract (empty defaults, no school-specific strings).
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    """No stray CAMPUS_* env shadowing the test; HOME pinned so
    Path.home() (used by token_dir defaults) resolves deterministically."""
    for k in list(os.environ):
        if k.startswith("CAMPUS_"):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))


def test_defaults_are_portable():
    from sync.config import Config

    cfg = Config()
    assert cfg.base_url == ""  # LMS URL must be explicit, never defaulted
    assert cfg.username == ""
    assert cfg.brightspace_hosts == []  # proxy disabled by default
    assert cfg.brightspace_base_url == ""
    assert cfg.llm_api_key == ""
    assert cfg.institution == ""
    assert str(cfg.data_root).endswith("school")  # ./school, not /srv/homelab
    # No homelab-specific service defaults leak into a fresh checkout:
    assert cfg.llm_url == ""           # empty = harness runs without an LLM
    assert cfg.llm_model == ""         # empty = must be set to chat
    assert cfg.ntfy_url == ""          # empty = notifications disabled
    assert cfg.mcp_url == ""           # empty = no external MCP tools
    assert cfg.embed_model == ""       # empty = lexical corpus search (no embed model)
    assert cfg.rerank_model == ""      # empty = no rerank (most endpoints lack it)
    assert "18081" not in str(cfg.llm_url)   # bifrost port must not be a default
    assert "11236" not in str(cfg.mcp_url)   # trawl port must not be a default
    assert "8085" not in str(cfg.ntfy_url)   # ntfy port must not be a default


def test_env_overrides(monkeypatch):
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_LLM_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("CAMPUS_LLM_API_KEY", "sk-test")
    monkeypatch.setenv("CAMPUS_BRIGHTSPACE_HOSTS", "uni.edu, s.uni.edu")
    monkeypatch.setenv("CAMPUS_TIMEZONE", "Europe/Berlin")

    cfg = Config.load()
    assert cfg.llm_url == "https://api.openai.com/v1"
    assert cfg.llm_api_key == "sk-test"
    assert cfg.brightspace_hosts == ["uni.edu", "s.uni.edu"]
    assert cfg.timezone == "Europe/Berlin"


def test_legacy_bifrost_env_is_gone(monkeypatch):
    """The old CAMPUS_BIFROST_URL alias was removed — a stale env var must
    NOT silently rewire the endpoint."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_BIFROST_URL", "http://old-gateway:8080/v1")
    cfg = Config.load()
    assert "old-gateway" not in cfg.llm_url


def test_config_yaml_not_required(tmp_path, monkeypatch):
    """Config.load() with no config.yaml present falls back to defaults/env."""
    from sync.config import Config

    monkeypatch.chdir(tmp_path)  # REPO_ROOT is module-relative, not cwd — still fine
    monkeypatch.setenv("CAMPUS_LLM_MODEL", "some-model")
    cfg = Config.load()
    assert cfg.llm_model == "some-model"


def test_multiple_llm_endpoints_failover(monkeypatch):
    """llm_urls / CAMPUS_LLM_URLS build an ordered failover list; llm_url is
    the single-entry alias. llm_endpoints() collapses to one source."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_LLM_URLS", "https://a/v1, https://b/v1")
    cfg = Config.load()
    assert cfg.llm_endpoints() == ["https://a/v1", "https://b/v1"]

    monkeypatch.setenv("CAMPUS_LLM_URL", "https://single/v1")
    monkeypatch.delenv("CAMPUS_LLM_URLS", raising=False)
    cfg2 = Config.load()
    assert cfg2.llm_endpoints() == ["https://single/v1"]


def test_multiple_mcp_endpoints_merged(monkeypatch):
    """mcp_urls / CAMPUS_MCP_URLS merge several servers; mcp_url is the
    single-entry alias. mcp_endpoints() collapses to one source."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_MCP_URLS", "http://s1/mcp, http://s2/mcp")
    cfg = Config.load()
    assert cfg.mcp_endpoints() == ["http://s1/mcp", "http://s2/mcp"]

    monkeypatch.setenv("CAMPUS_MCP_URL", "http://single/mcp")
    monkeypatch.delenv("CAMPUS_MCP_URLS", raising=False)
    cfg2 = Config.load()
    assert cfg2.mcp_endpoints() == ["http://single/mcp"]
