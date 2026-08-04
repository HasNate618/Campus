"""SQLite access layer for the sync engine — audited upserts only.

Sync writes: content_nodes, files, assignments, announcements, sync_runs,
courses.brightspace_org_unit_id. All other tables are read-only here
(AI/user writes go through the future API layer, also audited).
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"


class DB:
    def __init__(self, db_path: Path):
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")

    # ── courses ─────────────────────────────────────────────────────────
    def get_course_by_code(self, code: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM courses WHERE code = ?", (code,)
        ).fetchone()

    def get_pilot_courses(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM courses WHERE is_pilot = 1 AND is_active = 1"
        ).fetchall()

    def link_org_unit(self, course_id: int, org_unit_id: int) -> None:
        self.conn.execute(
            "UPDATE courses SET brightspace_org_unit_id = ?, updated_at = datetime('now') WHERE id = ?",
            (org_unit_id, course_id),
        )
        self.conn.commit()

    # ── content_nodes ───────────────────────────────────────────────────
    def upsert_content_node(self, course_id: int, node: dict) -> int:
        """node keys: brightspace_id, node_type, topic_type, title, description,
        url, due_at, is_hidden, is_locked, sort_order, parent_brightspace_id"""
        parent_id = None
        if node.get("parent_brightspace_id"):
            row = self.conn.execute(
                "SELECT id FROM content_nodes WHERE course_id=? AND brightspace_id=?",
                (course_id, node["parent_brightspace_id"]),
            ).fetchone()
            parent_id = row["id"] if row else None

        self.conn.execute(
            """INSERT INTO content_nodes
               (course_id, parent_id, brightspace_id, node_type, topic_type, title,
                description, url, due_at, is_hidden, is_locked, sort_order)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(course_id, brightspace_id) DO UPDATE SET
                 parent_id=excluded.parent_id, node_type=excluded.node_type,
                 topic_type=excluded.topic_type, title=excluded.title,
                 description=excluded.description, url=excluded.url,
                 due_at=excluded.due_at, is_hidden=excluded.is_hidden,
                 is_locked=excluded.is_locked, sort_order=excluded.sort_order,
                 updated_at=datetime('now')""",
            (course_id, parent_id, node["brightspace_id"], node["node_type"],
             node.get("topic_type"), node["title"], node.get("description"),
             node.get("url"), node.get("due_at"),
             int(node.get("is_hidden", False)), int(node.get("is_locked", False)),
             node.get("sort_order", 0)),
        )
        self.conn.commit()
        return self.conn.execute(
            "SELECT id FROM content_nodes WHERE course_id=? AND brightspace_id=?",
            (course_id, node["brightspace_id"]),
        ).fetchone()["id"]

    # ── files ───────────────────────────────────────────────────────────
    def upsert_file(self, course_id: int | None, path: str, kind: str,
                    source: str, sha256: str | None, size: int | None,
                    content_node_id: int | None = None) -> tuple[int, bool]:
        """Returns (file_id, is_new). path unique — sha256 changes = update."""
        existing = self.conn.execute(
            "SELECT id, sha256 FROM files WHERE path = ?", (path,)
        ).fetchone()
        if existing:
            self.conn.execute(
                """UPDATE files SET sha256=?, size=?, synced_at=datetime('now'),
                   processed=0, content_node_id=COALESCE(?, content_node_id)
                   WHERE id=?""",
                (sha256, size, content_node_id, existing["id"]),
            )
            self.conn.commit()
            return existing["id"], existing["sha256"] != sha256
        cur = self.conn.execute(
            """INSERT INTO files (course_id, path, kind, source, sha256, size, content_node_id, synced_at)
               VALUES (?,?,?,?,?,?,?,datetime('now'))""",
            (course_id, path, kind, source, sha256, size, content_node_id),
        )
        self.conn.commit()
        return cur.lastrowid, True

    def mark_processed(self, file_id: int) -> None:
        self.conn.execute("UPDATE files SET processed=1 WHERE id=?", (file_id,))
        self.conn.commit()

    def unprocessed_files(self, course_id: int | None = None) -> list[sqlite3.Row]:
        q = "SELECT * FROM files WHERE processed=0"
        if course_id:
            q += f" AND course_id={int(course_id)}"
        return self.conn.execute(q).fetchall()

    # ── announcements ───────────────────────────────────────────────────
    def upsert_announcement(self, course_id: int, ann: dict) -> bool:
        """Returns True if new (not previously seen)."""
        existing = self.conn.execute(
            "SELECT id FROM announcements WHERE brightspace_id=?",
            (ann["brightspace_id"],)).fetchone()
        if existing:
            self.conn.execute(
                """UPDATE announcements SET title=?, body=?, author=?,
                   posted_at=?, is_pinned=? WHERE id=?""",
                (ann["title"], ann.get("body", ""), ann.get("author"),
                 ann.get("posted_at"), int(ann.get("is_pinned", False)), existing["id"]))
            self.conn.commit()
            return False
        self.conn.execute(
            """INSERT INTO announcements (course_id, title, body, author, posted_at, is_pinned, brightspace_id)
               VALUES (?,?,?,?,?,?,?)""",
            (course_id, ann["title"], ann.get("body", ""), ann.get("author"),
             ann.get("posted_at"), int(ann.get("is_pinned", False)), ann["brightspace_id"]))
        self.conn.commit()
        return True

    # ── assignments ─────────────────────────────────────────────────────
    def upsert_assignment(self, course_id: int, a: dict) -> tuple[int, bool]:
        """a keys: title, description, due_at, weight, brightspace_folder_id, url,
        rubrics_json. Returns (id, is_new). Never clobbers user notes."""
        existing = self.conn.execute(
            "SELECT id FROM assignments WHERE course_id=? AND brightspace_folder_id=?",
            (course_id, a["brightspace_folder_id"]),
        ).fetchone()
        if existing:
            self.conn.execute(
                """UPDATE assignments SET title=?, description=?, due_at=?, weight=?,
                   url=?, rubrics_json=?,
                   status=CASE WHEN status='extended' THEN 'extended' ELSE 'open' END,
                   updated_at=datetime('now') WHERE id=?""",
                (a["title"], a.get("description"), a.get("due_at"), a.get("weight"),
                 a.get("url"), a.get("rubrics_json"), existing["id"]),
            )
            self.conn.commit()
            return existing["id"], False
        cur = self.conn.execute(
            """INSERT INTO assignments (course_id, title, description, due_at, weight,
               source, brightspace_folder_id, url, rubrics_json)
               VALUES (?,?,?,?,?,'brightspace',?,?,?)""",
            (course_id, a["title"], a.get("description"), a.get("due_at"),
             a.get("weight"), a["brightspace_folder_id"], a.get("url"), a.get("rubrics_json")),
        )
        self.conn.commit()
        return cur.lastrowid, True

    # ── sync_runs ───────────────────────────────────────────────────────
    def start_sync(self, trigger: str = "manual") -> int:
        cur = self.conn.execute(
            "INSERT INTO sync_runs (trigger) VALUES (?)", (trigger,)
        )
        self.conn.commit()
        return cur.lastrowid

    def finish_sync(self, run_id: int, status: str, **counts) -> None:
        cols = ", ".join(f"{k}=?" for k in counts)
        self.conn.execute(
            f"UPDATE sync_runs SET finished_at=datetime('now'), status=?, {cols} WHERE id=?",
            (status, *counts.values(), run_id),
        )
        self.conn.commit()

    def audit(self, actor: str, entity: str, entity_id: int | None,
              action: str, detail: dict | None = None) -> None:
        self.conn.execute(
            "INSERT INTO audit_log (actor, entity, entity_id, action, detail) VALUES (?,?,?,?,?)",
            (actor, entity, entity_id, action, json.dumps(detail) if detail else None),
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
