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
import time
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
    # Node ids the client already minted for this turn. The server writes the
    # user message and the reply under these ids, so the turn survives a broken
    # stream, a closed tab, or a save that never fired — and the client's own
    # later save is an UPDATE of these rows rather than a second copy.
    user_node_id: str | None = None
    assistant_node_id: str | None = None
    parent_node_id: str | None = None
    attachments: list[str] = []
    # What the user is looking at, so "explain this" can resolve. Per-turn
    # context only: never persisted with the message.
    view: ViewContext | None = None


def _safe_name(name: str) -> str:
    """A filesystem-safe basename for a user-supplied filename.

    Path components are stripped (so `../../x` cannot escape uploads/) and
    anything outside [A-Za-z0-9._-] becomes `_`. Uniqueness is NOT handled
    here — see services.unique_upload_name, which suffixes only on a collision.
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
    course = services.get_course(course_id) or {}
    name = _safe_name(file.filename or "attachment")
    mime = (file.content_type or mimetypes.guess_type(name)[0]
            or "application/octet-stream").lower()
    attachment_id = uuid.uuid4().hex
    stored_name = services.unique_upload_name(course, name)

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


def _session_attachment_files(db, session_id: int) -> list[dict[str, Any]]:
    """Files attached anywhere earlier in this conversation.

    The attachment manifest used to describe only the CURRENT turn, so on the
    next question the model had no idea the file existed. It answered "the
    assignment PDF has no attachment in my harness records" about a PDF sitting
    in the course workspace, having gone looking in Brightspace records instead.
    The user re-uploaded it and got the same answer, because a re-upload adds a
    new turn whose earlier context is again invisible.

    Name/mime/size/path are stored on the user node, so this needs no extra
    lookup: it reads the tree the session already has.
    """
    out: list[dict[str, Any]] = []
    seen: set = set()
    try:
        rows = db.conn.execute(
            "SELECT data_json FROM chat_nodes WHERE session_id=? AND role='user' "
            "ORDER BY position DESC LIMIT 40", (session_id,)).fetchall()
    except Exception:
        return out
    import json as _json
    for r in rows:
        try:
            data = _json.loads(r[0]) if r[0] else {}
        except _json.JSONDecodeError:
            continue
        for a in (data.get("attachments") or []) if isinstance(data, dict) else []:
            if not isinstance(a, dict):
                continue
            path = a.get("path")
            if not path or path in seen:
                continue
            seen.add(path)
            out.append({
                "id": a.get("id"),
                "original_name": a.get("name") or a.get("original_name") or "file",
                "mime_type": a.get("mime") or a.get("mime_type") or "?",
                "size": a.get("size", "?"),
                "path": path,
                "earlier": True,
            })
    return out


@router.get("/sessions")
def list_sessions(course_id: int | None = None):
    """Session list with full trees (the client restores chats from this)."""
    from sync.db import DB
    from sync.config import Config
    from api import chat_nodes
    import hashlib
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
            # Nodes are rows now; load_tree falls back to the old blob for any
            # session the migration has not reached.
            tree = chat_nodes.load_tree(db, r["id"])
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
    # Node ids the client deliberately dropped (edit-and-resend prunes the old
    # descendants). Opt-in on purpose: a save that names no deletions can never
    # shrink a tree, which is how a stale device used to destroy newer turns.
    deletedNodeIds: list[str] | None = None


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
    from api import chat_nodes
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute(
            "SELECT id, course_id, title, model, updated_at FROM chat_sessions WHERE id=?",
            (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        tree = chat_nodes.load_tree(db, sid)
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
    from api import chat_nodes
    cfg = Config.load()
    db = DB(cfg.db_path)
    try:
        row = db.conn.execute("SELECT id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            raise HTTPException(404, "session not found")
        write_model = "model" in body.model_fields_set
        ts = body.updatedAt / 1000 if body.updatedAt else None
        # Session columns first: save_nodes rebuilds the compatibility snapshot
        # from the rows and reads active_node_id while doing it, so that value
        # has to be current before the nodes land.
        db.conn.execute(
            "UPDATE chat_sessions SET "
            "  title = COALESCE(?, title), "
            "  active_node_id = CASE WHEN ? THEN ? ELSE active_node_id END, "
            "  model = CASE WHEN ? THEN ? ELSE model END, "
            "  updated_at = CASE WHEN ? THEN datetime(?, 'unixepoch') ELSE datetime('now') END "
            "WHERE id=?",
            (body.title,
             int("activeNodeId" in body.model_fields_set),
             body.activeNodeId,
             int(write_model),
             body.model,
             int(ts is not None),
             ts,
             sid))
        db.conn.commit()
        # A save is a per-node UPSERT, never a tree replace. The old statement
        # was `nodes_json = <whatever the client sent>`, so a device holding a
        # stale copy silently overwrote turns another device had written; the
        # nodes it named were fine, the ones it had never seen were gone. Now
        # the only way to remove a node is to name it in deletedNodeIds.
        write_nodes = "nodes" in body.model_fields_set and body.nodes is not None
        counts = {"added": 0, "updated": 0, "removed": 0, "total": 0}
        if write_nodes or body.deletedNodeIds:
            counts = chat_nodes.save_nodes(
                db, sid, body.nodes if write_nodes else None, body.deletedNodeIds)
        return {"ok": True, "id": sid, **counts}
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
        # Carry forward files attached earlier in this same conversation: the
        # model should not have to be re-told, and a follow-up question ("walk me
        # through 1.2") arrived with no manifest at all.
        if req.session_id:
            known = {a.get("path") for a in attachments}
            for extra in _session_attachment_files(db, req.session_id):
                if extra.get("path") not in known:
                    attachments.append(extra)
                    known.add(extra.get("path"))
        # The question is stored BEFORE the model runs. It used to be written only
        # after the answer completed, so reloading the page mid-answer lost the
        # question as well: the server had nothing, and the browser's own save is
        # debounced behind the token stream (each token re-arms the timer, so it
        # never fires while an answer is arriving).
        if req.session_id and req.user_node_id:
            try:
                from api import chat_nodes
                chat_nodes.save_nodes(db, req.session_id, [{
                    "id": req.user_node_id,
                    "parentId": req.parent_node_id,
                    "role": "user",
                    "content": req.message,
                    "children": [req.assistant_node_id] if req.assistant_node_id else [],
                    "createdAt": int(time.time() * 1000),
                }])
                chat_nodes.set_active_node(db, req.session_id, req.user_node_id)
            except Exception as e:
                print(f"  [chat] early turn store failed (turn continues): {e!r}", flush=True)
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
        # Steering: what the user typed while this turn was already streaming.
        # The queue is drained by run_turn at a step boundary, so the next model
        # call sees it; each drained text is echoed to the client so the UI can
        # mark it delivered, and attached to the answer node so a reload shows it.
        steered: list[str] = []

        def _drain_steering() -> list[str]:
            if not req.session_id:
                return []
            pending = _STEERING.pop(req.session_id, [])
            for t in pending:
                steered.append(t)
                try:
                    emit("steering", {"text": t})
                except Exception:
                    pass
            return pending

        answer, full_history = run_turn(cfg, db, req.message, course_id=req.course_id,
                                        model=req.model, history=history,
                                        verbose=False, emit=emit, attachments=attachments,
                                        conversation_id=conversation_id,
                                        prior_context=prior,
                                        view=req.view.model_dump() if req.view else None,
                                        steering=_drain_steering)
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
            # The tree is written here, by the server, not only by the browser.
            # Until now `nodes_json` was entirely client-owned: if the stream
            # broke mid-turn, the tab closed, or the debounced save never fired,
            # the answer existed in chat_messages and nowhere the UI could read
            # it — the turn was simply missing from the conversation. Same ids
            # the client minted, so its later save updates these rows.
            try:
                from api import chat_nodes
                now_ms = int(time.time() * 1000)
                if req.user_node_id:
                    chat_nodes.save_nodes(db, req.session_id, [{
                        "id": req.user_node_id,
                        "parentId": req.parent_node_id,
                        "role": "user",
                        "content": req.message,
                        "children": [req.assistant_node_id] if req.assistant_node_id else [],
                        "createdAt": now_ms,
                    }])
                if req.assistant_node_id:
                    row = {
                        "id": req.assistant_node_id,
                        "parentId": req.user_node_id,
                        "role": "assistant",
                        "content": answer,
                        "children": [],
                        "createdAt": now_ms,
                    }
                    if steered:
                        row["steering"] = steered
                    chat_nodes.save_nodes(db, req.session_id, [row])
                    chat_nodes.set_active_node(db, req.session_id, req.assistant_node_id)
            except Exception as e:
                print(f"  [chat] node store failed (turn continues): {e!r}", flush=True)
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


# Steering: a message typed while a turn is already streaming. Keyed by session
# (there is one in-flight turn per conversation) and drained by that turn at a
# step boundary. Deliberately in memory — a steer whose turn has already ended
# has nowhere to go — and the text is persisted onto the answer node once it has
# actually been consumed, so a reload still shows what was said.
_STEERING: dict[int, list[str]] = {}


class SteerRequest(BaseModel):
    session_id: int
    text: str = ""


@router.post("/steer")
def steer(req: SteerRequest) -> dict:
    """Queue a message for the turn that is currently running."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty steering message")
    queue = _STEERING.setdefault(req.session_id, [])
    if len(queue) >= 20:
        raise HTTPException(status_code=429, detail="too many pending steering messages")
    queue.append(text[:4000])
    return {"ok": True, "queued": len(queue)}


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
