"""Minimal MCP streamable-HTTP client for the agent.

Generic: talks to ANY streamable-HTTP MCP server (trawl/SearXNG+crawl4ai,
Firecrawl, …) at a configured ``mcp_url``. The agent discovers whatever
tools the server exposes (``tools/list``) and dispatches calls through
``call_tool`` — no tool names are hardcoded here.
"""
from __future__ import annotations

import json

import httpx


class MCPError(Exception):
    pass


class MCPClient:
    def __init__(self, url: str, timeout: float = 90.0):
        self.url = url
        self._client = httpx.Client(
            timeout=timeout,
            headers={"Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"},
        )
        self.session_id: str | None = None

    def _post(self, payload: dict) -> dict:
        headers = {}
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        r = self._client.post(self.url, json=payload, headers=headers)
        r.raise_for_status()
        sid = r.headers.get("mcp-session-id")
        if sid:
            self.session_id = sid
        # The MCP streamable-HTTP transport answers with SSE: one or more
        # `data:` lines (or, for some servers, a bare JSON body). Find the
        # last data payload and JSON-decode it. Tolerate a leading "data:"
        # prefix and plain-JSON (non-SSE) responses.
        data: str | None = None
        for line in r.text.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("data:"):
                data = line[5:].strip()
            elif line.startswith("{"):
                data = line
        if not data:
            data = r.text.strip()
        if data.startswith("data:"):
            data = data[5:].strip()
        if data and data.startswith("{"):
            return json.loads(data)
        return {}

    def connect(self) -> None:
        self._post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "campus-agent", "version": "0.1"}}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    def list_tools(self) -> list[dict]:
        """Return the list of tools the server exposes (``tools/list``)."""
        resp = self._post({"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}})
        if resp.get("error"):
            raise MCPError(str(resp["error"]))
        return resp.get("result", {}).get("tools", [])

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        resp = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                           "params": {"name": name, "arguments": arguments or {}}})
        if resp.get("error"):
            raise MCPError(str(resp["error"]))
        result = resp.get("result", {}) or {}
        if result.get("isError"):
            content = result.get("content") or []
            texts = [c.get("text", "") for c in content
                     if isinstance(c, dict) and c.get("type") == "text"]
            return {"error": "\n".join(t for t in texts if t) or "tool reported an error"}
        # Standard MCP: content is a list of {type, text} blocks.
        content = result.get("content")
        if isinstance(content, list):
            texts = [c.get("text", "") for c in content
                     if isinstance(c, dict) and c.get("type") == "text"]
            joined = "\n".join(t for t in texts if t)
            if joined:
                # If the single text block is JSON, surface it parsed so the
                # model receives structured data instead of a string blob.
                try:
                    return {"content": json.loads(joined)}
                except (json.JSONDecodeError, ValueError):
                    return {"content": joined}
            # Non-text content (images, etc.) — return the raw structure.
            return {"content": content}
        # Tolerate a server that returns plain JSON (no content[] wrapper).
        if "content" not in result and result:
            return {"content": result}
        return {"content": ""}

    def close(self) -> None:
        self._client.close()
