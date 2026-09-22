"""The current-view block: what the user has open, as prompt context.

The client sends identity and position only — ids and a page number.
Everything the model sees is resolved from the database here, so a stale or
wrong client cannot put an invented path, title or deadline in front of the
model, and an id that does not resolve produces no block at all rather than a
plausible-looking guess.
"""

from __future__ import annotations

import pytest


@pytest.fixture()
def view_cfg(tmp_path, db_path):
    """A real Config over the corpus each test builds (same pattern as
    test_agent_tools.page_cfg — Config has no stub that satisfies this).

    Carries an LLM endpoint and model so `run_turn` gets past its preflight:
    without them it returns a "configure chat first" message and never reaches
    the model, which is how a prompt test can pass while asserting nothing.
    """
    from sync.config import Config
    root = tmp_path / "school"
    root.mkdir(parents=True, exist_ok=True)
    return Config(data_root=root, db_path=db_path,
                  llm_url="http://llm.invalid/v1", llm_model="test-model")


@pytest.fixture()
def view_db(db_path):
    from sync.db import DB
    d = DB(db_path)
    yield d
    d.close()


def _add_file(conn, path, course_id=1, node=None, kind="reading", sha=None):
    conn.execute(
        "INSERT INTO files (course_id, content_node_id, path, kind, sha256) "
        "VALUES (?,?,?,?,?)", (course_id, node, path, kind, sha))
    conn.commit()
    return conn.execute("SELECT id FROM files WHERE path=?", (path,)).fetchone()["id"]


def _deck(root, rel, pages=74):
    """A marked file, so pages_in_file() has something real to count."""
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    body = []
    for pg in range(1, pages + 1):
        body.append(f"<!-- page {pg} -->")
        body.append(f"# Slide {pg}")
    p.write_text("\n".join(body))
    return p


def _content_view(fid, course=1, page=6, page_count=74):
    return {"kind": "content", "course_id": course, "file_id": fid,
            "page": page, "page_count": page_count}


# --- nothing to say -------------------------------------------------------
#
# Every case below passes course_id=1 explicitly. Without it these would pass
# by tripping the course guard instead of the rule under test, which is the
# kind of test that keeps passing after the behaviour it names is deleted.

@pytest.mark.parametrize("nothing", [
    None, {}, [], {"kind": None}, {"kind": "nonsense"}, {"kind": "content"},
    {"kind": "content", "course_id": 1}, {"kind": "assignment", "course_id": 1},
])
def test_no_view_renders_nothing(view_cfg, view_db, nothing):
    from agent.view import render_view_block
    assert render_view_block(view_cfg, view_db, nothing, course_id=1) == ""


def test_unknown_file_renders_nothing_not_a_guess(view_cfg, view_db):
    """An id that does not resolve must vanish, never degrade to 'some file'."""
    from agent.view import render_view_block
    assert render_view_block(view_cfg, view_db, _content_view(9999), course_id=1) == ""


def test_unknown_assignment_renders_nothing(view_cfg, view_db):
    from agent.view import render_view_block
    assert render_view_block(
        view_cfg, view_db,
        {"kind": "assignment", "course_id": 1, "assignment_id": 9999},
        course_id=1) == ""


@pytest.mark.parametrize("bad", ["6", True, 6.5, [], {}, None])
def test_a_non_integer_id_is_refused(view_cfg, view_db, bad):
    """Booleans are ints in Python and "6" is not an id — either would crash the
    lookup or, via truthiness, address the wrong row."""
    from agent.view import render_view_block
    assert render_view_block(
        view_cfg, view_db,
        {"kind": "content", "course_id": 1, "file_id": bad},
        course_id=1) == ""


def test_a_file_whose_real_course_disagrees_is_refused(view_cfg, view_db):
    """A client claiming course 1 while pointing at course 2's file must not
    get that file in front of the model."""
    from agent.view import render_view_block
    rel = "2027W/CS2200B/content/other.md"
    _deck(view_cfg.data_root, rel)
    fid = _add_file(view_db.conn, rel, course_id=2)
    view = _content_view(fid, course=1)          # claims course 1
    assert render_view_block(view_cfg, view_db, view, course_id=1) == ""


# --- course scoping -------------------------------------------------------

