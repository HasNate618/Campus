"""Config precedence + portability: defaults < config.yaml < env vars < settings.yaml.

The public repo must run with NO personal configuration — these tests
lock in that contract (empty defaults, no school-specific strings).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    """No stray CAMPUS_*/OPENAI_* env shadowing the test; HOME pinned so
    Path.home() (used by token_dir defaults) resolves deterministically.

    OPENAI_* matters as much as CAMPUS_*: the LLM settings live under those
    names, so a developer who exported OPENAI_MODEL (as the deploy docs tell
    them to) would otherwise redden the tests that assert empty defaults.
    """
    for k in list(os.environ):
        if k.startswith("CAMPUS_") or k.startswith("OPENAI_"):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    # Never read a developer's real data/settings.yaml. _clean_env deletes
    # every CAMPUS_* var above, so the pin must be re-established here.
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))


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

    monkeypatch.setenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("CAMPUS_BRIGHTSPACE_HOSTS", "uni.edu, s.uni.edu")
    monkeypatch.setenv("CAMPUS_TIMEZONE", "Europe/Berlin")

    cfg = Config.load()
    assert cfg.llm_url == "https://api.openai.com/v1"
    assert cfg.llm_api_key == "sk-test"
    assert cfg.brightspace_hosts == ["uni.edu", "s.uni.edu"]
    assert cfg.timezone == "Europe/Berlin"


def test_env_set_attrs_normalises_csv_aliases(monkeypatch):
    """The *_csv pseudo-attrs must never leak: they match no registry key, so
    a failover deployment would look unconfigured."""
    from sync.config import env_set_attrs

    monkeypatch.setenv("OPENAI_ENDPOINTS", "https://a/v1, https://b/v1")
    monkeypatch.setenv("CAMPUS_MCP_URLS", "http://s1/mcp")
    attrs = env_set_attrs()
    assert "llm_urls" in attrs
    assert "mcp_urls" in attrs
    assert not any(a.endswith("_csv") for a in attrs)


def test_env_set_attrs_covers_extras_and_secrets(monkeypatch):
    from sync.config import env_set_attrs

    monkeypatch.setenv("CAMPUS_USERNAME", "u123")
    monkeypatch.setenv("CAMPUS_BRIGHTSPACE_PASSWORD", "pw")
    attrs = env_set_attrs()
    assert {"username", "password"} <= attrs


def test_env_set_attrs_ignores_empty_values(monkeypatch):
    """An exported-but-empty var supplies no value, so it must not be
    reported as a source (matching _apply_env's `if not val: continue`)."""
    from sync.config import env_set_attrs

    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("CAMPUS_NTFY_URL", "")
    attrs = env_set_attrs()
    assert "llm_model" not in attrs
    assert "ntfy_url" not in attrs


def test_mcp_urls_env_still_splits(monkeypatch):
    """Dropping the duplicated CAMPUS_MCP_URLS block must not change parsing."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_MCP_URLS", "http://s1/mcp, http://s2/mcp")
    assert Config.load().mcp_endpoints() == ["http://s1/mcp", "http://s2/mcp"]


def test_env_extras_override_the_file(tmp_path, monkeypatch):
    """CAMPUS_USERNAME / CAMPUS_BRIGHTSPACE_PASSWORD / CAMPUS_BRIGHTSPACE_HOSTS
    now come from ENV_EXTRA; a non-empty value must still beat config.yaml."""
    from sync.config import Config

    yaml_path = tmp_path / "config.yaml"
    yaml_path.write_text(
        "username: from-yaml\npassword: from-yaml\n"
        "brightspace_hosts:\n  - from-yaml.edu\n"
    )
    monkeypatch.setenv("CAMPUS_USERNAME", "from-env")
    monkeypatch.setenv("CAMPUS_BRIGHTSPACE_PASSWORD", "from-env")
    monkeypatch.setenv("CAMPUS_BRIGHTSPACE_HOSTS", "a.edu, b.edu")
    cfg = Config.load(path=yaml_path)
    assert cfg.username == "from-env"
    assert cfg.password == "from-env"
    assert cfg.brightspace_hosts == ["a.edu", "b.edu"]


def test_empty_env_value_does_not_clear_a_file_value(tmp_path, monkeypatch):
    """Equivalence guard for the table refactor: an exported-but-empty var
    must leave a config.yaml value alone rather than blanking it, and an empty
    list var must not reset a file list to []."""
    from sync.config import Config

    yaml_path = tmp_path / "config.yaml"
    yaml_path.write_text(
        "llm_model: from-yaml\nmcp_urls:\n  - http://from-yaml/mcp\n"
    )
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("CAMPUS_MCP_URLS", "")
    cfg = Config.load(path=yaml_path)
    assert cfg.llm_model == "from-yaml"
    assert cfg.mcp_urls == ["http://from-yaml/mcp"]


def test_legacy_bifrost_env_is_gone(monkeypatch):
    """The old CAMPUS_BIFROST_URL alias was removed — a stale env var must
    NOT silently rewire the endpoint."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_BIFROST_URL", "http://old-gateway:8080/v1")
    cfg = Config.load()
    assert "old-gateway" not in cfg.llm_url


