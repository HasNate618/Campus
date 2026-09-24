"""Settings panel: field registry, GET/PUT contract, secret handling.

Every test pins CAMPUS_SETTINGS_PATH (see tests/test_config.py::_clean_env)
so a developer's real data/settings.yaml can never be read or written.
"""

from __future__ import annotations

import time

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
        normalize(REGISTRY["office_to_pdf"], 1)
    assert normalize(REGISTRY["office_to_pdf"], False) is False


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
        "institution", "timezone",
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
    """Point the harness at a scratch config + settings pair and import fresh.

    CAMPUS_DB_PATH as well as CAMPUS_DB: sync.Config reads only the former, so
    without it _snapshot() -> _search_index() -> search_index_summary() would
    open the developer's real data/harness.db read-write (sqlite3.connect
    creates the file), and one GET could seed a stray real DB.
    """
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("CAMPUS_DB", str(tmp_path / "harness.db"))
    monkeypatch.setenv("CAMPUS_DB_PATH", str(tmp_path / "harness.db"))
    monkeypatch.setenv("CAMPUS_SETTINGS_PATH", str(tmp_path / "settings.yaml"))
    (tmp_path / "settings.yaml").write_text(settings_body)
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)


def test_get_reports_values_and_sources(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch,
           settings_body="office_to_pdf: false\n",
           env={"OPENAI_MODEL": "env-model"})
    from fastapi.testclient import TestClient
    from api.main import app

    body = TestClient(app).get("/api/settings").json()
    by_key = {f["key"]: f for f in body["fields"]}

    assert by_key["office_to_pdf"]["value"] is False
    assert by_key["office_to_pdf"]["source"] == "settings"
    assert by_key["office_to_pdf"]["inherited_value"] is True

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
    # search_index is the only signal in the payload that the vectors are stale
    # after a model change; dropping it from _snapshot() must not go unnoticed.
    assert set(body["search_index"]) == {"chunks", "embed_model", "stale"}
    assert body["search_index"]["chunks"] == 0   # the scratch DB has no chunks


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


def _client(tmp_path, monkeypatch, settings_body: str = "", env: dict | None = None):
    _setup(tmp_path, monkeypatch, settings_body, env)
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


