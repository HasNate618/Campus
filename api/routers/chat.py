"""Real chat SSE — streams run_turn with tool_start/tool_end/token/done.

run_turn is synchronous (blocking httpx to the LLM endpoint), so it runs in a worker
thread; events flow through an asyncio.Queue into the SSE response.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])

# DeepSeek thinking mode: reasoning_content must be re-sent with the next
# call. The frontend's localStorage history doesn't carry it, so the API
# caches the last reasoning per course and injects it into the incoming
# history. Keyed by session_id when provided (server-side persistence),
# else by course_id (single-user, one active chat per course).
_reasoning_cache: dict[tuple, str] = {}


def _inject_reasoning(history: list[dict], key: tuple) -> list[dict]:
    cached = _reasoning_cache.get(key)
    if not cached:
        return history
    out = list(history)
    for m in reversed(out):
        if m.get("role") == "assistant":
            m["reasoning_content"] = cached  # provider passback requirement
            break
    return out


def _store_reasoning(history: list[dict], key: tuple) -> None:
    for m in reversed(history):
        if m.get("role") == "assistant" and (m.get("reasoning") or m.get("reasoning_content")):
            _reasoning_cache[key] = m.get("reasoning") or m.get("reasoning_content")
            return


class ChatRequest(BaseModel):
    message: str
    course_id: int | None = None
    history: list[dict[str, Any]] = []
    session_id: int | None = None  # optional server-side persistence
    model: str | None = None  # LLM model override (default = config)
    branch: str | None = None  # user-node id that starts this turn (fork key)


@router.get("/sessions")
def list_sessions(course_id: int | None = None):
    """Session list with full trees (the client restores chats from this)."""
    from sync.db import DB
    from sync.config import Config
    import json
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        if course_id:
            rows = db.conn.execute(
                "SELECT id, course_id, title, nodes_json, updated_at FROM chat_sessions WHERE course_id=? ORDER BY updated_at DESC",
                (course_id,)).fetchall()
        else:
            rows = db.conn.execute(
                "SELECT id, course_id, title, nodes_json, updated_at FROM chat_sessions ORDER BY updated_at DESC").fetchall()
        out = []
        for r in rows:
            tree = {}
            if r["nodes_json"]:
                try:
                    tree = json.loads(r["nodes_json"])
                except json.JSONDecodeError:
                    tree = {}
            out.append({
                "id": r["id"], "courseId": r["course_id"], "title": r["title"],
                "updatedAt": r["updated_at"],
                "nodes": tree.get("nodes", []), "activeNodeId": tree.get("activeNodeId"),
            })
        return out
    finally:
        db.close()


class SessionCreate(BaseModel):
    course_id: int | None = None
    title: str = "New chat"


class SessionUpdate(BaseModel):
    title: str | None = None
    nodes: list | None = None
    activeNodeId: str | None = None
    # Client's ms epoch for this session — the client's own record of when
    # it last touched the session is the truth (the server used to stamp
    # updated_at on every bulk re-save, clobbering individual times).
    updatedAt: float | None = None


@router.post("/sessions")
def create_session(body: SessionCreate):
    from sync.db import DB
    from sync.config import Config
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        cur = db.conn.execute(
            "INSERT INTO chat_sessions (course_id, title, nodes_json) VALUES (?,?,?)",
            (body.course_id, body.title, "{}"))
        db.conn.commit()
        sid = cur.lastrowid
        row = db.conn.execute(
            "SELECT id, course_id, title, updated_at FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        return {"id": row["id"], "courseId": row["course_id"], "title": row["title"],
                "updatedAt": row["updated_at"], "nodes": [], "activeNodeId": None}
    finally:
        db.close()


@router.get("/sessions/{sid}")
def get_session(sid: int):
    from sync.db import DB
    from sync.config import Config
    import json
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute(
            "SELECT id, course_id, title, nodes_json, updated_at FROM chat_sessions WHERE id=?",
            (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        tree = {}
        if row["nodes_json"]:
            try:
                tree = json.loads(row["nodes_json"])
            except json.JSONDecodeError:
                tree = {}
        return {"id": row["id"], "courseId": row["course_id"], "title": row["title"],
                "updatedAt": row["updated_at"],
                "nodes": tree.get("nodes", []), "activeNodeId": tree.get("activeNodeId")}
    finally:
        db.close()


@router.put("/sessions/{sid}")
def put_session(sid: int, body: SessionUpdate):
    from sync.db import DB
    from sync.config import Config
    import json
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute("SELECT id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        new_tree = json.dumps({"nodes": body.nodes or [], "activeNodeId": body.activeNodeId},
                              default=str)
        ts = body.updatedAt / 1000 if body.updatedAt else None
        if ts is not None:
            db.conn.execute(
                "UPDATE chat_sessions SET title=COALESCE(?, title), nodes_json=?, "
                "updated_at=datetime(?, 'unixepoch') WHERE id=?",
                (body.title, new_tree, ts, sid))
        else:
            db.conn.execute(
                "UPDATE chat_sessions SET title=COALESCE(?, title), nodes_json=?, "
                "updated_at=datetime('now') WHERE id=?",
                (body.title, new_tree, sid))
        db.conn.commit()
        return {"ok": True, "id": sid}
    finally:
        db.close()


@router.delete("/sessions/{sid}")
def delete_session(sid: int):
    from sync.db import DB
    from sync.config import Config
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        db.conn.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
        db.conn.commit()
        return {"ok": True}
    finally:
        db.close()


@router.get("/models")
def list_models():
    """LLM model list for the UI model selector (OpenAI-compatible /models)."""
    from api.config import cfg
    from agent.chat import llm_headers
    import httpx
    try:
        r = httpx.get(f"{cfg.llm_url}/models", headers=llm_headers(cfg), timeout=15)
        r.raise_for_status()
        data = r.json()
        models = []
        contexts: dict[str, int] = {}
        for m in data.get("data", []):
            mid = m.get("id")
            if mid:
                models.append(mid)
                if m.get("context_length"):
                    contexts[mid] = int(m["context_length"])
        return {"models": sorted(models), "contexts": contexts}
    except Exception as e:
        return {"models": [], "error": str(e)}


def _do_turn(req: ChatRequest, emit) -> None:
    """Blocking run_turn + optional persistence. Runs in a worker thread."""
    from agent.chat import run_turn
    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    db = DB(cfg.db_path)
    # Reasoning cache keyed per branch (the user node that starts the turn)
    # so forks never cross-contaminate chain-of-thought passback.
    key: tuple = (req.session_id or req.course_id, req.branch or "")
    try:
        history = _inject_reasoning(req.history, key)
        answer, full_history = run_turn(cfg, db, req.message, course_id=req.course_id,
                                        model=req.model, history=history,
                                        verbose=False, emit=emit)
        _store_reasoning(full_history, key)
        if req.session_id:
            db.conn.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)",
                (req.session_id, "user", req.message))
            db.conn.execute(
                "INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)",
                (req.session_id, "assistant", answer))
            db.conn.execute(
                "UPDATE chat_sessions SET updated_at=datetime('now') WHERE id=?",
                (req.session_id,))
            db.conn.commit()
    finally:
        db.close()


@router.post("")
async def chat(req: ChatRequest) -> EventSourceResponse:
    queue: asyncio.Queue = asyncio.Queue()
    # emit runs on a worker thread (run_turn is blocking) — asyncio.Queue is
    # NOT thread-safe, so schedule the put on the event loop. Without this
    # the events pile up and the whole stream flushes in one burst at the end
    # (which is why streaming appeared dead).
    loop = asyncio.get_running_loop()

    def emit(event: str, data: Any) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, {"event": event, "data": data})

    async def runner() -> None:
        # CRITICAL (2026-08-03): if _do_turn raises (LLM 400, DB error),
        # the to_thread re-raises here and — without this guard — None is
        # never queued, so the SSE generator blocks on queue.get() forever
        # and the client's spinner never resolves. Always emit an error
        # event, then ALWAYS close the queue.
        try:
            await asyncio.to_thread(_do_turn, req, emit)
        except Exception as e:  # noqa: BLE001 — surface ANY failure to the client
            loop.call_soon_threadsafe(queue.put_nowait, {
                "event": "error", "data": {"message": str(e)}})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    asyncio.create_task(runner())

    async def gen():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield {"event": item["event"],
                   "data": json.dumps(item["data"], default=str)}

    return EventSourceResponse(gen())
