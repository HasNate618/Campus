"""Mock chat SSE endpoint — streams simulated run_turn responses."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    course_id: int | None = None
    history: list[dict[str, Any]] = []


MOCK_RESPONSES = {
    "syllabus": "The course covers OOP fundamentals, design patterns, testing, and software construction practices. See Module 1 in the content tree.",
    "default": "I can help with course materials, deadlines, and assignments. Try asking about the syllabus or upcoming work.",
}


async def _mock_stream(message: str, course_id: int | None):
    scope = f"course {course_id}" if course_id else "all courses"
    lower = message.lower()

    yield {"event": "tool_start", "data": json.dumps({"tool": "harness_query", "args": {"scope": scope}})}
    await asyncio.sleep(0.4)
    yield {"event": "tool_end", "data": json.dumps({"tool": "harness_query", "result": "3 rows"})}
    await asyncio.sleep(0.2)

    text = MOCK_RESPONSES["syllabus"] if "syllabus" in lower else MOCK_RESPONSES["default"]
    words = text.split(" ")
    chunk = ""
    for i, word in enumerate(words):
        chunk += (" " if i else "") + word
        yield {"event": "token", "data": json.dumps({"text": word + (" " if i < len(words) - 1 else "")})}
        await asyncio.sleep(0.05)

    yield {"event": "done", "data": json.dumps({"answer": text})}


@router.post("")
async def chat(req: ChatRequest):
    async def event_generator():
        async for event in _mock_stream(req.message, req.course_id):
            yield event

    return EventSourceResponse(event_generator())
