#!/usr/bin/env python3
"""Remove URL-encoded duplicate file rows.

The July-era sync saved files under their raw %20-encoded names; the current
sync saves decoded names. Both rows point at byte-identical content, and the
encoded twin can carry a stale/mislinked content_node_id (e.g. Unit 1's
'Lecture%20Slides.html' linked to Unit 6's topic). Strategy: for every row
whose path contains '%', look for a decoded twin (urllib.parse.unquote) with
the same content hash; if found, delete the encoded row.
"""
import sqlite3
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sync.config import Config
from sync.db import DB


def main() -> int:
    cfg = Config.load()
    db = DB(cfg.db_path)
    rows = db.conn.execute(
        "SELECT id, path, sha256 FROM files WHERE instr(path, '%') > 0").fetchall()
    deleted = 0
    for r in rows:
        decoded = urllib.parse.unquote(r["path"])
        twin = db.conn.execute(
            "SELECT id, sha256 FROM files WHERE path=? AND id<>?",
            (decoded, r["id"])).fetchone()
        if twin and twin["sha256"] == r["sha256"]:
            db.conn.execute("DELETE FROM files WHERE id=?", (r["id"],))
            deleted += 1
            print(f"  deleted {r['id']} (encoded twin of {twin['id']}): {r['path'][-50:]}")
        else:
            print(f"  keep   {r['id']} (no matching decoded twin): {r['path'][-50:]}")
    db.conn.commit()
    left = db.conn.execute("SELECT COUNT(*) n FROM files").fetchone()["n"]
    mislinks = db.conn.execute(
        """SELECT COUNT(*) n FROM files f JOIN content_nodes cn ON cn.id=f.content_node_id
           WHERE instr(f.path, '%') > 0""").fetchone()["n"]
    print(f"deleted {deleted}; {left} files remain; {mislinks} encoded rows still linked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
