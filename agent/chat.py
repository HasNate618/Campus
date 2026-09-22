"""The agent loop — model proposes tool calls, we execute, repeat until answer.

Stateless by design: every turn rebuilds context from live state (time,
term, course scope, upcoming events). The web UI will wrap this same
function with streaming.
"""
from __future__ import annotations

import base64
import json
import re
import time
import uuid
from pathlib import Path

import httpx

from sync.config import Config
from sync.db import DB

from .citations import CitationRegistry
from .context import build_system_prompt
from .view import render_view_block
from .tools import TOOL_SCHEMAS, execute_tool

MAX_ITERATIONS = 10
NUDGE_AT = 6  # after this many rounds, tell the model to stop calling tools


LLM_USER_AGENT = "Campus/0.1"

# Allowed chars for a caller-asserted session id, mirroring Bifrost's
# ValidateOpencodeSessionID (maximhq/bifrost#6818): header-safe only, so the
# value can ride along verbatim through gateways. Deliberately the same set
# Bifrost accepts for x-opencode-session — x-session-id falls back into that
# chain — minus nothing.
_SESSION_ID_SAFE = re.compile(r"[^A-Za-z0-9._~=-]")
MAX_SESSION_ID_LEN = 255


def sanitize_session_id(value: str | None) -> str | None:
    """Clean a conversation id for use as x-session-id. Returns None when
    unusable (empty/only-unsafe chars) so callers fall back to a fresh UUID
    instead of sending a header the gateway would reject."""
    if not value:
        return None
    v = _SESSION_ID_SAFE.sub("", value.strip())
    if not v:
        return None
    return v[:MAX_SESSION_ID_LEN]


def llm_session_headers(conversation_id: str | None) -> dict:
    """Standard session-affinity headers for chat-completion calls.

    Sends ONLY the generic x-session-id (one stable value per conversation).
    Never sends x-opencode-session directly: when the endpoint is Bifrost,
    its transport resolves affinity itself (verbatim x-opencode-session, else
    the session identity incl. x-session-id, else a synth UUID) and forwards
    upstream on opencode-family calls only — a provider-specific header from
    us would leak affinity to every provider behind the gateway.
    """
    v = sanitize_session_id(conversation_id)
    if not v:
        return {}
    return {"x-session-id": v}


def llm_headers(cfg: Config) -> dict:
    """Headers for OpenAI-compatible calls. Bearer auth only when a key is set
    (local gateways usually need none). Always identifies as Campus (not a
    generic HTTP-library UA) so gateways can attribute + route agent traffic."""
    headers = {"User-Agent": LLM_USER_AGENT}
    if cfg.llm_api_key:
        headers["Authorization"] = f"Bearer {cfg.llm_api_key}"
    return headers


def _model_call(cfg: Config, messages: list[dict], model: str | None = None,
                on_token=None, on_reasoning=None,
                session_id: str | None = None) -> tuple[dict, dict | None]:
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
    headers = {**llm_headers(cfg), **llm_session_headers(session_id)}
    last_err: Exception | None = None
    _normalize_messages(messages)
    for url in endpoints:
        try:
            with httpx.stream(
                "POST",
                f"{url}/chat/completions",
                headers=headers,
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
        # pi-lens-ignore: no-boolean-in-except
        except (httpx.TransportError, httpx.TimeoutException, httpx.HTTPStatusError) as e:
            # Surface the upstream error body — a 400 often explains the cause
            # (malformed tool schema, unsupported field, …) and is invisible
            # otherwise.
            body = ""
            if isinstance(e, httpx.HTTPStatusError):
                try:
                    body = (e.response.text or "")[:1000]
                except Exception:
                    # Streamed responses aren't read yet — .text raises
                    # ResponseNotRead. Read the buffered bytes directly.
                    try:
                        body = e.response.read().decode("utf-8", "replace")[:1000]
                    except Exception:
                        body = ""
            last_err = e if not body else RuntimeError(f"{e} | body: {body}")
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 400:
                # Envelope-level 400s are bifrost's own validation (0ms, empty
                # routing_info) and are invisible in the response body. Dump the
                # payload SHAPE so the offending field is identifiable.
                try:
                    shape = [
                        f"{m.get('role')}:{type(m.get('content')).__name__}"
                        f"{'/tc' if m.get('tool_calls') else ''}"
                        f"{'!' if m.get('content') is None else ''}"
                        for m in messages
                    ]
                    print(f"  [model_call] 400 payload model={model or cfg.llm_model!r} "
                          f"n={len(messages)} tools={len(TOOL_SCHEMAS)} "
                          f"roles=[{', '.join(shape)}]", flush=True)
                except Exception:
                    pass
                # Full-payload capture: bifrost's envelope 400s return no
                # useful body, so save the exact request for offline replay.
                try:
                    import time as _t, pathlib as _p
                    dump = _p.Path("/tmp") / f"campus-400-{int(_t.time())}.json"
                    dump.write_text(json.dumps({
                        "model": model or cfg.llm_model,
                        "messages": messages,
                        "tools": TOOL_SCHEMAS,
                        "url": url,
                        "status": e.response.status_code,
                        "response_body": body,
                    }, default=str))
                    print(f"  [model_call] full payload saved to {dump}", flush=True)
                except Exception:
                    pass
            continue
    raise last_err or RuntimeError("all LLM endpoints failed")


_DIGEST_CHARS = 2000
_PER_TOOL_CHARS = 400


def store_turn_digest(db, session_id: int | None, items: list[dict]) -> None:
    """Persist compact per-tool digests (role='tool' rows) so the next turn
    reuses findings instead of re-surveying. Skipped without session_id."""
    if session_id is None:
        return
    for it in items or []:
        res = str(it.get("result") or "")[:_PER_TOOL_CHARS]
        db.conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, tool_name)"
            " VALUES (?,?,?,?)",
            (session_id, "tool", f"args={it.get('args', {})} result={res}",
             it.get("tool", "")))
    db.conn.commit()


