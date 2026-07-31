#!/usr/bin/env python3
"""Minimal MCP streamable-http client to poke the brightspace MCP server."""
import json, sys, urllib.request

URL = "http://127.0.0.1:11234/mcp"

def rpc(payload, session_id=None, notif=False):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers=headers, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        return None, str(e), None
    body = resp.read().decode()
    sid = resp.headers.get("mcp-session-id")
    return body, None, sid

def parse_sse(body):
    """Parse SSE stream, return last data JSON."""
    if not body:
        return None
    data = None
    for line in body.splitlines():
        if line.startswith("data:"):
            data = line[5:].strip()
    if data:
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return data
    return None

# 1. initialize
body, err, sid = rpc({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
    "protocolVersion":"2025-03-26","capabilities":{},
    "clientInfo":{"name":"explore","version":"1.0"}}})
print("INIT:", "ERR" if err else "OK", "sid:", sid)
if err:
    print(err); sys.exit(1)
init_resp = parse_sse(body)
print("SERVER:", json.dumps(init_resp.get("result", {}).get("serverInfo", {})) if isinstance(init_resp, dict) else init_resp)

# 2. initialized notification
rpc({"jsonrpc":"2.0","method":"notifications/initialized","params":{}}, sid)

# 3. list tools
body, err, sid = rpc({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}, sid)
res = parse_sse(body)
tools = res.get("result", {}).get("tools", []) if isinstance(res, dict) else []
print("TOOLS:", ", ".join(t["name"] for t in tools))

# 4. check_auth
body, err, sid = rpc({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
    "name":"check_auth","arguments":{}}}, sid)
res = parse_sse(body)
print("AUTH:", json.dumps(res)[:500])

# 5. get_my_courses
body, err, sid = rpc({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
    "name":"get_my_courses","arguments":{}}}, sid)
res = parse_sse(body)
print("COURSES:", json.dumps(res)[:3000])
