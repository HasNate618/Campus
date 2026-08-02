"""SQLite access helpers (real DB)."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator

from api.config import DB_PATH, USE_MOCK


def db_available() -> bool:
    return not USE_MOCK and DB_PATH.exists()


def ensure_wal() -> None:
    """One-time: enable WAL so API readers don't block the sync writer."""
    if not DB_PATH.exists():
        return
    c = sqlite3.connect(DB_PATH)
    try:
        c.execute("PRAGMA journal_mode=WAL")
    finally:
        c.close()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]