def load_turn_digest(db, session_id: int | None) -> str:
    """Prior turns' tool findings, newest last, capped — for injection into
    the next turn's context. '' when none."""
    if session_id is None:
        return ""
    rows = db.conn.execute(
        "SELECT tool_name, content FROM chat_messages WHERE session_id=? AND role='tool'"
        " ORDER BY id DESC LIMIT 8", (session_id,)).fetchall()
    if not rows:
        return ""
    lines = [f"- {r['tool_name']}: {(r['content'] or '')[:_PER_TOOL_CHARS]}"
             for r in reversed(rows)]
    return ("PREVIOUS TURN TOOL FINDINGS (already fetched — reuse, do not re-call):\n"
            + "\n".join(lines))[:_DIGEST_CHARS]


_TITLE_PROMPT = (
    "Summarize this course question as a 2-6 word chat title. "
    "Plain text only — no quotes, no markdown, max 60 characters.\n"
    "Question: {q}\nAnswer: {a}"
)


def clean_title(text: str) -> str:
    """Plain-text chat title: strip quotes/markdown, collapse whitespace."""
    t = re.sub(r"[*_`#>\\\"]", "", text or "").strip()
    t = re.sub(r"\s+", " ", t).strip().strip("'\"")
    return t[:60].strip()


def generate_session_title(db, cfg, session_id: int | None, model: str | None,
                           question: str, answer: str) -> str | None:
    """LLM title for first-exchange sessions, persisted to chat_sessions.

    Runs only when this turn completed the session's FIRST exchange (exactly
    one assistant row) — later turns and regenerations keep their title, so
    at most one extra model call per session. Uses the turn's own model (the
    first message's model), never a hardcoded one. Returns the title, or
    None when skipped/failed — the caller keeps the placeholder and the turn
    is unaffected. Never raises."""
    if session_id is None:
        return None
    try:
        n = db.conn.execute(
            "SELECT COUNT(*) n FROM chat_messages WHERE session_id=? AND role='assistant'",
            (session_id,)).fetchone()["n"]
        if n != 1:
            return None
        msg, _ = _model_call(
            cfg,
            [{"role": "user", "content": _TITLE_PROMPT.format(
                q=(question or "")[:500], a=(answer or "")[:500])}],
            model=model or cfg.llm_model)
        title = clean_title(msg.get("content", ""))
        if not title:
            return None
        db.conn.execute("UPDATE chat_sessions SET title=? WHERE id=?",
                        (title, session_id))
        db.conn.commit()
        return title
    except Exception:
        return None


# content_read_file bounds itself on page boundaries (PAGE_READ_BUDGET in
# agent/tools.py) and reports exactly which pages it delivered, so this cap only
# needs headroom above that budget — it must never be the thing that cuts a read
# mid-page. Everything else keeps the 6000 default.
_TOOL_RESULT_CAPS = {"course_map": 12000, "content_read_file": 36000}

# Fields that must survive truncation: `sources` carries the cite_ids the
# system prompt requires the model to cite with. A plain slice of the
# serialized JSON silently dropped it, because annotate_result appends it
# last — so large results arrived both invalid and uncitable.
_NEVER_TRUNCATE = ("sources", "error", "truncated", "note")


