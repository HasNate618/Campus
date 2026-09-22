"""What the user is looking at, rendered as a system-prompt block.

The client sends identity and position only — ids and a page number.
Everything the model sees is resolved here from the database, so a stale or
wrong client cannot put an invented path, title or deadline in front of the
model, and an id that does not resolve yields no block at all rather than a
plausible-looking guess.

The block is dynamic per turn, so `run_turn` appends it last: the prompt's
prefix is what an upstream gateway caches, and a block that changes every turn
would break that cache from its first token.
"""

from __future__ import annotations

from pathlib import Path

from sync.config import Config
from sync.db import DB

_HEADER = "CURRENT VIEW (what the user has open right now)"
_RULE = (
    'When the user says "this", "here", "it" or "this page" without naming '
    "what they mean, they mean this. Read it first — content_read_file, with "
    "pages= for a page — and answer from what it says rather than from memory."
)


def render_view_block(cfg: Config, db: DB, view: object,
                      course_id: int | None = None) -> str:
    """The current-view block, or "" when there is nothing honest to show."""
    if not isinstance(view, dict):
        return ""
    # The conversation is scoped to a course, and so is "here". Without a
    # course (the standalone chat) there is nothing to point at. The view's own
    # course_id is deliberately NOT checked here: the row is the authority, so
    # a stale client field cannot veto a document that really is in this course.
    if course_id is None:
        return ""
    kind = view.get("kind")
    if kind == "content":
        lines = _content_lines(cfg, db, view, course_id)
    elif kind == "assignment":
        lines = _assignment_lines(db, view, course_id)
    else:
        return ""
    if not lines:
        return ""
    return f"\n\n{_HEADER}:\n" + "\n".join(lines) + f"\n{_RULE}\n"


def _as_int(value: object) -> int | None:
    """Ids must be real ints. `True` is an int in Python (so it would address
    row 1), and a numeric string would either crash the query or compare
    unequal to the course id and be dropped for the wrong reason."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _content_lines(cfg: Config, db: DB, view: dict, course_id: int) -> list[str]:
    file_id = _as_int(view.get("file_id"))
    if file_id is None:
        return []
    row = db.conn.execute(
        "SELECT path, course_id FROM files WHERE id=?", (file_id,)).fetchone()
    if row is None:
        return []
    # The row's own course decides, not the client's claim: this is what stops
    # one course's chat from being pointed at another course's document.
    if _as_int(row["course_id"]) != course_id:
        return []
    path = _readable_path(db, row["path"])
    path = _canonical(db, path)
    return [f"kind: content", f"path: {path}", f"title: {Path(path).stem}"] + \
        _page_lines(cfg, path, view)


def _page_lines(cfg: Config, path: str, view: dict) -> list[str]:
    """The page lines, or just the count when the page cannot be confirmed.

    A page that does not exist in the file is dropped rather than passed on:
    the model would otherwise read it, get an error, and burn a call — or worse,
    answer about a page it never saw. The document pointer still stands.
    """
    total = _pages_in(cfg, path)
    if total is None:
        return []
    page = _as_int(view.get("page"))
    if page is None or page < 1 or page > total:
        return [f"pages: {total}"]
    return [f"page: {page}", f"pages: {total}"]


def _pages_in(cfg: Config, rel: str) -> int | None:
    """Page count in the file's own `<!-- page N -->` space.

    Deliberately not the viewer's PDF page count: content_read_file addresses
    these markers, so validating against the PDF's numbering would let a page
    through that the read then rejects.
    """
    from agent.citations import pages_in_file, read_window
    full = Path(cfg.data_root) / rel
    try:
        # Pass 1 only: limit=0 keeps the window empty while read_window still
        # counts lines and collects markers.
        with open(full, "r", encoding="utf-8", errors="replace") as fh:
            _, _, index = read_window(fh, 0, 0)
    except OSError:
        return None
    return pages_in_file(index)


def _canonical(db: DB, path: str) -> str:
    """The copy the index actually carries (see sync/dedupe.py)."""
    from agent.tools import _canonical_paths
    resolved = _canonical_paths(db, [path])
    return resolved[0] if resolved else path


def _readable_path(db: DB, path: str) -> str:
    """For a PDF, the extracted markdown the model can actually read.

    The viewer reports the PDF's file id, but only the extracted .md carries
    `<!-- page N -->` markers, so content_read_file can page through it and a
    page number means something. Handing over the .pdf would drop the page
    (no markers) and point the model at a binary. Falls back to the PDF itself
    when there is no twin yet — a real pointer, just not a pageable one.
    """
    if not path.lower().endswith(".pdf"):
        return path
    md = str(Path(path).with_suffix(".md"))
    row = db.conn.execute("SELECT path FROM files WHERE path=?", (md,)).fetchone()
    return row["path"] if row else path


def _assignment_lines(db: DB, view: dict, course_id: int) -> list[str]:
    assignment_id = _as_int(view.get("assignment_id"))
    if assignment_id is None:
        return []
    row = db.conn.execute(
        "SELECT course_id, title, due_at, status FROM assignments WHERE id=?",
        (assignment_id,)).fetchone()
    if row is None or _as_int(row["course_id"]) != course_id:
        return []
    # due and status are the database's own values, not the client's, so an
    # extension recorded in the harness is what the model is told about.
    lines = ["kind: assignment", f"title: {row['title']}"]
    if row["due_at"]:
        lines.append(f"due: {row['due_at']}")
    if row["status"]:
        lines.append(f"status: {row['status']}")
    return lines
