#!/usr/bin/env python3
"""One-off migration: notes table -> {course}/notes/*.md files.

Per the build plan: prose belongs in the workspace, not the DB. Run once,
then the notes table is dropped from the live DB (schema.sql already updated).
"""
import re
import sys
from pathlib import Path

from sync.config import Config
from sync.db import DB


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:60] or "note"


def main() -> int:
    cfg = Config.load()
    db = DB(cfg.db_path)
    rows = db.conn.execute(
        """SELECT n.id, n.course_id, n.title, n.body_md, n.created_at, c.code, c.term
           FROM notes n LEFT JOIN courses c ON c.id = n.course_id ORDER BY n.id"""
    ).fetchall()
    if not rows:
        print("notes table already empty")
        return 0
    for r in rows:
        if not r["code"]:
            print(f"  skip note {r['id']} (no course): {r['title']}")
            continue
        d = Path(cfg.data_root) / r["term"] / r["code"].replace(" ", "") / "notes"
        d.mkdir(parents=True, exist_ok=True)
        date = (r["created_at"] or "2026-01-01")[:10]
        path = d / f"{date}-{slugify(r['title'])}.md"
        path.write_text(r["body_md"] or "")
        print(f"  {r['id']}: {path}")
    n = db.conn.execute("SELECT COUNT(*) n FROM notes").fetchone()["n"]
    print(f"migrated; {n} rows remain")
    return 0


if __name__ == "__main__":
    sys.exit(main())