def test_a_stale_client_course_claim_does_not_veto_a_real_match(view_cfg, view_db):
    """The row is the authority, not the client's field.

    A client whose course id is stale must not be able to hide a document that
    really is in this conversation's course — which is why the view's own
    course_id is not what decides.
    """
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel)
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db,
                              _content_view(fid, course=99), course_id=1)

    assert rel in block


def test_a_view_from_another_course_is_ignored(view_cfg, view_db):
    """The chat is scoped to a course; a view from a different one would point
    the model at a document the conversation is not about."""
    from agent.view import render_view_block
    rel = "2027W/CS2200B/content/other.md"
    _deck(view_cfg.data_root, rel)
    fid = _add_file(view_db.conn, rel, course_id=2)
    view = _content_view(fid, course=2)
    assert render_view_block(view_cfg, view_db, view, course_id=1) == ""


def test_no_chat_course_means_no_view(view_cfg, view_db):
    """Course routes are where chat and content coexist; with no course there
    is nothing to point at, so the block stays out."""
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel)
    fid = _add_file(view_db.conn, rel, course_id=1)
    assert render_view_block(view_cfg, view_db, _content_view(fid), course_id=None) == ""


# --- content --------------------------------------------------------------

def test_content_view_carries_path_page_and_the_deictic_rule(view_cfg, view_db):
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel, pages=74)
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db, _content_view(fid), course_id=1)

    assert rel in block
    assert "page: 6" in block
    assert "pages: 74" in block
    # title derived from the filename, since `files` has no title column
    assert "deck" in block
    # the rule that makes "explain this" land on the page rather than on memory
    assert "read" in block.lower()


def test_page_beyond_the_file_is_dropped_but_the_document_stays(view_cfg, view_db):
    """A stale page must not send the model after a page that isn't there —
    but the document pointer is still worth keeping."""
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/short.md"
    _deck(view_cfg.data_root, rel, pages=3)
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db,
                              _content_view(fid, page=57, page_count=57),
                              course_id=1)

    assert rel in block
    assert "page: 57" not in block
    assert "pages: 3" in block        # the real count, from the file itself


def test_the_viewers_page_count_does_not_override_the_files_own(view_cfg, view_db):
    """The viewer counts PDF pages; content_read_file addresses markdown
    markers. Trusting the client's count would let page 9 through on a
    3-page extraction, and the read would then fail."""
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/short.md"
    _deck(view_cfg.data_root, rel, pages=3)
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db,
                              _content_view(fid, page=9, page_count=74),
                              course_id=1)

    assert "page: 9" not in block
    assert "pages: 3" in block


def test_a_file_without_page_markers_gets_no_page_line(view_cfg, view_db):
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/notes.md"
    p = view_cfg.data_root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("# Notes\n\nNo page markers here.\n")
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db, _content_view(fid), course_id=1)

    assert rel in block
    assert "page:" not in block
    assert "pages:" not in block


def test_a_missing_file_on_disk_drops_the_page_not_the_view(view_cfg, view_db):
    """The row exists but the bytes are gone (mid-sync). Still a real pointer."""
    from agent.view import render_view_block
    rel = "2026F/CS1100A/content/absent.md"
    fid = _add_file(view_db.conn, rel, course_id=1)

    block = render_view_block(view_cfg, view_db, _content_view(fid), course_id=1)

    assert rel in block
    assert "page:" not in block


def test_a_pdf_points_at_its_readable_markdown_twin(view_cfg, view_db):
    """The user views the PDF; the model can only page through the extracted
    markdown, so that is what it must be handed.

    A .pdf path has no `<!-- page N -->` markers, so handing the PDF over would
    drop the page and leave the model unable to read the page it was told about.
    """
    conn = view_db.conn
    rel_md = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel_md, pages=74)
    _add_file(conn, rel_md, course_id=1)
    pdf_id = _add_file(conn, "2026F/CS1100A/content/deck.pdf", course_id=1,
                       kind="slide")

    from agent.view import render_view_block
    block = render_view_block(view_cfg, view_db,
                              _content_view(pdf_id, page=6, page_count=74),
                              course_id=1)

    assert rel_md in block            # the readable twin, not the .pdf
    assert "deck.pdf" not in block
    assert "page: 6" in block         # validated against the markdown's markers


