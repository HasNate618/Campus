"""The agent loop — model proposes tool calls, we execute, repeat until answer.

Stateless by design: every turn rebuilds context from live state (time,
term, course scope, upcoming events). The web UI will wrap this same
function with streaming.
"""
from __future__ import annotations

import json

import httpx

from sync.config import Config
from sync.db import DB

from .context import build_system_prompt
from .tools import TOOL_SCHEMAS, execute_tool

MAX_ITERATIONS = 24
NUDGE_AT = 22  # after this many rounds, tell the model to stop calling tools


def _model_call(cfg: Config, messages: list[dict], model: str | None = None,
                on_token=None, on_reasoning=None) -> tuple[dict, dict | None]:
    """Streaming chat completion. Accumulates content + tool_calls from SSE
    deltas; on_token(text) fires per content token and on_reasoning(text)
    per chain-of-thought chunk (both used by the web SSE). Returns
    (message, usage) — usage comes in the final chunk of the stream."""
    r = httpx.post(
        f"{cfg.bifrost_url}/chat/completions",
        json={
            "model": model or cfg.bifrost_model,
            "messages": messages,
            "tools": TOOL_SCHEMAS,
            "tool_choice": "auto",
            "max_tokens": 2000,
            "stream": True,
        },
        timeout=300,
    )
    r.raise_for_status()
    content = ""
    reasoning = ""
    tool_calls: dict[int, dict] = {}
    usage: dict | None = None
    for line in r.iter_lines():
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        chunk = json.loads(data)
        if chunk.get("usage"):
            usage = chunk["usage"]
        delta = chunk.get("choices", [{}])[0].get("delta", {})
        if delta.get("content"):
            content += delta["content"]
            if on_token:
                on_token(delta["content"])
        # chain-of-thought: bifrost streams it as delta['reasoning'];
        # deepseek's native thinking mode uses reasoning_content. Surface
        # both live and keep them on the message (reasoning_content MUST be
        # passed back to the API on subsequent calls or it 400s).
        rchunk = delta.get("reasoning") or delta.get("reasoning_content")
        if rchunk:
            reasoning += rchunk
            if on_reasoning:
                on_reasoning(rchunk)
        for tc in delta.get("tool_calls", []):
            idx = tc.get("index", 0)
            entry = tool_calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
            if tc.get("id"):
                entry["id"] = tc["id"]
            fn = tc.get("function", {})
            if fn.get("name") and not entry["name"]:
                entry["name"] = fn["name"]
            if fn.get("arguments"):
                entry["arguments"] += fn["arguments"]
    msg: dict = {"role": "assistant", "content": content}
    if reasoning:
        msg["reasoning"] = reasoning
        msg["reasoning_content"] = reasoning  # provider passback requirement
    if tool_calls:
        msg["tool_calls"] = [
            {"id": e["id"], "type": "function",
             "function": {"name": e["name"], "arguments": e["arguments"]}}
            for e in tool_calls.values()]
    return msg, usage


def run_turn(cfg: Config, db: DB, user_message: str, course_id: int | None = None,
             model: str | None = None, history: list[dict] | None = None,
             verbose: bool = True, emit=None) -> tuple[str, list[dict]]:
    """Run one user turn. Returns (final_answer, full_message_history).

    emit(event, data) is called for SSE streaming:
      reasoning(event)  -> {"text": ...}  (chain-of-thought chunk, pre-answer)
      token(event)      -> {"text": ...}
      tool_start(event) -> {"tool": name, "args": {...}}
      tool_end(event)   -> {"tool": name, "result": {...}}
      done(event)       -> {"answer": ...}
    """
    messages = [{"role": "system", "content": build_system_prompt(cfg, db, course_id)}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": user_message})

    total_usage: dict = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    for i in range(MAX_ITERATIONS):
        if i >= NUDGE_AT and not any(m.get("role") == "user" and "must answer now" in m.get("content", "") for m in messages):
            messages.append({"role": "user", "content": (
                "You have used many tool calls. Answer now based on what you "
                "have gathered — do not call any more tools.")})
        msg, usage = _model_call(cfg, messages, model,
                                 on_token=(lambda t: emit("token", {"text": t}) if emit else None),
                                 on_reasoning=(lambda t: emit("reasoning", {"text": t}) if emit else None))
        if usage:
            for k in total_usage:
                total_usage[k] += usage.get(k, 0)
        if not msg.get("tool_calls"):
            final: dict = {"role": "assistant", "content": msg.get("content", "")}
            if msg.get("reasoning"):
                final["reasoning"] = msg["reasoning"]
            messages.append(final)
            answer = msg.get("content", "")
            if emit:
                emit("done", {
                    "answer": answer,
                    "model": model or cfg.bifrost_model,
                    "usage": total_usage if any(total_usage.values()) else None,
                })
            return answer, messages

        # assistant message with tool calls goes into history as-is
        messages.append(msg)
        for tc in msg["tool_calls"]:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            if verbose:
                print(f"  [tool] {name}({json.dumps(args)[:160]})", flush=True)
            if emit:
                emit("tool_start", {"tool": name, "args": args})
            result = execute_tool(name, args, db, cfg)
            if emit:
                emit("tool_end", {"tool": name, "result": result})
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result, default=str)[:6000],
            })

    answer = "(stopped: tool-call iteration limit reached)"
    if emit:
        emit("done", {"answer": answer})
    return answer, messages


def chat_repl(cfg: Config, db: DB, course_code: str | None = None,
              model: str | None = None) -> int:
    """Interactive terminal chat."""
    course_id = None
    if course_code:
        row = db.conn.execute("SELECT id FROM courses WHERE code=?", (course_code,)).fetchone()
        if not row:
            row = db.conn.execute("SELECT id FROM courses WHERE code LIKE ?",
                                  (f"%{course_code.upper().replace(' ', '')}%",)).fetchone()
        if row:
            course_id = row["id"]
            print(f"Scoped to course: {course_code}")
        else:
            print(f"Unknown course: {course_code} — continuing unscoped")
    print("Campus chat. Type 'exit' to quit. (model: %s)" % (model or cfg.bifrost_model))
    history: list[dict] = []
    while True:
        try:
            q = input("\nyou> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not q:
            continue
        if q.lower() in ("exit", "quit"):
            break
        answer, history = run_turn(cfg, db, q, course_id=course_id, model=model, history=history)
        print(f"\ncampus> {answer}")
        # keep history bounded (drop system + oldest user/assistant pairs)
        if len(history) > 24:
            history = history[-20:]
    return 0


def main() -> int:
    import argparse

    from sync.token_store import TokenStore

    ap = argparse.ArgumentParser(description="Campus agent chat")
    ap.add_argument("--one", help="single question, no REPL")
    ap.add_argument("--course", help="course code scope, e.g. 'SE 2250B'")
    ap.add_argument("--model", help="bifrost model override")
    ap.add_argument("--verbose/--quiet", dest="verbose", action=argparse.BooleanOptionalAction, default=True)
    args = ap.parse_args()

    cfg = Config.load()
    db = DB(cfg.db_path)

    course_id = None
    if args.course:
        row = db.conn.execute("SELECT id FROM courses WHERE code=?", (args.course,)).fetchone()
        if row:
            course_id = row["id"]
        else:
            print(f"Unknown course: {args.course}")
            return 2

    if args.one:
        answer, _ = run_turn(cfg, db, args.one, course_id=course_id,
                             model=args.model, verbose=args.verbose)
        print(answer)
        return 0
    return chat_repl(cfg, db, args.course, model=args.model)


if __name__ == "__main__":
    import sys
    sys.exit(main())
