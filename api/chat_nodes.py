"""Per-node chat storage.

A conversation used to be one JSON blob per session (`chat_sessions.nodes_json`)
replaced wholesale on every client save. Two devices therefore fought over a
single value, and the loser's turns were destroyed silently: a phone holding an
18-node cache would PUT it over the server's 25-node tree, and the seven newer
messages were simply gone. Nothing logged it, because from the server's side
that was a perfectly valid save.

Nodes are rows now. A save upserts exactly the nodes it names, so it can only
ADD or UPDATE, never shrink. Anything another device wrote survives untouched.
Removal happens only for ids the client explicitly lists in `deletedNodeIds` —
that path exists because editing a message and re-sending legitimately drops the
old descendants, and it stays opt-in so no stale save can prune by accident.

`nodes_json` is still written, as a snapshot rebuilt from the rows, so that a
rollback or an older client still reads a coherent tree.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

# UI state that must never round-trip through the database: a node frozen as
# `streaming` would come back with a spinner stuck on it forever.
_UI_ONLY = ("streaming", "open")

# An assistant message only ever grows while it streams; a SHORTER replacement is
# a truncated or errored copy, not an edit (regenerating mints a new node id).
# Refusing it is what stops a broken stream's "⚠ Stream failed" notice from
# overwriting the complete answer the server had already stored under that id.
_UPSERT = """
INSERT INTO chat_nodes
    (session_id, id, parent_id, role, content, position, data_json, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id, id) DO UPDATE SET
    parent_id  = excluded.parent_id,
    role       = excluded.role,
    content    = CASE
                   WHEN chat_nodes.role = 'assistant'
                        AND length(excluded.content) < length(chat_nodes.content)
                   THEN chat_nodes.content
                   ELSE excluded.content
                 END,
    position   = excluded.position,
    data_json  = excluded.data_json,
    updated_at = excluded.updated_at
"""


def _iso_from_ms(value) -> str | None:
    """Client node timestamps are epoch milliseconds; store ISO UTC text."""
    try:
        ms = float(value)
    except (TypeError, ValueError):
        return None
    if ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return None


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _row_for(session_id: int, node: dict, position: int) -> tuple | None:
    nid = str(node.get("id") or "").strip()
    if not nid:
        return None
    role = str(node.get("role") or "user")
    content = node.get("content")
    content = "" if content is None else str(content)
    # `children` is kept: it is the client's sibling ORDER, which position alone
    # cannot reproduce across partial saves.
    data = {k: v for k, v in node.items()
            if k not in _UI_ONLY and k not in ("id", "parentId", "role", "content")}
    created = _iso_from_ms(node.get("createdAt")) or _now()
    return (session_id, nid, node.get("parentId"), role, content, position,
            json.dumps(data, default=str) if data else None, created, _now())


def _insert_rows(db, session_id: int, nodes: list[dict] | None) -> tuple[int, int]:
    """Upsert nodes; returns (added, updated). No commit, no snapshot."""
    existing = {r[0] for r in db.conn.execute(
        "SELECT id FROM chat_nodes WHERE session_id=?", (session_id,))}
    added = updated = 0
    for idx, node in enumerate(nodes or []):
        if not isinstance(node, dict):
            continue
        row = _row_for(session_id, node, idx)
        if row is None:
            continue
        db.conn.execute(_UPSERT, row)
        if str(node.get("id")) in existing:
            updated += 1
        else:
            added += 1
            existing.add(str(node.get("id")))
    return added, updated


def save_nodes(db, session_id: int, nodes: list[dict] | None,
               deleted_ids: list[str] | None = None) -> dict:
    """Upsert the given nodes; delete only the ids explicitly named.

    Returns counts so the caller (and the tests) can assert that a save added
    nodes without removing anything it did not mention.
    """
    # A session the migration has not reached still holds its whole tree in the
    # old blob. Adopt it before writing, otherwise this save's snapshot would be
    # built from the new nodes alone and the existing conversation would vanish
    # from the tree — the very failure this module exists to prevent.
    have = db.conn.execute(
        "SELECT COUNT(*) FROM chat_nodes WHERE session_id=?", (session_id,)).fetchone()[0]
    if not have:
        legacy = _legacy_tree(db, session_id)
        _insert_rows(db, session_id, legacy.get("nodes") or [])
        # Carry the open branch across too; otherwise the first save of an
        # adopted session reloads it on a different branch than the user left.
        if legacy.get("activeNodeId") and not active_node_id(db, session_id):
            set_active_node(db, session_id, legacy["activeNodeId"])
    added, updated = _insert_rows(db, session_id, nodes)
    removed = 0
    for nid in deleted_ids or []:
        nid = str(nid or "").strip()
        if not nid:
            continue
        cur = db.conn.execute(
            "DELETE FROM chat_nodes WHERE session_id=? AND id=?", (session_id, nid))
        removed += cur.rowcount
    db.conn.commit()
    write_snapshot(db, session_id)
    total = db.conn.execute(
        "SELECT COUNT(*) FROM chat_nodes WHERE session_id=?", (session_id,)).fetchone()[0]
    return {"added": added, "updated": updated, "removed": removed, "total": total}


def load_nodes(db, session_id: int) -> list[dict]:
    """Assemble the node list, rebuilding each parent's `children` order."""
    rows = db.conn.execute(
        "SELECT id, parent_id, role, content, position, data_json, created_at "
        "FROM chat_nodes WHERE session_id=? ORDER BY position, rowid",
        (session_id,)).fetchall()
    if not rows:
        return []
    nodes: dict[str, dict] = {}
    order: list[str] = []
    stated: dict[str, list[str]] = {}
    for r in rows:
        try:
            data = json.loads(r["data_json"]) if r["data_json"] else {}
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        kids = data.pop("children", None)
        stated[r["id"]] = [str(k) for k in kids] if isinstance(kids, list) else []
        for flag in _UI_ONLY:
            data.pop(flag, None)
        data.update({"id": r["id"], "parentId": r["parent_id"],
                     "role": r["role"], "content": r["content"]})
        nodes[r["id"]] = data
        order.append(r["id"])
    # A child list is authoritative where the writer supplied one; anything it
    # did not mention is appended in stored order so a partial save cannot drop
    # a branch from the tree it renders.
    children: dict[str, list[str]] = {nid: [] for nid in nodes}
    for nid in order:
        parent = nodes[nid].get("parentId")
        if parent in children:
            children[parent].append(nid)
    for nid in order:
        final: list[str] = []
        for kid in stated.get(nid, []):
            if kid in nodes and nodes[kid].get("parentId") == nid and kid not in final:
                final.append(kid)
        for kid in children[nid]:
            if kid not in final:
                final.append(kid)
        nodes[nid]["children"] = final
    return [nodes[nid] for nid in order]


