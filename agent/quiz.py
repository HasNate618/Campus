"""Quiz-me: free-recall quizzing over memory facts, blind-graded.

Two small model calls (question generation + blind grading), both
non-streaming completions through bifrost. The blind grader sees ONLY the
answer key + the user's words — no chat history, no course content — so it
can't flatter or leak the lesson (the engram pattern).
"""

from __future__ import annotations

import json
import re

import httpx


def _complete(cfg, messages: list[dict], max_tokens: int = 300) -> str:
    r = httpx.post(
        f"{cfg.bifrost_url}/chat/completions",
        json={"model": cfg.bifrost_model, "messages": messages, "max_tokens": max_tokens},
        timeout=120,
    )
    r.raise_for_status()
    return (r.json()["choices"][0]["message"]["content"] or "").strip()


def _json_or_none(text: str) -> dict | None:
    """Parse {…} JSON out of a completion — the model often wraps it in fences."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def make_question(cfg, fact: str, category: str = "") -> str:
    """Turn a fact into a free-recall question that does NOT give away the answer."""
    topic = f" (topic: {category})" if category else ""
    q = _complete(cfg, [
        {"role": "system", "content":
         "You write free-recall study questions from facts. The question must be SPECIFIC — "
         "name the exact subject (course, assignment, date, concept) so the student knows what "
         "is being asked — but must never contain the answer's key words or facts. Output ONLY "
         "the question, one sentence."},
        {"role": "user", "content": f"Fact: {fact}{topic}\n\nWrite the question:"},
    ], max_tokens=120)
    return q or fact


def blind_grade(cfg, answer_key: str, user_answer: str) -> tuple[str, str]:
    """Strict blind grading. Returns (grade, feedback) with grade in
    correct|partial|wrong. The context is ONLY the key + the answer — no
    conversation history, no course material (no flattery, no leniency)."""
    out = _complete(cfg, [
        {"role": "system", "content":
         "You grade a student's free-recall answer against the expected answer. The expected "
         "answer's SUBSTANCE is what matters: grade correct if the student's answer contains "
         "that substance (paraphrase counts, vagueness and wrong details don't disqualify a "
         "substantively right answer); partial if it contains only part of the substance; "
         "wrong if it contains none. Be fair, not lenient: never grade down for phrasing, "
         "never grade up for confidence. Reply with JSON only: "
         '{"grade": "correct" | "partial" | "wrong", "feedback": "one short line for the student"}.'},
        {"role": "user", "content":
         f"Expected answer: {answer_key}\n\nStudent answer: {user_answer}"},
    ], max_tokens=160)
    parsed = _json_or_none(out)
    if parsed and parsed.get("grade") in ("correct", "partial", "wrong"):
        return parsed["grade"], str(parsed.get("feedback", ""))[:300]
    # fallback: unparsable grade call — be strict rather than lenient
    return "wrong", "Grading failed to parse — treat as wrong (retry if this repeats)."
