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