def test_put_writes_the_layer_and_reports_new_sources(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    res = c.put("/api/settings", json={"values": {"office_to_pdf": False,
                                                 "long_scan_skip_pages": 42}})
    assert res.status_code == 200
    assert (tmp_path / "settings.yaml").exists()
    by_key = {f["key"]: f for f in res.json()["fields"]}
    assert by_key["office_to_pdf"]["value"] is False
    assert by_key["office_to_pdf"]["source"] == "settings"
    from sync.config import Config
    assert Config.load().long_scan_skip_pages == 42


def test_put_rejects_unknown_key(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    res = c.put("/api/settings", json={"values": {"data_root": "/etc"}})
    assert res.status_code == 400
    assert res.json()["detail"]["errors"][0]["key"] == "data_root"


def test_put_rejects_bad_value_and_leaves_the_file_untouched(tmp_path, monkeypatch):
    path = tmp_path / "settings.yaml"
    c = _client(tmp_path, monkeypatch, settings_body="office_to_pdf: false\n")
    before = path.read_bytes()
    res = c.put("/api/settings", json={"values": {"ntfy_url": "ftp://x"}})
    assert res.status_code == 400
    assert "ftp://x" in res.json()["detail"]["errors"][0]["message"]
    assert path.read_bytes() == before          # byte-identical


def test_put_int_rejects_bool_and_leaves_the_file_untouched(tmp_path, monkeypatch):
    path = tmp_path / "settings.yaml"
    c = _client(tmp_path, monkeypatch)
    res = c.put("/api/settings", json={"values": {"long_scan_skip_pages": True}})
    assert res.status_code == 400
    assert not path.exists() or path.read_bytes() == b""


def test_put_null_deletes_and_restores_inheritance(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch, settings_body="llm_model: from-settings\n",
                env={"OPENAI_MODEL": "from-env"})
    # Precondition: the override really is winning before we delete it, so the
    # assertions below prove the delete changed something.
    before = {f["key"]: f for f in c.get("/api/settings").json()["fields"]}
    assert before["llm_model"]["value"] == "from-settings"
    assert before["llm_model"]["source"] == "settings"

    res = c.put("/api/settings", json={"values": {"llm_model": None}})
    by_key = {f["key"]: f for f in res.json()["fields"]}
    assert by_key["llm_model"]["value"] == "from-env"
    assert "llm_model" not in (tmp_path / "settings.yaml").read_text()


def test_put_llm_urls_blanks_the_singular_alias(tmp_path, monkeypatch):
    """llm_endpoints() prefers llm_urls, so a stale singular in the same layer
    would resurrect after the user clears the list."""
    c = _client(tmp_path, monkeypatch,
                settings_body="llm_url: https://stale/v1\n")
    c.put("/api/settings", json={"values": {"llm_urls": ["https://new/v1"]}})
    import yaml

    text = (tmp_path / "settings.yaml").read_text()
    assert "https://stale/v1" not in text        # the stale value is gone
    # ...and the singular is BLANKED rather than left absent. Asserted on the
    # parsed value, not on a quoting style: safe_dump writes `''`, not `""`.
    layer = yaml.safe_load(text)
    assert layer["llm_url"] == ""
    assert layer["llm_urls"] == ["https://new/v1"]
    from sync.config import Config
    assert Config.load().llm_endpoints() == ["https://new/v1"]


def test_put_clearing_urls_does_not_resurrect_the_stale_singular(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch, settings_body="llm_url: https://stale/v1\n")
    c.put("/api/settings", json={"values": {"llm_urls": []}})
    from sync.config import Config
    assert Config.load().llm_endpoints() == []   # not ["https://stale/v1"]


def test_put_trims_whitespace_before_validating(tmp_path, monkeypatch):
    """A pasted value arrives with surrounding whitespace. The validators in
    api/settings_fields.py are deliberately strict, so trimming has to happen
    at the request boundary — otherwise a paste is rejected, not saved."""
    c = _client(tmp_path, monkeypatch)
    res = c.put("/api/settings", json={"values": {
        "ntfy_url": "  https://ntfy.sh/mine  ",
        "timezone": " America/Toronto ",
        "llm_urls": ["  http://localhost:11434/v1  "],
        "llm_api_key": "  sk-padded-9999  ",
        "institution": "  Example University  ",
    }})
    assert res.status_code == 200, res.text
    by_key = {f["key"]: f for f in res.json()["fields"]}
    assert by_key["ntfy_url"]["value"] == "https://ntfy.sh/mine"
    assert by_key["timezone"]["value"] == "America/Toronto"
    assert by_key["llm_urls"]["value"] == ["http://localhost:11434/v1"]
    assert by_key["institution"]["value"] == "Example University"
    # The secret is stored trimmed (and still never echoed).
    assert "sk-padded-9999" not in res.text
    assert "sk-padded-9999" in (tmp_path / "settings.yaml").read_text()
    assert "  sk-padded-9999  " not in (tmp_path / "settings.yaml").read_text()


def test_put_applies_nothing_when_one_value_is_invalid(tmp_path, monkeypatch):
    """Validate-before-write at REQUEST granularity. A request mixing a legal
    and an illegal value must apply neither: a partially-applied write would
    leave the file holding a change the user never got told about, because the
    request failed."""
    path = tmp_path / "settings.yaml"
    c = _client(tmp_path, monkeypatch, settings_body="office_to_pdf: false\n")
    before = path.read_bytes()
    res = c.put("/api/settings", json={"values": {
        "long_scan_skip_pages": 99,     # legal — must NOT be applied
        "ntfy_url": "ftp://x",          # illegal
    }})
    assert res.status_code == 400
    assert [e["key"] for e in res.json()["detail"]["errors"]] == ["ntfy_url"]
    assert path.read_bytes() == before
    import yaml

    layer = yaml.safe_load(path.read_text())
    assert "long_scan_skip_pages" not in layer


def test_put_file_is_0600_and_parent_mode_is_untouched(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    before = tmp_path.stat().st_mode & 0o777
    c.put("/api/settings", json={"values": {"office_to_pdf": False}})
    mode = (tmp_path / "settings.yaml").stat().st_mode & 0o777
    assert mode == 0o600
    assert (tmp_path.stat().st_mode & 0o777) == before   # not tightened by us


def test_put_concurrent_writes_keep_both_fields(tmp_path, monkeypatch):
    import concurrent.futures as cf

    c = _client(tmp_path, monkeypatch)
    with cf.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda kv: c.put("/api/settings", json={"values": {kv[0]: kv[1]}}),
                      [("office_to_pdf", False), ("long_scan_skip_pages", 7)]))
    from sync.config import Config
    cfg = Config.load()
    assert cfg.office_to_pdf is False and cfg.long_scan_skip_pages == 7


def test_put_secret_is_never_echoed(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    res = c.put("/api/settings", json={"values": {"llm_api_key": "sk-abcdefgh9999"}})
    assert res.status_code == 200
    assert "sk-abcdefgh9999" not in res.text
    assert (tmp_path / "settings.yaml").stat().st_mode & 0o777 == 0o600


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


def test_search_index_summary_on_an_unindexed_db(db_path, tmp_path, monkeypatch):
    """chunk_meta only exists after a rebuild — the summary must not raise."""
    # sync.Config reads CAMPUS_DB_PATH (CAMPUS_DB is the API's own var), so the
    # fixture alone would leave Config.load().db_path on the developer's real
    # data/harness.db and this assertion would read their index.
    monkeypatch.setenv("CAMPUS_DB_PATH", str(db_path))
    # An exported CAMPUS_EMBED_MODEL would make the stored model differ from the
    # configured one and flip `stale` to True — the test must not depend on
    # ambient shell state.
    monkeypatch.delenv("CAMPUS_EMBED_MODEL", raising=False)
    _setup(tmp_path, monkeypatch)
    from sync.config import Config
    from api.services import search_index_summary

    summary = search_index_summary(Config.load())
    assert summary == {"chunks": 0, "embed_model": None, "stale": False}


def test_rebuild_endpoint_starts_and_reports(db_path, tmp_path, monkeypatch):
    # Pinned like the test above: the rebuild thread calls Config.load(), and an
    # unpinned run would rewrite the real data/harness.db index from a test.
    monkeypatch.setenv("CAMPUS_DB_PATH", str(db_path))
    c = _client(tmp_path, monkeypatch)
    assert c.post("/api/search/rebuild").json()["status"] in {"started", "running"}
    state: dict = {}
    for _ in range(50):   # the rebuild runs in a daemon thread
        state = c.get("/api/search/rebuild/status").json()
        if state["status"] != "running":
            break
        time.sleep(0.1)
    assert state["status"] in {"done", "error"}
    assert "index" in state


def test_rebuild_refuses_while_a_sync_is_running(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    import api.services as services
    monkeypatch.setattr(services, "sync_in_progress", lambda: True)
    assert c.post("/api/search/rebuild").json()["status"] == "sync_running"
