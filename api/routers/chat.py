"""Real chat SSE — streams run_turn with tool_start/tool_end/token/done.

run_turn is synchronous (blocking httpx to the LLM endpoint), so it runs in a worker
thread; events flow through an asyncio.Queue into the SSE response.
"""

from __future__ import annotations

import asyncio
import errno
import hashlib
import json
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
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
            _reasoning_cache[key] = m.get("reasoning") or m.get("reasoning_content")  # type: ignore[assignment]
            return


class ViewContext(BaseModel):
    """What the user has open in the app, as the client reports it.

    Identity and position only — ids and a page number. The server resolves
    the path, title, deadline and status from the database, so a stale or
    wrong client cannot put invented values in front of the model, and an id
    that does not resolve yields no block rather than a guess. See agent/view.py.
    """

    kind: str                            # "content" | "assignment"
    course_id: int | None = None
    file_id: int | None = None
    assignment_id: int | None = None
    page: int | None = None
    page_count: int | None = None


class ChatRequest(BaseModel):
    message: str
    course_id: int | None = None
    history: list[dict[str, Any]] = []
    session_id: int | None = None  # optional server-side persistence
    # Frontend's stable per-conversation id (local UUID). Forwarded as the
    # upstream x-session-id for gateway session affinity — never persisted.
    client_session_id: str | None = None
    model: str | None = None  # LLM model override (default = config)
    branch: str | None = None  # user-node id that starts this turn (fork key)
    attachments: list[str] = []
    # What the user is looking at, so "explain this" can resolve. Per-turn
    # context only: never persisted with the message.
    view: ViewContext | None = None


def _safe_name(name: str) -> str:
    """A filesystem-safe basename for a user-supplied filename.

    Path components are stripped (so `../../x` cannot escape uploads/) and
    anything outside [A-Za-z0-9._-] becomes `_`. The uuid prefix on the stored
    name is what guarantees uniqueness; this only keeps the name readable and
    inert.
    """
    base = Path(name or "attachment").name
    cleaned = "".join(c if c.isalnum() or c in "._-" else "_" for c in base)
    return (cleaned or "attachment")[:120]


@router.post("/uploads")
async def upload_attachment(course_id: int = Query(...), file: UploadFile = File(...)):
    """Store one chat attachment as a real file in the course workspace.

    Nothing is extracted: bytes land in `<course>/uploads/` and the turn's
    prompt carries a path manifest, so the agent reads the file on demand
    (extract_file, or shell/file tools). Images are still served inline by
    GET /chat/uploads/{id}. Any format is accepted — the workspace, not this
    route, decides what is readable.
    """
    from api import services
    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    name = _safe_name(file.filename or "attachment")
    mime = (file.content_type or mimetypes.guess_type(name)[0]
            or "application/octet-stream").lower()
    attachment_id = uuid.uuid4().hex
    stored_name = f"{attachment_id}-{name}"

    def reader(n: int) -> bytes:
        # `.file` is the sync spooled temp file; a bounded chunk keeps memory
        # flat regardless of upload size.
        return file.file.read(min(n, 1024 * 1024))

    try:
        stored = await asyncio.to_thread(
            services.workspace_upload, course_id, f"uploads/{stored_name}", reader)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(413 if "too large" in str(e) else 400, str(e))
    except OSError as e:
        if e.errno == errno.ENOSPC:
            raise HTTPException(507, "not enough disk space")
        raise HTTPException(500, str(e))
    finally:
        await file.close()

    course = services.get_course(course_id) or {}
    # Data-root-relative path — the same form extract_file() and the workspace
    # browser use, so the manifest line is directly callable.
    rel = (f"{course.get('term', '')}/"
           f"{str(course.get('code', '')).replace(' ', '')}/uploads/{stored_name}")
    db = DB(cfg.db_path)
    try:
        db.conn.execute(
            "INSERT INTO chat_attachments (id, original_name, mime_type, stored_path, size, sha256) "
            "VALUES (?,?,?,?,?,?)",
            (attachment_id, name, mime, rel, stored["size"], stored["sha256"]),
        )
        db.conn.commit()
    finally:
        db.close()
    return {"id": attachment_id, "name": name, "mime": mime,
            "size": stored["size"], "path": rel}


@router.get("/uploads/{attachment_id}")
async def serve_attachment(attachment_id: str):
    """Serve one stored attachment — inline image previews in the chat UI."""
    try:
        uuid.UUID(attachment_id)
    except ValueError:
        raise HTTPException(400, "malformed attachment id")
    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute(
            "SELECT mime_type, stored_path, original_name FROM chat_attachments WHERE id = ?",
            (attachment_id,),
        ).fetchone()
    finally:
        db.close()
    if row is None:
        raise HTTPException(404, "attachment not found")
    mime, stored_path, original_name = row[0], row[1], row[2]
    from api import services
    # New rows store a data-root-relative workspace path; rows written before
    # the unified-upload change stored an absolute path under data/chat_uploads.
    # Accept both so old inline images keep rendering.
    path = Path(stored_path)
    if not path.is_absolute():
        path = services.SCHOOL_ROOT / path
    if not path.is_file():
        raise HTTPException(404, "attachment file missing")
    return FileResponse(path, media_type=mime or "application/octet-stream", filename=original_name)