def test_a_pdf_with_no_markdown_twin_keeps_its_own_path(view_cfg, view_db):
    """Not yet extracted (mid-sync): still a real pointer, just not pageable."""
    pdf_id = _add_file(view_db.conn, "2026F/CS1100A/content/slides.pdf",
                       course_id=1, kind="slide")

    from agent.view import render_view_block
    block = render_view_block(view_cfg, view_db, _content_view(pdf_id), course_id=1)

    assert "slides.pdf" in block
    assert "page:" not in block


def test_a_pdf_twin_is_also_canonicalised(view_cfg, view_db):
    """Both resolutions at once: the twin is found AND the duplicate rule runs
    on it, so the model is not handed the copy the index dropped."""
    conn = view_db.conn
    _deck(view_cfg.data_root, "2026F/CS1100A/content/Units/intro.md")
    _add_file(conn, "2026F/CS1100A/content/Notes-2025/intro.md")
    _add_file(conn, "2026F/CS1100A/content/Units/intro.md")
    _add_file(conn, "2026F/CS1100A/content/Notes-2025/intro.pdf", sha="same")
    _add_file(conn, "2026F/CS1100A/content/Units/intro.pdf", sha="same")
    shared_pdf = conn.execute(
        "SELECT id FROM files WHERE path LIKE '%Notes-2025/intro.pdf'").fetchone()["id"]
    conn.execute("INSERT INTO content_nodes (id, course_id, brightspace_id, node_type, title) "
                 "VALUES (90, 1, 900, 'module', 'Slides')")
    conn.execute("INSERT INTO content_nodes (id, course_id, brightspace_id, node_type, title) "
                 "VALUES (91, 1, 901, 'topic', 'Topic')")
    conn.execute("UPDATE files SET content_node_id=90 WHERE path LIKE '%Notes-2025/intro.md'")
    conn.execute("UPDATE files SET content_node_id=91 WHERE path LIKE '%Units/intro.md'")
    for i in range(5):
        _add_file(conn, f"2026F/CS1100A/content/Notes-2025/bucket{i}.md", node=90)

    from agent.view import render_view_block
    block = render_view_block(view_cfg, view_db,
                              _content_view(shared_pdf), course_id=1)

    assert "Units/intro.md" in block
    assert "Notes-2025" not in block


def test_non_canonical_duplicate_is_resolved_to_the_indexed_copy(view_cfg, view_db):
    """The point of the dedupe rule, seen from the model's side: it must be
    handed the path the index actually carries, or a second copy reappears."""
    from agent.view import render_view_block
    conn = view_db.conn
    # Two copies of one document. Same-source is proven by the sibling .pdf
    # sha; the winner is the one whose topic node fewer files link to.
    _deck(view_cfg.data_root, "2026F/CS1100A/content/Units/intro.md")
    shared = _add_file(conn, "2026F/CS1100A/content/Notes-2025/intro.md")
    _add_file(conn, "2026F/CS1100A/content/Units/intro.md")
    # the sibling PDFs, byte-identical -> one source document
    _add_file(conn, "2026F/CS1100A/content/Notes-2025/intro.pdf", sha="same")
    _add_file(conn, "2026F/CS1100A/content/Units/intro.pdf", sha="same")
    # node loads: Notes-2025 hangs off a shared bucket, Units off a topic node
    conn.execute("INSERT INTO content_nodes (id, course_id, brightspace_id, node_type, title) "
                 "VALUES (90, 1, 900, 'module', 'Slides')")
    conn.execute("INSERT INTO content_nodes (id, course_id, brightspace_id, node_type, title) "
                 "VALUES (91, 1, 901, 'topic', 'Topic')")
    conn.execute("UPDATE files SET content_node_id=90 WHERE path LIKE '%Notes-2025/intro.md'")
    conn.execute("UPDATE files SET content_node_id=91 WHERE path LIKE '%Units/intro.md'")
    for i in range(5):
        _add_file(conn, f"2026F/CS1100A/content/Notes-2025/bucket{i}.md", node=90)

    block = render_view_block(view_cfg, view_db, _content_view(shared), course_id=1)

    assert "Units/intro.md" in block
    assert "Notes-2025" not in block


# --- assignments ----------------------------------------------------------

def _add_assignment(conn, title="Assignment 3", due: str | None = "2026-09-25 23:59",
                    status="open", course_id=1):
    conn.execute(
        "INSERT INTO assignments (course_id, title, due_at, status) VALUES (?,?,?,?)",
        (course_id, title, due, status))
    conn.commit()
    return conn.execute(
        "SELECT id FROM assignments WHERE title=?", (title,)).fetchone()["id"]


