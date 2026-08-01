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

MAX_ITERATIONS = 12
NUDGE_AT = 8  # after this many rounds, tell the model to stop calling tools


def _model_call(cfg: Config, messages: list[dict], model: str | None = None) -> dict:
    r = httpx.post(
        f"{cfg.bifrost_url}/chat/completions",
        json={
            "model": model or cfg.bifrost_model,
            "messages": messages,
            "tools": TOOL_SCHEMAS,
            "tool_choice": "auto",
            "max_tokens": 2000,
        },
        timeout=180,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]


def run_turn(cfg: Config, db: DB, user_message: str, course_id: int | None = None,
             model: str | None = None, history: list[dict] | None = None,
             verbose: bool = True) -> tuple[str, list[dict]]:
    """Run one user turn. Returns (final_answer, full_message_history)."""
    messages = [{"role": "system", "content": build_system_prompt(db, course_id)}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": user_message})

    for i in range(MAX_ITERATIONS):
        if i >= NUDGE_AT and not any(m.get("role") == "user" and "must answer now" in m.get("content", "") for m in messages):
            messages.append({"role": "user", "content": (
                "You have used many tool calls. Answer now based on what you "
                "have gathered — do not call any more tools.")})
        msg = _model_call(cfg, messages, model)
        if not msg.get("tool_calls"):
            messages.append({"role": "assistant", "content": msg.get("content", "")})
            return msg.get("content", ""), messages

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
            result = execute_tool(name, args, db, cfg)
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result, default=str)[:6000],
            })

    return "(stopped: tool-call iteration limit reached)", messages


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
    print("HippoCampus chat. Type 'exit' to quit. (model: %s)" % (model or cfg.bifrost_model))
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
        print(f"\nhippo> {answer}")
        # keep history bounded (drop system + oldest user/assistant pairs)
        if len(history) > 24:
            history = history[-20:]
    return 0


def main() -> int:
    import argparse

    from sync.token_store import TokenStore

    ap = argparse.ArgumentParser(description="HippoCampus agent chat")
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