def test_campus_llm_env_is_gone(monkeypatch):
    """CAMPUS_LLM_* aliases were removed — only OPENAI_* configures the LLM now."""
    from sync.config import Config

    monkeypatch.setenv("CAMPUS_LLM_URL", "https://should-not-apply/v1")
    monkeypatch.setenv("CAMPUS_LLM_URLS", "https://also-ignored/v1")
    cfg = Config.load()
    assert "should-not-apply" not in cfg.llm_url
    assert cfg.llm_endpoints() == []


def test_config_yaml_not_required(tmp_path, monkeypatch):
    """Config.load() with no config.yaml present falls back to defaults/env."""
    from sync.config import Config

    monkeypatch.chdir(tmp_path)  # REPO_ROOT is module-relative, not cwd — still fine
    monkeypatch.setenv("OPENAI_MODEL", "some-model")
    cfg = Config.load()
    assert cfg.llm_model == "some-model"


def test_multiple_llm_endpoints_failover(monkeypatch):
    """llm_urls / OPENAI_ENDPOINTS build an ordered failover list; llm_url is
    the single-entry alias. llm_endpoints() collapses to one source."""
    from sync.config import Config

    monkeypatch.setenv("OPENAI_ENDPOINTS", "https://a/v1, https://b/v1")
    cfg = Config.load()
    assert cfg.llm_endpoints() == ["https://a/v1", "https://b/v1"]

    monkeypatch.setenv("OPENAI_ENDPOINT", "https://single/v1")
    monkeypatch.delenv("OPENAI_ENDPOINTS", raising=False)
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


def test_standard_openai_env_naming(monkeypatch):
    """Outsiders can configure Campus with conventional OPENAI_* names; the
    api key is sent as a Bearer token. CAMPUS_* overrides OPENAI_* when both
    are set."""
    from sync.config import Config
    from agent.chat import llm_headers

    monkeypatch.setenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    cfg = Config.load()
    assert cfg.llm_endpoints() == ["https://api.openai.com/v1"]
    assert cfg.llm_model == "gpt-4o-mini"
    assert llm_headers(cfg)["Authorization"] == "Bearer sk-test"

    # plural form
    monkeypatch.delenv("OPENAI_ENDPOINT", raising=False)
    monkeypatch.setenv("OPENAI_ENDPOINTS", "https://a/v1, https://b/v1")
    assert Config.load().llm_endpoints() == ["https://a/v1", "https://b/v1"]

    # CAMPUS_LLM_* is intentionally gone — it must NOT configure the LLM
    monkeypatch.setenv("CAMPUS_LLM_URLS", "http://bifrost:8080/v1")
    assert "bifrost" not in Config.load().llm_endpoints()


def test_settings_layer_beats_env(tmp_path, monkeypatch):
    """The in-app layer is the top of the precedence stack."""
    from sync.config import Config

    monkeypatch.setenv("OPENAI_MODEL", "from-env")
    (tmp_path / "settings.yaml").write_text("llm_model: from-settings\n")
    cfg = Config.load()
    assert cfg.llm_model == "from-settings"


def test_env_beats_config_yaml(tmp_path, monkeypatch):
    """Adding the settings layer must not disturb the existing two."""
    from sync.config import Config

    monkeypatch.setenv("OPENAI_MODEL", "from-env")
    yaml_path = tmp_path / "config.yaml"
    yaml_path.write_text("llm_model: from-yaml\n")
    cfg = Config.load(path=yaml_path)
    assert cfg.llm_model == "from-env"


def test_missing_settings_layer_is_a_noop(tmp_path):
    from sync.config import Config

    cfg = Config.load()  # CAMPUS_SETTINGS_PATH points at a nonexistent file
    assert cfg.llm_model == ""