def truncate_result(name: str, result) -> str:
    """Bound a tool result for message history; ALWAYS returns a string.

    A `tool` message whose content is a dict is rejected by the gateway with a
    local 400 ("Invalid request payload") before any upstream call, which kills
    the entire turn — so the error path returns full error text, still as a
    string, and errors are never truncated.

    The size bound shrinks the largest unprotected string FIELD instead of
    slicing the serialized JSON: a plain slice produced invalid JSON and cut
    `sources` off the end, leaving large results both unparseable and
    uncitable.

    For content_read_file the primary bounding lives in the TOOL: it delivers
    whole pages up to PAGE_READ_BUDGET (32000 chars) and attaches a note naming
    exactly which pages remain. That cap's 36000 entry exists so this function
    has headroom over it and stays a BACKSTOP — if it ever fell to or below
    PAGE_READ_BUDGET it would re-slice a page-bounded read mid-page and
    silently return the model to the "I only got to page 54" failure.
    """
    if isinstance(result, str):
        return result
    if not isinstance(result, dict):
        return json.dumps(result, default=str)
    if result.get("error"):
        return json.dumps(result, default=str)  # full error text, still a string

    cap = _TOOL_RESULT_CAPS.get(name, 6000)
    out = dict(result)
    for _ in range(8):  # bounded: every pass strictly shrinks one field
        text = json.dumps(out, default=str)
        if len(text) <= cap:
            return text
        key = max(
            (k for k, v in out.items() if isinstance(v, str) and k not in _NEVER_TRUNCATE),
            key=lambda k: len(out[k]),
            default=None,
        )
        if key is None:
            # Bulk payloads such as content_grep's `matches` and search_corpus's
            # `hits` are LISTS: there is no string field to shrink, and falling
            # straight to the protected-only fallback discarded them whole — a
            # broad grep reached the model with ZERO matches where a plain slice
            # once kept the first ones. Trim trailing items instead.
            bulk = max(
                (k for k, v in out.items()
                 if isinstance(v, list) and k not in _NEVER_TRUNCATE),
                key=lambda k: len(out[k]),
                default=None,
            )
            if bulk is None or not out[bulk]:
                break
            # Copy first: `out = dict(result)` is SHALLOW, and the caller
            # (CitationRegistry.register_from_tool) still reads this same list
            # after truncation — popping in place would corrupt it.
            items = list(out[bulk])
            dropped = 0
            while True:
                if len(json.dumps(out, default=str)) <= cap:
                    break                      # fits now
                if not items:
                    break                      # nothing left to give
                items.pop()
                dropped += 1
                out[bulk] = items + [{"…": f"truncated, {dropped} item(s) omitted"}]
            if len(json.dumps(out, default=str)) > cap:
                break                          # even empty does not fit -> fallback
            out["truncated"] = True
            continue
        # leave room for the marker plus the surrounding JSON
        keep = len(out[key]) - (len(text) - cap) - 120
        if keep >= len(out[key]):
            break
        omitted = len(out[key]) - max(keep, 0)
        out[key] = out[key][:max(keep, 0)] + f"\n…[truncated, {omitted} chars omitted]"
        out["truncated"] = True

    # Last resort (many oversized fields): keep only what the model must have,
    # and never drop the cite_ids. The reduction happens on the DATA — this used
    # to end in json.dumps(...)[:cap], slicing serialized JSON, which returned an
    # unparseable fragment with `sources` cut mid-string. That is precisely the
    # failure this function exists to prevent, just on a narrower path.
    minimal = {k: v for k, v in out.items() if k in _NEVER_TRUNCATE}
    minimal.setdefault("truncated", True)
    minimal["note"] = "result too large for history — bulk payload omitted"
    text = json.dumps(minimal, default=str)
    if len(text) <= cap:
        return text
    src = minimal.get("sources")
    if isinstance(src, list) and src:
        # Binary search the longest prefix of cite_ids that fits, so a 200-item
        # list costs ~8 serializations instead of 200.
        lo, hi, best = 0, len(src), 0
        while lo <= hi:
            mid = (lo + hi) // 2
            minimal["sources"] = src[:mid]
            if len(json.dumps(minimal, default=str)) <= cap:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1
        minimal["sources"] = src[:best]
        text = json.dumps(minimal, default=str)
        if len(text) <= cap:
            return text
    # Absolute fallback: a fixed, tiny, valid payload — never a slice. Every
    # unbounded field has been reduced by now, so this always fits.
    return json.dumps({"truncated": True,
                       "note": "result too large for history — bulk payload omitted"},
                      default=str)


def _normalize_messages(messages: list[dict]) -> list[dict]:
    """Last line of defence before a request goes out.

    A message `content` must be a string or a list of typed parts. Dicts and
    other scalars are silently accepted by our own code but rejected by the
    gateway's envelope validation with a body-less 400, so coerce here rather
    than lose a turn. History from the browser is untrusted too.
    """
    for m in messages:
        if not isinstance(m, dict):
            continue
        c = m.get("content")
        if c is None or isinstance(c, (str, list)):
            continue
        m["content"] = json.dumps(c, default=str)
    return messages


