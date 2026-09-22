"""MCP tools are namespaced by the server's own name (standard harness
convention: trawl's `search` -> `trawl_search`). Verified with stubbed
MCPClient so no live server is needed."""

import sys
import types

import pytest

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
# The stub exists only so that agent.tools' import-time Config.load() (it
# discovered MCP tools at module scope) sees no config. Capture the real PyYAML
# by IMPORTING it, not via sys.modules.get(): in the orderings that matter
# (e.g. `pytest tests/test_mcp_prefix.py tests/test_settings.py`) nothing has
# imported yaml yet, so a get()-based guard would skip the restore below
# entirely and leave the stub installed for the rest of the session.
import yaml as _real_yaml

_stub = types.ModuleType("yaml")
_stub.safe_load = lambda *a, **k: None
sys.modules["yaml"] = _stub

import agent.mcp as M
import agent.tools as T
import re as _re

# Undo the stub. Restoring sys.modules is not enough on its own: importing
# agent.tools above pulls in sync.config, and whenever this module is the first
# to do so, sync.config captures the stub as its own `yaml` — an already-bound
# module attribute that a sys.modules restore cannot reach. Left alone,
# sync.config then parses every settings/config file as empty and silently
# reports a malformed file as loadable.
sys.modules["yaml"] = _real_yaml
import sync.config as _sync_config

if _sync_config.yaml is not _real_yaml:
    _sync_config.yaml = _real_yaml


def _fake_client_class():
    class FakeClient:
        def __init__(self, url, timeout=90):
            self.url = url
            self.server_name = ""
        def connect(self):
            if "trawl" in self.url:
                self.server_name = "trawl"
            elif "fire" in self.url:
                self.server_name = "firecrawl"
        def close(self):
            pass
        def list_tools(self):
            return [{"name": "search", "description": "s",
                     "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}, "required": ["q"]}}]
        @staticmethod
        def tool_prefix(server_name):
            if not server_name:
                return None
            slug = _re.sub(r"[^a-z0-9]+", "", server_name.lower())
            return slug + "_" if slug else None
    return FakeClient


@pytest.fixture(autouse=True)
def _patch_client(monkeypatch):
    monkeypatch.setattr(M, "MCPClient", _fake_client_class())


def test_single_server_named_prefix():
    class Cfg:
        def mcp_endpoints(self):
            return ["http://trawl:8000/mcp"]
    out = T.load_mcp_tools(Cfg())
    assert "trawl_search" in out
    assert out["trawl_search"]["_mcp_url"] == "http://trawl:8000/mcp"


def test_multi_server_distinct_prefixes():
    class Cfg:
        def mcp_endpoints(self):
            return ["http://trawl:8000/mcp", "http://fire:8000/mcp"]
    out = T.load_mcp_tools(Cfg())
    assert "trawl_search" in out and "firecrawl_search" in out


def test_no_name_index_fallback():
    class Cfg:
        def mcp_endpoints(self):
            return ["http://anon:8000/mcp"]

    class Anon(_fake_client_class()):
        def connect(self):
            self.server_name = ""
    M.MCPClient = Anon
    out = T.load_mcp_tools(Cfg())
    assert "mcp1_search" in out