def active_node_id(db, session_id: int) -> str | None:
    row = db.conn.execute(
        "SELECT active_node_id FROM chat_sessions WHERE id=?", (session_id,)).fetchone()
    return row[0] if row else None


def _legacy_tree(db, session_id: int) -> dict:
    row = db.conn.execute(
        "SELECT nodes_json FROM chat_sessions WHERE id=?", (session_id,)).fetchone()
    if not row or not row[0]:
        return {}
    try:
        tree = json.loads(row[0])
    except json.JSONDecodeError:
        return {}
    return tree if isinstance(tree, dict) else {}


def _repoint_citations(db, session_id: int, nodes: list[dict]) -> None:
    """Point each citation's fileId at the PDF a .md ref now has, on read.

    A citation to an extracted deck keeps the file id it was minted with. When the
    deck later gains a real PDF (generated from the .pptx), that id points at
    markdown and the chip's "p.12" opens a file with no pages. Repairing the stored
    rows is not enough on its own: a browser holding the old copy saves it back and
    undoes the repair. Doing it on read makes the server the authority, whatever the
    client believes.
    """
    try:
        from agent.citations import _pdf_file_id
        row = db.conn.execute("SELECT course_id FROM chat_sessions WHERE id=?",
                              (session_id,)).fetchone()
        course_id = row[0] if row else None
        cache: dict[str, int | None] = {}
        for n in nodes:
            cites = n.get("citations")
            if not isinstance(cites, list) or not cites:
                continue
            for c in cites:
                if not isinstance(c, dict):
                    continue
                ref = c.get("ref") or ""
                if not ref.lower().endswith(".md"):
                    continue
                if ref not in cache:
                    cache[ref] = _pdf_file_id(db, course_id, ref)
                pdf_id = cache[ref]
                if pdf_id and pdf_id != c.get("fileId"):
                    c["fileId"] = pdf_id
    except Exception:
        pass  # a citation's target must never break loading a conversation


def load_tree(db, session_id: int) -> dict:
    """The tree the client renders. Falls back to the old blob for a session the
    migration has not reached yet, so the API stays correct during a rollout."""
    nodes = load_nodes(db, session_id)
    if nodes:
        _repoint_citations(db, session_id, nodes)
        return {"nodes": nodes, "activeNodeId": active_node_id(db, session_id)}
    tree = _legacy_tree(db, session_id)
    legacy_nodes = tree.get("nodes", [])
    _repoint_citations(db, session_id, legacy_nodes)
    return {"nodes": legacy_nodes, "activeNodeId": tree.get("activeNodeId")}


def write_snapshot(db, session_id: int) -> None:
    """Refresh the compatibility blob from the rows.

    Writes even when the row set is EMPTY: an empty snapshot is a real state
    (every node was explicitly deleted), and skipping it would leave the old
    blob in place for load_tree's fallback to resurrect. Callers only reach here
    after save_nodes has adopted any legacy blob, so the rows are the truth.
    """
    nodes = load_nodes(db, session_id)
    db.conn.execute(
        "UPDATE chat_sessions SET nodes_json=? WHERE id=?",
        (json.dumps({"nodes": nodes, "activeNodeId": active_node_id(db, session_id)},
                    default=str), session_id))
    db.conn.commit()


def set_active_node(db, session_id: int, node_id: str | None) -> None:
    db.conn.execute("UPDATE chat_sessions SET active_node_id=? WHERE id=?",
                    (node_id, session_id))
    db.conn.commit()


def migrate_session(db, session_id: int) -> int:
    """Expand one session's blob into rows. No-op when rows already exist, so it
    is safe to re-run and safe to call on every boot."""
    have = db.conn.execute(
        "SELECT COUNT(*) FROM chat_nodes WHERE session_id=?", (session_id,)).fetchone()[0]
    if have:
        return 0
    tree = _legacy_tree(db, session_id)
    nodes = tree.get("nodes") or []
    if not nodes:
        return 0
    if tree.get("activeNodeId"):
        set_active_node(db, session_id, tree.get("activeNodeId"))
    # save_nodes adopts the blob itself when there are no rows; passing the
    # nodes again would only re-upsert them.
    res = save_nodes(db, session_id, None)
    return res["total"]


def migrate_all(db) -> dict:
    """Expand every legacy session. Returns {session_id: rows_created} for the
    sessions it touched, so a caller can report exactly what changed."""
    rows = db.conn.execute("SELECT id FROM chat_sessions ORDER BY id").fetchall()
    done = {}
    for r in rows:
        n = migrate_session(db, r[0])
        if n:
            done[r[0]] = n
    return done
