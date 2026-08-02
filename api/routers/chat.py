"""Real chat SSE — streams run_turn with tool_start/tool_end/token/done.

run_turn is synchronous (blocking httpx to bifrost), so it runs in a worker
thread; events flow through an asyncio.Queue into the SSE response.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter
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
            m["reasoning_content"] = cached
            break
    return out


def _store_reasoning(history: list[dict], key: tuple) -> None:
    for m in reversed(history):
        if m.get("role") == "assistant" and m.get("reasoning_content"):
            _reasoning_cache[key] = m["reasoning_content"]
            return


class ChatRequest(BaseModel):
    message: str
    course_id: int | None = None
    history: list[dict[str, Any]] = []
    session_id: int | None = None  # optional server-side persistence


def _do_turn(req: ChatRequest, emit) -> None:
    """Blocking run_turn + optional persistence. Runs in a worker thread."""
    from agent.chat import run_turn
    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    db = DB(cfg.db_path)
    key: tuple = (req.session_id,) if req.session_id else (req.course_id,)
    try:
        history = _inject_reasoning(req.history, key)
        answer, full_history = run_turn(cfg, db, req.message, course_id=req.course_id,
                                        history=history, verbose=False, emit=emit)
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

    def emit(event: str, data: Any) -> None:
        queue.put_nowait({"event": event, "data": data})

    async def runner() -> None:
        await asyncio.to_thread(_do_turn, req, emit)
        await queue.put(None)

    asyncio.create_task(runner())

    async def gen():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield {"event": item["event"],
                   "data": json.dumps(item["data"], default=str)}

    return EventSourceResponse(gen())