def test_settings_path_is_absolute_and_beside_the_db(tmp_path, monkeypatch):
    """A relative db_path (what config.example.yaml ships) must not make the
    settings file depend on the process CWD.

    The autouse pin sets CAMPUS_SETTINGS_PATH, which short-circuits
    settings_path(); clear it so this actually exercises the db-derived anchor
    rather than the env override (covered separately below).
    """
    from sync.config import Config, settings_path

    monkeypatch.delenv("CAMPUS_SETTINGS_PATH", raising=False)
    monkeypatch.setenv("CAMPUS_DB_PATH", "data/harness.db")
    cfg = Config.load()
    assert Path("data/harness.db").is_absolute() is False  # guard the premise
    p = settings_path(cfg)
    assert p.is_absolute()
    assert p.name == "settings.yaml"


def test_settings_path_env_override_wins(tmp_path, monkeypatch):
    from sync.config import settings_path

    target = tmp_path / "elsewhere" / "settings.yaml"
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(target))
    assert settings_path() == target.resolve()


def test_corrupt_settings_file_is_ignored_and_reported(tmp_path, monkeypatch):
    """Config.load() runs per request — a hand-edited broken file must not
    500 every request."""
    from sync.config import Config, read_settings_layer

    bad = tmp_path / "settings.yaml"
    bad.write_text("llm_model: [unclosed\n")
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(bad))
    assert Config.load().llm_model == ""  # no raise
    data, err = read_settings_layer(bad)
    assert data == {} and err


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores mode bits")
def test_unreadable_settings_file_is_reported_not_silently_absent(tmp_path):
    """Path.exists() swallows the PermissionError and returns False, so an
    exists() pre-check would make an unreadable file look "absent" with no
    error — the UI would show empty settings and no reason why."""
    from sync.config import read_settings_layer

    locked = tmp_path / "locked"
    locked.mkdir()
    (locked / "settings.yaml").write_text("llm_model: x\n")
    locked.chmod(0o000)
    try:
        data, err = read_settings_layer(locked / "settings.yaml")
    finally:
        locked.chmod(0o755)  # let pytest clean the tmp dir up
    assert data == {}
    assert err and "Permission denied" in err


def test_yaml_error_reports_position_without_echoing_content(tmp_path):
    """PyYAML's message can quote the offending text — an undefined alias
    (`llm_api_key: *sk-...`) reports the alias NAME, i.e. the secret itself.
    The layer reports position instead, because this string is served over HTTP
    (settings_file_error) and no consumer of it may be able to leak the value."""
    from sync.config import read_settings_layer

    p = tmp_path / "settings.yaml"
    p.write_text("llm_api_key: *sk-canary-4321\n")
    data, err = read_settings_layer(p)
    assert data == {}
    assert err
    assert "sk-canary-4321" not in err
    assert "settings.yaml" in err
    assert "line 1" in err and "column" in err

    # An unterminated flow sequence reports the PROBLEM at end-of-stream; the
    # context mark is where the construct actually opened — the line to fix.
    flow = tmp_path / "flow.yaml"
    flow.write_text("pilot_only: true\nllm_model: [oops\n")
    data2, err2 = read_settings_layer(flow)
    assert data2 == {}
    assert err2
    assert "line 2" in err2 and "column 12" in err2


def test_non_utf8_settings_file_is_reported_not_raised(tmp_path):
    """UnicodeDecodeError is neither an OSError nor a yaml.YAMLError, so a
    catch split by class needs a fallback: otherwise a binary settings file
    raises out of Config.load() — which runs per request — and 500s the API."""
    from sync.config import read_settings_layer

    p = tmp_path / "settings.yaml"
    p.write_bytes(b"llm_api_key: \xff\xfe\x00bad\n")
    data, err = read_settings_layer(p)
    assert data == {}
    assert err and "UnicodeDecodeError" in err
    assert "llm_api_key" not in err   # no content in this class either


def test_read_settings_layer_on_a_directory_is_reported(tmp_path):
    """A directory where the file should be must not raise out of load()."""
    from sync.config import read_settings_layer

    d = tmp_path / "settings.yaml"
    d.mkdir()
    data, err = read_settings_layer(d)
    assert data == {} and err


def test_settings_file_cannot_relocate_itself(tmp_path, monkeypatch):
    """load() copies any YAML key that matches a field, so a `settings_path`
    key must NOT become a Config field."""
    from sync.config import Config

    (tmp_path / "settings.yaml").write_text("settings_path: /tmp/evil.yaml\n")
    cfg = Config.load()
    assert not hasattr(cfg, "settings_path")
