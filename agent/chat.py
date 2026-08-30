"""The agent loop — model proposes tool calls, we execute, repeat until answer.

Stateless by design: every turn rebuilds context from live state (time,
term, course scope, upcoming events). The web UI will wrap this same
function with streaming.
"""
from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import httpx

from sync.config import Config
from sync.db import DB

from .citations import CitationRegistry
from .context import build_system_prompt
from .tools import TOOL_SCHEMAS, execute_tool

MAX_ITERATIONS = 24
NUDGE_AT = 22  # after this many rounds, tell the model to stop calling tools


def llm_headers(cfg: Config) -> dict:
    """Headers for OpenAI-compatible calls. Bearer auth only when a key is set
    (local gateways usually need none)."""
    if cfg.llm_api_key:
        return {"Authorization": f"Bearer {cfg.llm_api_key}"}
    return {}


def _model_call(cfg: Config, messages: list[dict], model: str | None = None,
                on_token=None, on_reasoning=None) -> tuple[dict, dict | None]:
    """Streaming chat completion with LLM failover.

    Tries each URL in ``cfg.llm_endpoints()`` (llm_urls / OPENAI_ENDPOINTS,
    falling back to the single llm_url / OPENAI_ENDPOINT). A connection/timeout/HTTP error on one
    endpoint fails over to the next; only if every endpoint fails do we raise.
    Accumulates content + tool_calls from SSE deltas; on_token(text) fires per
    content token and on_reasoning(text) per chain-of-thought chunk. Returns
    (message, usage).
    """
    endpoints = cfg.llm_endpoints()
    if not endpoints:
        raise RuntimeError("no LLM endpoint configured")
    last_err: Exception | None = None
    for url in endpoints:
        try:
            with httpx.stream(
                "POST",
                f"{url}/chat/completions",
                headers=llm_headers(cfg),
                json={
                    "model": model or cfg.llm_model,
                    "messages": messages,
                    "tools": TOOL_SCHEMAS,
                    "max_tokens": 2000,
                    "stream": True,
                    **({"tool_choice": cfg.llm_tool_choice}
                       if cfg.llm_tool_choice is not None else {}),
                },
                timeout=300,
            ) as r:
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
                    # chain-of-thought: some endpoints stream it as delta['reasoning'];
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
        except (httpx.TransportError, httpx.TimeoutException, httpx.HTTPStatusError) as e:
            # Surface the upstream error body — a 400 often explains the cause
            # (malformed tool schema, unsupported field, …) and is invisible
            # otherwise.
            body = ""
            if isinstance(e, httpx.HTTPStatusError):
                try:
                    body = (e.response.text or "")[:1000]
                except Exception:
                    body = ""
            last_err = e if not body else RuntimeError(f"{e} | body: {body}")
            continue
    raise last_err or RuntimeError("all LLM endpoints failed")


def run_turn(cfg: Config, db: DB, user_message: str, course_id: int | None = None,
             model: str | None = None, history: list[dict] | None = None,
             verbose: bool = True, emit=None, attachments: list[dict] | None = None) -> tuple[str, list[dict]]:
    """Run one user turn. Returns (final_answer, full_message_history).

    emit(event, data) is called for SSE streaming:
      reasoning(event)  -> {"text": ...}  (chain-of-thought chunk, pre-answer)
      token(event)      -> {"text": ...}
      tool_start(event) -> {"tool": name, "args": {...}}
      tool_end(event)   -> {"tool": name, "result": {...}}
      cite_register     -> {id, ref, label, page?, fileId?, nodeId?, ...}
      done(event)       -> {"answer": ..., "citations": [...]}
    """
    # Preflight: chat needs an LLM endpoint + model. Fail clearly instead of
    # letting httpx raise an opaque connection error at request time.
    if not cfg.llm_endpoints():
        msg = ("No LLM endpoint configured. Set llm_url/llm_urls (and llm_model) in "
               "config.yaml or OPENAI_ENDPOINT/OPENAI_ENDPOINTS, then retry. "
               "Sync, browse, and corpus search work without an LLM.")
        if emit:
            emit("done", {"answer": msg, "model": None, "usage": None})
        return msg, history or []
    if not (model or cfg.llm_model):
        msg = ("No LLM model configured. Run `python -m sync models` to list "
               "available models at your endpoint, then set llm_model in "
               "config.yaml or OPENAI_MODEL.")
        if emit:
            emit("done", {"answer": msg, "model": None, "usage": None})
        return msg, history or []
    messages = [{"role": "system", "content": build_system_prompt(cfg, db, course_id)}]
    messages.extend(history or [])
    files = attachments or []
    extracted = [
        f"\n\n--- Attached file: {a['original_name']} ---\n{a['extracted_text']}\n--- End attached file ---"
        for a in files if a.get("extracted_text")
    ]
    images = []
    for a in files:
        if a.get("mime_type", "").startswith("image/"):
            raw = Path(a["stored_path"]).read_bytes()
            encoded = base64.b64encode(raw).decode("ascii")
            images.append({"type": "image_url", "image_url": {
                "url": f"data:{a['mime_type']};base64,{encoded}",
            }})
    if images:
        content: str | list[dict] = [{"type": "text", "text": user_message + "".join(extracted)}]
        content.extend(images)
    else:
        content = user_message + "".join(extracted)
    messages.append({"role": "user", "content": content})

    citations = CitationRegistry(db, cfg, course_id)
    total_usage: dict = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    for i in range(MAX_ITERATIONS):
        if i >= NUDGE_AT and not any(m.get("role") == "user" and "must answer now" in m.get("content", "") for m in messages):
            messages.append({"role": "user", "content": (
                "You have used many tool calls. Answer now based on what you "
                "have gathered — do not call any more tools.")})
        # Up to 4 attempts (1 + 3 retries): the provider's reasoning_content
        # passback validation is stateful and intermittently 400s a
        # perfectly-formed request (the same messages succeed on re-send).
        # Never let a transient upstream failure kill a whole turn.
        msg = None
        usage = None
        for attempt in (1, 2, 3, 4):
            try:
                msg, usage = _model_call(cfg, messages, model,
                                         on_token=(lambda t: emit("token", {"text": t}) if emit else None),
                                         on_reasoning=(lambda t: emit("reasoning", {"text": t}) if emit else None))
                break
            except Exception as e:
                if attempt == 4:
                    raise
                delay = attempt  # 1s, 2s, 3s backoff
                print(f"  [model_call] transient failure ({e.__class__.__name__}: {str(e)[:120]}), retry {attempt}/3 in {delay}s…", flush=True)
                time.sleep(delay)
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
                    "model": model or cfg.llm_model,
                    "usage": total_usage if any(total_usage.values()) else None,
                    "citations": citations.sources,
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
            new_cites = citations.register_from_tool(name, result, args)
            for cite in new_cites:
                if emit:
                    emit("cite_register", cite)
            result = citations.annotate_result(name, result, new_cites)
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
    print("Campus chat. Type 'exit' to quit. (model: %s)" % (model or cfg.llm_model))
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
    ap.add_argument("--course", help="course code scope, e.g. 'CS 1100A'")
    ap.add_argument("--model", help="LLM model override")
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
