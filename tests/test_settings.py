"""Settings panel: field registry, GET/PUT contract, secret handling.

Every test pins CAMPUS_SETTINGS_PATH (see tests/test_config.py::_clean_env)
so a developer's real data/settings.yaml can never be read or written.
"""

from __future__ import annotations

import pytest


def test_int_validator_rejects_bool():
    """isinstance(True, int) is True in Python. A bool here would persist as
    YAML `true` and then compare as 1 at sync/sync.py:1021
    (`pages >= self.cfg.long_scan_skip_pages`), skipping every scanned PDF
    instead of OCRing it."""
    from api.settings_fields import REGISTRY, ValidationError, normalize

    with pytest.raises(ValidationError):
        normalize(REGISTRY["long_scan_skip_pages"], True)


def test_int_validator_bounds():
    from api.settings_fields import REGISTRY, ValidationError, normalize

    f = REGISTRY["long_scan_skip_pages"]
    assert normalize(f, 30) == 30
    with pytest.raises(ValidationError):
        normalize(f, -1)


def test_bool_validator_rejects_int():
    from api.settings_fields import REGISTRY, ValidationError, normalize

    with pytest.raises(ValidationError):
        normalize(REGISTRY["pilot_only"], 1)
    assert normalize(REGISTRY["pilot_only"], False) is False


def test_url_validation():
    from api.settings_fields import REGISTRY, ValidationError, normalize

    assert normalize(REGISTRY["ntfy_url"], "https://ntfy.sh/x") == "https://ntfy.sh/x"
    assert normalize(REGISTRY["ntfy_url"], "") == ""  # empty = disabled
    with pytest.raises(ValidationError):
        normalize(REGISTRY["ntfy_url"], "ftp://x")


def test_url_list_validation_and_empty():
    from api.settings_fields import REGISTRY, ValidationError, normalize

    f = REGISTRY["llm_urls"]
    assert normalize(f, ["http://localhost:11434/v1"]) == ["http://localhost:11434/v1"]
    assert normalize(f, []) == []
    with pytest.raises(ValidationError):
        normalize(f, ["not-a-url"])


def test_empty_semantics_per_field_class():
    """store / delete / reject, exactly as the spec's Empty vs unset table."""
    from api.settings_fields import REGISTRY, ValidationError, normalize

    # "" is a meaningful stored value
    assert normalize(REGISTRY["pdf_extractor_url"], "") == ""
    assert normalize(REGISTRY["timezone"], "") == ""
    # "" means "delete the override"
    assert normalize(REGISTRY["llm_api_key"], "") is None
    assert normalize(REGISTRY["llm_tool_choice"], "") is None
    assert normalize(REGISTRY["institution"], "") is None
    # "" is invalid for a model
    with pytest.raises(ValidationError):
        normalize(REGISTRY["llm_model"], "")
    # None always means delete
    assert normalize(REGISTRY["llm_model"], None) is None


def test_timezone_validation():
    from api.settings_fields import REGISTRY, ValidationError, normalize

    assert normalize(REGISTRY["timezone"], "America/Toronto") == "America/Toronto"
    with pytest.raises(ValidationError):
        normalize(REGISTRY["timezone"], "Mars/Olympus_Mons")


def test_tool_choice_parses_json_object():
    """agent/chat.py:108-109 sends cfg.llm_tool_choice whenever it is not None,
    so the object form must round-trip as an object, not as a string."""
    from api.settings_fields import REGISTRY, ValidationError, normalize

    f = REGISTRY["llm_tool_choice"]
    assert normalize(f, '{"type": "function", "function": {"name": "x"}}') == {
        "type": "function",
        "function": {"name": "x"},
    }
    assert normalize(f, "auto") == "auto"
    with pytest.raises(ValidationError):
        normalize(f, "{not json")


def test_registry_shape():
    """The registry is the write allowlist — guard against accidental scope."""
    from api.settings_fields import REGISTRY

    assert set(REGISTRY) == {
        "llm_urls", "llm_api_key", "llm_model", "llm_tool_choice",
        "embed_model", "rerank_model",
        "auto_extract_pdfs", "office_to_pdf", "pdf_extractor_url",
        "long_scan_skip_pages", "digest_pdf_excerpt_chars",
        "pilot_only", "institution", "timezone",
        "ntfy_url", "mcp_urls",
        "max_file_size", "max_extract_size", "office_convert_timeout_s",
        "digest_announcement_days",
    }
    # Paths and passwords must never be writable from the web.
    for forbidden in ("data_root", "db_path", "token_dir", "web_password",
                      "base_url", "username", "password", "term_dates"):
        assert forbidden not in REGISTRY
    assert REGISTRY["mcp_urls"].restart is True
    assert REGISTRY["llm_model"].restart is False
    assert REGISTRY["llm_urls"].couples == ("llm_url",)
    assert REGISTRY["mcp_urls"].couples == ("mcp_url",)
    assert REGISTRY["llm_api_key"].secret is True


