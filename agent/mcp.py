"""Minimal MCP streamable-HTTP client for talking to trawl from the agent.

trawl serves search (SearXNG) + read (crawl4ai) + friends over MCP at
127.0.0.1:11236/mcp (host) or trawl:8000/mcp (container).
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
        # response is SSE: parse the last data: line
        data = None
        for line in r.text.splitlines():
            if line.startswith("data:"):
                data = line[5:].strip()
        if data:
            return json.loads(data)
        return {}

    def connect(self) -> None:
        self._post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "campus-agent", "version": "0.1"}}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        resp = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                           "params": {"name": name, "arguments": arguments or {}}})
        if resp.get("error"):
            raise MCPError(str(resp["error"]))
        result = resp.get("result", {})
        if result.get("isError"):
            return {"error": result.get("content")}
        texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
        return {"content": "\n".join(texts)}

    def close(self) -> None:
        self._client.close()