def _sanitize_history(history: list[dict]) -> list[dict]:
    """Make incoming history safe to re-send.

    Providers reject `content: null` (400) and an assistant turn carrying
    neither text nor tool_calls. Both reach us legitimately: the OpenAI shape
    uses `content: null` on tool-call turns, and models sometimes stop having
    emitted reasoning only. Normalise instead of forwarding the null.
    """
    out: list[dict] = []
    for m in history:
        if not isinstance(m, dict):
            continue
        m = dict(m)
        if m.get("content") is None:
            m["content"] = ""
        if m.get("role") == "assistant" and not m.get("content") and not m.get("tool_calls"):
            continue  # empty assistant turn — nothing to answer
        out.append(m)
    return out


def run_turn(cfg: Config, db: DB, user_message: str, course_id: int | None = None,
             model: str | None = None, history: list[dict] | None = None,
             verbose: bool = True, emit=None, attachments: list[dict] | None = None,
             conversation_id: str | None = None,
             prior_context: str = "",
             view: dict | None = None) -> tuple[str, list[dict]]:
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
        msg = ("No LLM endpoint configured. Set it in Settings (the gear in the "
               "sidebar — the Home header on mobile), in config.yaml, or set "
               "OPENAI_ENDPOINT/OPENAI_ENDPOINTS, then retry. "
               "Sync, browse, and corpus search work without an LLM.")
        if emit:
            emit("done", {"answer": msg, "model": None, "usage": None})
        return msg, history or []
    if not (model or cfg.llm_model):
        msg = ("No LLM model configured. Run `python -m sync models` to list "
               "available models, then pick one in Settings, in `config.yaml`, "
               "or set OPENAI_MODEL.")
        if emit:
            emit("done", {"answer": msg, "model": None, "usage": None})
        return msg, history or []
    system_text = build_system_prompt(cfg, db, course_id)
    if prior_context:
        system_text += "\n\n" + prior_context
    # Appended after everything else on purpose: the prompt's prefix is what an
    # upstream gateway caches, and this block changes every turn. Returns ""
    # when there is nothing honest to say about the current view.
    system_text += render_view_block(cfg, db, view, course_id)
    # Annotated, not inferred: the initializer is all-strings, so Pyright
    # pinned this to list[dict[str, str]] and then rejected the multimodal user
    # message below, whose content is str | list[dict]. The function's own
    # return type is list[dict] — this is the honest type.
    messages: list[dict] = [{"role": "system", "content": system_text}]
    messages.extend(_sanitize_history(history or []))
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

    # One stable session for the whole turn: every tool-loop iteration and
    # retry below shares it so the gateway keeps one backend/prompt cache.
    # Falls back to a fresh id per turn (intra-turn stable, no false affinity
    # across conversations) when the caller has no conversation identity.
    session_id = sanitize_session_id(conversation_id) or str(uuid.uuid4())

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
                                         on_reasoning=(lambda t: emit("reasoning", {"text": t}) if emit else None),
                                         session_id=session_id)
                break
            except Exception as e:
                if attempt == 4:
                    raise
                delay = attempt  # 1s, 2s, 3s backoff
                print(f"  [model_call] transient failure ({e.__class__.__name__}: {str(e)[:600]}), retry {attempt}/3 in {delay}s…", flush=True)
                time.sleep(delay)
        assert msg is not None  # attempt 4 re-raises, so msg is always set here
        if usage:
            for k in total_usage:
                total_usage[k] += usage.get(k, 0)
        if not msg.get("tool_calls"):
            final: dict = {"role": "assistant", "content": msg.get("content") or ""}
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
            content = truncate_result(name, result)
            if not isinstance(content, str):  # belt and braces
                content = json.dumps(content, default=str)
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": content,
            })

    answer = "(stopped: tool-call iteration limit reached)"
    if emit:
        emit("done", {"answer": answer})
    return answer, messages


def chat_repl(cfg: Config, db: DB, course_code: str | None = None,
              model: str | None = None, conversation_id: str | None = None) -> int:
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
    # One stable session for the whole REPL process — every turn shares it.
    conversation_id = sanitize_session_id(conversation_id) or str(uuid.uuid4())
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
        answer, history = run_turn(cfg, db, q, course_id=course_id, model=model,
                                   history=history, conversation_id=conversation_id)
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
    ap.add_argument("--session", help="stable conversation id for session affinity "
                        "(default: fresh id per invocation)")
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
                             model=args.model, verbose=args.verbose,
                             conversation_id=args.session)
        print(answer)
        return 0
    return chat_repl(cfg, db, args.course, model=args.model,
                       conversation_id=args.session)


if __name__ == "__main__":
    import sys
    sys.exit(main())
