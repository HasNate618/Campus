"""Collapse same-source duplicate documents to a single canonical path.

Ten documents in the live corpus are extracted and indexed twice: once under
`content/Notes-2025/` (or `Notes-2026/`) and once under `content/Units/`. The
source PDFs are byte-identical, yet both extracted `.md` copies were embedded,
so a single answer could be cited to two different paths and `offset/limit`
reads of the "same" page disagreed by ten lines (page 57 of the intro deck sat
at line 1043 in one copy and 1053 in the other).

The rule here is derived from the corpus, never from a folder name — a folder
can be renamed or a new duplicate pair can appear under different folders, and
the decision must still land on the copy the course structure actually places
in the module tree.

`plan_canonical` is pure: no DB, no disk, no I/O. `canonical_map` is the thin
read-only adapter that hands it rows from `files`.
"""

from __future__ import annotations

from os.path import basename
from pathlib import Path


def plan_canonical(records: list[dict]) -> dict[str, str]:
    """Map each NON-canonical path to its canonical sibling.

    `records` entries:
        {"path", "course_id", "content_node_id", "node_load", "source_sha"}
      node_load  = how many files link to that node (a shared "Slides" bucket
                   node has many; a per-document topic node has few).
      source_sha = sha256 of the sibling `.pdf`, or None when there is none.

    Candidates are grouped by `(course_id, basename)` — the same basename in a
    different course is a different document. A group is only collapsed when
    the copies carry the SAME source sha, which is what proves they are one
    document extracted twice rather than two documents that share a name.
    Unknown shas do not disqualify a group (one side may simply have no `.pdf`
    row), but if no candidate has one there is no evidence at all and the group
    is left alone.
    """
    groups: dict[tuple, list[dict]] = {}
    for r in records:
        groups.setdefault((r.get("course_id"), basename(r["path"])), []).append(r)

    mapping: dict[str, str] = {}
    for group in groups.values():
        if len(group) < 2:
            continue
        known = {r.get("source_sha") for r in group if r.get("source_sha")}
        if len(known) > 1:
            continue          # provably different sources: two real documents
        if not known:
            continue          # no evidence they are one document twice
        winner = min(group, key=_rank)["path"]
        for r in group:
            if r["path"] != winner:
                mapping[r["path"]] = winner
    return mapping


def _rank(r: dict) -> tuple[int, int, str]:
    """Sort key: the most specifically-placed candidate wins.

    `node_load` is compared, not thresholded. The live shape is load 23 for the
    shared bucket against load 2 for the per-document node — the extracted
    `.md` and its `.pdf` both link the same topic node — so a `<= 1` test would
    call both candidates specific and then pick by path, choosing the wrong
    copy. Fewest linking files is the honest signal for "placed here for its
    own sake"; the path is the deterministic tie-break.
    """
    nid = r.get("content_node_id")
    if nid is None:
        return (1, 0, r["path"])                  # no placement evidence
    return (0, r.get("node_load") or 0, r["path"])  # most specific first


def resolve(path: str, mapping: dict[str, str]) -> str:
    """Canonical path for `path`, or `path` itself when it already is one."""
    return mapping.get(path, path)


def canonical_map(conn) -> dict[str, str]:
    """Read `files` and return {non-canonical path: canonical path}.

    Read-only, and never raises: this is called from the indexing path and from
    agent tool paths, where a failure must degrade to "no collapse" rather than
    take down a rebuild or a tool call.
    """
    try:
        rows = conn.execute(
            "SELECT path, course_id, content_node_id FROM files "
            "WHERE path LIKE '%.md'").fetchall()
        if len(rows) < 2:
            return {}
        loads = {
            r[0]: r[1] for r in conn.execute(
                "SELECT content_node_id, COUNT(*) FROM files "
                "WHERE content_node_id IS NOT NULL "
                "GROUP BY content_node_id").fetchall()
        }
        shas = {
            r[0]: r[1] for r in conn.execute(
                "SELECT path, sha256 FROM files WHERE path LIKE '%.pdf'").fetchall()
        }
    except Exception:
        return {}

    records: list[dict] = []
    for r in rows:
        nid = r["content_node_id"]
        records.append({
            "path": r["path"],
            "course_id": r["course_id"],
            "content_node_id": nid,
            "node_load": loads.get(nid, 0) if nid is not None else 0,
            "source_sha": shas.get(str(Path(r["path"]).with_suffix(".pdf"))),
        })
    return plan_canonical(records)
