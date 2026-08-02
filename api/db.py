"""SQLite access helpers."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Any, Iterator

from api.config import DB_PATH, USE_MOCK


def db_available() -> bool:
    if USE_MOCK:
        return False
    return DB_PATH.exists()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
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