def _load_attachments(db, cfg, ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    clean = list(dict.fromkeys(ids))[:8]
    # One static query per id (no dynamic IN-list): keeps the SQL string
    # constant so caller-controlled ids only ever ride as bound parameters.
    rows = []
    for aid in clean:
        row = db.conn.execute(
            "SELECT id, original_name, mime_type, size, stored_path AS path "
            "FROM chat_attachments WHERE id = ?",
            (aid,),
        ).fetchone()
        if row is not None:
            rows.append(row)
    found = {r["id"] for r in rows}
    if found != set(clean):
        raise HTTPException(404, "One or more attachments were not found")
    return [dict(r) for r in rows]


@router.get("/sessions")
def list_sessions(course_id: int | None = None):
    """Session list with full trees (the client restores chats from this)."""
    from sync.db import DB
    from sync.config import Config
    import hashlib
    import json
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        if course_id:
            rows = db.conn.execute(
                "SELECT id, course_id, title, nodes_json, model, updated_at FROM chat_sessions WHERE course_id=? ORDER BY updated_at DESC",
                (course_id,)).fetchall()
        else:
            rows = db.conn.execute(
                "SELECT id, course_id, title, nodes_json, model, updated_at FROM chat_sessions ORDER BY updated_at DESC").fetchall()
        out = []
        seen: dict = {}
        for r in rows:
            tree = {}
            if r["nodes_json"]:
                try:
                    tree = json.loads(r["nodes_json"])
                except json.JSONDecodeError:
                    tree = {}
            # Collapse BYTE-IDENTICAL duplicates. An older client re-created the
            # same chat on every load whenever its local session had lost its
            # serverId, so one conversation accumulated ten identical rows and
            # every device listed all ten. Rows arrive updated_at DESC, so the
            # first of each group is the newest and wins. The duplicate ROWS are
            # left in place — this only stops them being listed; nothing is
            # deleted, and PUT/GET by id still work for a client holding one.
            digest = hashlib.md5((r["nodes_json"] or "").encode()).hexdigest()
            key = (r["course_id"], r["title"], digest)
            if key in seen:
                continue
            seen[key] = len(out)
            out.append({
                "id": r["id"], "courseId": r["course_id"], "title": r["title"],
                "model": r["model"],
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
    model: str | None = None
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
        # `course_id` is a REAL foreign key (PRAGMA foreign_keys = ON), so an
        # unknown id raises IntegrityError and the client gets a 500 — and a
        # chat that cannot create its server session stays local-only forever
        # and never syncs to another device. Two cases to handle:
        #   0    — the client's sentinel for "no course" (it maps a NULL
        #          course_id to 0), which must become NULL, the schema's
        #          documented general marker.
        #   junk — a course the client still has cached but that no longer
        #          exists (a deleted course). Reject it clearly rather than
        #          crashing, so the client can clear its stale state.
        course_id = body.course_id
        if course_id == 0:
            course_id = None
        if course_id is not None:
            if not db.conn.execute("SELECT 1 FROM courses WHERE id=?",
                                   (course_id,)).fetchone():
                raise HTTPException(
                    400, f"unknown course_id {course_id} — refresh the course list")
        cur = db.conn.execute(
            "INSERT INTO chat_sessions (course_id, title, nodes_json) VALUES (?,?,?)",
            (course_id, body.title, "{}"))
        db.conn.commit()
        sid = cur.lastrowid
        row = db.conn.execute(
            "SELECT id, course_id, title, model, updated_at FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        return {"id": row["id"], "courseId": row["course_id"], "title": row["title"],
                "model": row["model"],
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
            "SELECT id, course_id, title, nodes_json, model, updated_at FROM chat_sessions WHERE id=?",
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
                "model": row["model"],
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
        # One static statement — no SQL is built from strings. The CASE flags
        # carry the "was this field present?" decision that model_fields_set
        # makes, so an omitted field leaves its column untouched while an
        # explicitly-sent null still clears `model` (COALESCE alone could not
        # distinguish the two).
        write_nodes = "nodes" in body.model_fields_set and body.nodes is not None
        write_model = "model" in body.model_fields_set
        ts = body.updatedAt / 1000 if body.updatedAt else None
        db.conn.execute(
            "UPDATE chat_sessions SET "
            "  title = COALESCE(?, title), "
            "  nodes_json = CASE WHEN ? THEN ? ELSE nodes_json END, "
            "  model = CASE WHEN ? THEN ? ELSE model END, "
            "  updated_at = CASE WHEN ? THEN datetime(?, 'unixepoch') ELSE datetime('now') END "
            "WHERE id=?",
            (body.title,
             int(write_nodes),
             json.dumps({"nodes": body.nodes, "activeNodeId": body.activeNodeId},
                        default=str) if write_nodes else None,
             int(write_model),
             body.model,
             int(ts is not None),
             ts,
             sid))
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


class PinnedBody(BaseModel):
    pinned: list[str] = []


@router.get("/pinned")
def get_pinned():
    """Pinned model names (single local user) — persisted server-side so they
    survive across devices."""
    from sync.db import DB
    from sync.config import Config

    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute(
            "SELECT pinned FROM chat_prefs WHERE id=1").fetchone()
        if not row:
            return {"pinned": []}
        try:
            return {"pinned": json.loads(row["pinned"]) if row["pinned"] else []}
        except (json.JSONDecodeError, TypeError):
            return {"pinned": []}
    finally:
        db.close()


@router.put("/pinned")
def put_pinned(body: PinnedBody):
    from sync.db import DB
    from sync.config import Config

    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        db.conn.execute(
            "INSERT INTO chat_prefs (id, pinned) VALUES (1, ?) "
            "ON CONFLICT(id) DO UPDATE SET pinned=excluded.pinned",
            (json.dumps(list(body.pinned)),))
        db.conn.commit()
        return {"pinned": body.pinned}
    finally:
        db.close()


@router.get("/models")
def list_models():
    """LLM model list for the UI model selector (OpenAI-compatible /models).

    Tries each configured endpoint in cfg.llm_endpoints() order and returns
    the first that answers; this supports both a single llm_url and a
    failover llm_urls list. Falls back to an empty list (with the error) if
    no endpoint is reachable.
    """
    from sync.config import Config
    from agent.chat import llm_headers
    import httpx

    cfg = Config.load()
    endpoints = cfg.llm_endpoints()
    last_err: str | None = None
    for url in endpoints:
        try:
            r = httpx.get(f"{url}/models", headers=llm_headers(cfg), timeout=15)
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
            last_err = str(e)
    return {"models": [], "error": last_err or "no LLM endpoint configured"}


def _do_turn(req: ChatRequest, emit) -> None:
    """Blocking run_turn + optional persistence. Runs in a worker thread."""
    from agent.chat import run_turn, sanitize_session_id
    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    db = DB(cfg.db_path)
    # Reasoning cache keyed per branch (the user node that starts the turn)
    # so forks never cross-contaminate chain-of-thought passback.
    key: tuple = (req.session_id or req.course_id, req.branch or "")
    try:
        history = _inject_reasoning(req.history, key)
        attachments = _load_attachments(db, cfg, req.attachments)
        try:
            from agent.chat import load_turn_digest
            prior = load_turn_digest(db, req.session_id)
        except Exception:
            prior = ""
        # Stable per-conversation identity for upstream session affinity:
        # prefer the client's own id, else the server session, else run_turn
        # mints one fresh id for the turn (intra-turn stable only).
        conversation_id = sanitize_session_id(req.client_session_id)
        if conversation_id is None and req.session_id is not None:
            conversation_id = f"campus-chat-{req.session_id}"
        answer, full_history = run_turn(cfg, db, req.message, course_id=req.course_id,
                                        model=req.model, history=history,
                                        verbose=False, emit=emit, attachments=attachments,
                                        conversation_id=conversation_id,
                                        prior_context=prior,
                                        view=req.view.model_dump() if req.view else None)
        _store_reasoning(full_history, key)
        if req.session_id:
            try:
                from agent.chat import store_turn_digest
                items: list = []
                for idx, m in enumerate(full_history):
                    tcs = m.get("tool_calls") if isinstance(m, dict) else None
                    if not tcs:
                        continue
                    res_content = ""
                    nxt = full_history[idx + 1] if idx + 1 < len(full_history) else None
                    if isinstance(nxt, dict) and nxt.get("role") == "tool":
                        res_content = str(nxt.get("content") or "")
                    for tc in tcs:
                        fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                        if not isinstance(fn, dict):
                            fn = {}
                        items.append({"tool": fn.get("name", ""),
                                      "args": fn.get("arguments", {}), "result": res_content})
                        if len(items) >= 8:
                            break
                    if len(items) >= 8:
                        break
                store_turn_digest(db, req.session_id, items[:8])
            except Exception as e:
                print(f"  [chat] turn-digest store failed (turn continues): {e!r}", flush=True)
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
            # First-exchange title from the turn's own model (the first
            # message's model) — never fails the turn, never overwrites a
            # later rename (generation runs once, on the first exchange).
            try:
                from agent.chat import generate_session_title
                title = generate_session_title(db, cfg, req.session_id, req.model,
                                               req.message, answer)
                if title:
                    emit("title", {"title": title})
            except Exception as e:
                print(f"  [chat] title generation failed (turn continues): {e!r}", flush=True)
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