def test_assignment_view_carries_title_due_and_status(view_cfg, view_db):
    from agent.view import render_view_block
    aid = _add_assignment(view_db.conn)
    block = render_view_block(
        view_cfg, view_db,
        {"kind": "assignment", "course_id": 1, "assignment_id": aid},
        course_id=1)
    assert "Assignment 3" in block
    assert "2026-09-25 23:59" in block
    assert "open" in block
    assert "assignment" in block.lower()


def test_assignment_from_another_course_is_ignored(view_cfg, view_db):
    from agent.view import render_view_block
    aid = _add_assignment(view_db.conn, title="Elsewhere", course_id=2)
    assert render_view_block(
        view_cfg, view_db,
        {"kind": "assignment", "course_id": 2, "assignment_id": aid},
        course_id=1) == ""


def test_assignment_without_a_due_date_omits_the_line(view_cfg, view_db):
    from agent.view import render_view_block
    aid = _add_assignment(view_db.conn, title="No deadline", due=None)
    block = render_view_block(
        view_cfg, view_db,
        {"kind": "assignment", "course_id": 1, "assignment_id": aid},
        course_id=1)
    assert "No deadline" in block
    assert "due:" not in block


# --- the block reaches the model ------------------------------------------
#
# build_system_prompt returning a string is not the claim. The claim is that a
# real turn tells the model what the user is looking at, so these drive run_turn
# with the model call faked and inspect what the model would have received.

def _prompt_for(view_cfg, view_db, monkeypatch, view, message="explain this",
                course_id=1):
    from agent import chat as chat_mod
    seen: dict = {}

    def fake_model_call(cfg, messages, model=None, **kwargs):
        seen["messages"] = messages
        return {"role": "assistant", "content": "ok"}, None

    monkeypatch.setattr(chat_mod, "_model_call", fake_model_call)
    chat_mod.run_turn(view_cfg, view_db, message, course_id=course_id,
                      verbose=False, view=view)
    return seen["messages"]


def test_the_view_block_reaches_the_model(view_cfg, view_db, monkeypatch):
    rel = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel, pages=74)
    fid = _add_file(view_db.conn, rel, course_id=1)

    messages = _prompt_for(view_cfg, view_db, monkeypatch, _content_view(fid))

    assert messages[0]["role"] == "system"
    assert rel in messages[0]["content"]
    assert "page: 6" in messages[0]["content"]
    # and the user's own words arrive untouched — the context is separate.
    # Indexed by role: run_turn appends the assistant reply before returning.
    user_messages = [m for m in messages if m["role"] == "user"]
    assert user_messages[0]["content"] == "explain this"


def test_the_block_is_the_last_thing_in_the_prompt(view_cfg, view_db, monkeypatch):
    """Position, not just presence. The prompt's prefix is what an upstream
    gateway caches, so per-turn content has to sit at the very end or every
    turn invalidates the cache from its first divergent token."""
    rel = "2026F/CS1100A/content/deck.md"
    _deck(view_cfg.data_root, rel, pages=74)
    fid = _add_file(view_db.conn, rel, course_id=1)

    messages = _prompt_for(view_cfg, view_db, monkeypatch, _content_view(fid))
    prompt = messages[0]["content"]

    assert "CURRENT VIEW" in prompt
    assert prompt.index("CURRENT VIEW") > prompt.index("RULES:")
    # nothing follows the block: it is the final section of the prompt
    assert prompt.rstrip().endswith("rather than from memory.")


def test_without_a_view_the_prompt_carries_none(view_cfg, view_db, monkeypatch):
    messages = _prompt_for(view_cfg, view_db, monkeypatch, None)
    assert "CURRENT VIEW" not in messages[0]["content"]


def test_a_view_for_another_course_never_reaches_the_model(
        view_cfg, view_db, monkeypatch):
    """End to end: even if the client sends it, the block stays out."""
    rel = "2027W/CS2200B/content/other.md"
    _deck(view_cfg.data_root, rel)
    fid = _add_file(view_db.conn, rel, course_id=2)

    messages = _prompt_for(view_cfg, view_db, monkeypatch,
                           _content_view(fid, course=2), course_id=1)

    assert rel not in messages[0]["content"]
    assert "CURRENT VIEW" not in messages[0]["content"]
