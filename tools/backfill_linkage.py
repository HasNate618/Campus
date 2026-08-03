#!/usr/bin/env python3
"""Backfill content_node_id for files the sync never linked.

The current sync only links files it downloads via file topics; HTML-topic
files saved by the July sync version are orphaned rows. They're matched by
decoding the filename (%20 etc), stripping the extension, and matching the
content node title (normalized).
"""
import re
import sqlite3
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sync.config import Config
from sync.db import DB


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def main() -> int:
    cfg = Config.load()
    db = DB(cfg.db_path)
    # modules by normalized title -> id
    modules = {norm(r["title"]): r["id"] for r in db.conn.execute(
        "SELECT id, title FROM content_nodes WHERE node_type='module'").fetchall()}
    # topics by parent module: list of (norm_title, id)
    topic_list: dict[int, list[tuple[str, int]]] = {}
    for r in db.conn.execute(
            "SELECT id, parent_id, title FROM content_nodes WHERE node_type='topic'").fetchall():
        topic_list.setdefault(r["parent_id"], []).append((norm(r["title"]), r["id"]))
    rows = db.conn.execute(
        "SELECT id, path FROM files WHERE content_node_id IS NULL").fetchall()
    linked = 0
    for r in rows:
        p = Path(r["path"])
        name = urllib.parse.unquote(p.name)
        stem = Path(name).stem
        sn = norm(stem)
        nid = None
        # module-scoped: parent dir -> module -> topic whose title is a PREFIX
        # of the filename stem (filenames carry the unit number: "Unit
        # Introduction2.html" is module 2's "Unit Introduction" topic)
        if len(p.parts) >= 2:
            module_id = modules.get(norm(p.parts[-2]))
            if module_id:
                matches = [tid for tn, tid in topic_list.get(module_id, [])
                           if len(tn) >= 5 and sn.startswith(tn)]
                if len(matches) == 1:
                    nid = matches[0]
        # fallback: global prefix match
        if nid is None:
            g = [tid for tns in topic_list.values() for tn, tid in tns
                 if len(tn) >= 5 and sn.startswith(tn)]
            if len(g) == 1:
                nid = g[0]
        if nid:
            db.conn.execute("UPDATE files SET content_node_id=? WHERE id=?", (nid, r["id"]))
            linked += 1
            print(f"  linked: {name} -> node {nid}")
        else:
            print(f"  NO MATCH: {name}")
    db.conn.commit()
    left = db.conn.execute(
        "SELECT COUNT(*) n FROM files WHERE content_node_id IS NULL").fetchone()["n"]
    print(f"linked {linked}; {left} still unlinked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