def _setup(tmp_path, monkeypatch, settings_body: str = "", env: dict | None = None):
    """Point the harness at a scratch config + settings pair and import fresh."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("CAMPUS_DB", str(tmp_path / "harness.db"))
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    (tmp_path / "settings.yaml").write_text(settings_body)
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)


def test_get_reports_values_and_sources(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch,
           settings_body="pilot_only: false\n",
           env={"OPENAI_MODEL": "env-model"})
    from fastapi.testclient import TestClient
    from api.main import app

    body = TestClient(app).get("/api/settings").json()
    by_key = {f["key"]: f for f in body["fields"]}

    assert by_key["pilot_only"]["value"] is False
    assert by_key["pilot_only"]["source"] == "settings"
    assert by_key["pilot_only"]["inherited_value"] is True

    assert by_key["llm_model"]["value"] == "env-model"
    assert by_key["llm_model"]["source"] == "env"
    assert by_key["llm_model"]["inherited_from"] == "OPENAI_MODEL"

    assert body["settings_file"].endswith("settings.yaml")
    assert body["settings_file"].startswith("/")   # absolute, always
    assert isinstance(body["settings_writable"], bool)
    assert body["settings_file_error"] is None
    assert "auth_enabled" in body
    assert set(body["readonly"]) == {"db_path", "data_root", "token_dir"}
    for entry in body["readonly"].values():
        assert "value" in entry and "from" in entry


def test_get_never_returns_the_plaintext_key(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch,
           settings_body="llm_api_key: sk-supersecret-1234\n")
    from fastapi.testclient import TestClient
    from api.main import app

    res = TestClient(app).get("/api/settings")
    assert "sk-supersecret-1234" not in res.text
    by_key = {f["key"]: f for f in res.json()["fields"]}
    assert by_key["llm_api_key"]["value"] == "••••1234"
    assert by_key["llm_api_key"]["secret"] is True


def test_get_masks_unset_secret_as_null(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    from fastapi.testclient import TestClient
    from api.main import app

    by_key = {f["key"]: f for f in TestClient(app).get("/api/settings").json()["fields"]}
    assert by_key["llm_api_key"]["value"] is None


def test_get_reports_a_corrupt_settings_file(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, settings_body="llm_model: [oops\n")
    from fastapi.testclient import TestClient
    from api.main import app

    body = TestClient(app).get("/api/settings").json()
    assert body["settings_file_error"]


def test_get_reports_module_level_restart_flags(tmp_path, monkeypatch):
    """mcp_urls is discovered at import (agent/tools.py:1314)."""
    _setup(tmp_path, monkeypatch)
    from fastapi.testclient import TestClient
    from api.main import app

    by_key = {f["key"]: f for f in TestClient(app).get("/api/settings").json()["fields"]}
    assert by_key["mcp_urls"]["restart"] is True
    assert by_key["llm_model"]["restart"] is False


def test_get_does_not_leak_the_key_through_a_malformed_file(tmp_path, monkeypatch):
    """A stray `*` turns the value into an alias reference, and PyYAML's
    ComposerError echoes the alias NAME — the secret itself — in its message.
    read_settings_layer prefixes that with the path, so serving it verbatim
    puts the plaintext key in the response body. The error must stay
    reportable, just without the file's content."""
    _setup(tmp_path, monkeypatch,
           settings_body="llm_api_key: *sk-leak-canary-9999\n")
    from fastapi.testclient import TestClient
    from api.main import app

    res = TestClient(app).get("/api/settings")
    assert "sk-leak-canary-9999" not in res.text
    body = res.json()
    # ...while the failure is still reportable and still points at the line
    assert body["settings_file_error"]
    assert "settings.yaml" in body["settings_file_error"]
    assert "line 1" in body["settings_file_error"]
    # and the layer failed to load, so the field falls back to unset
    by_key = {f["key"]: f for f in body["fields"]}
    assert by_key["llm_api_key"]["value"] is None
