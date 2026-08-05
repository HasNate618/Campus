"""Semantic corpus index: Cohere embeddings + rerank via bifrost.

chunks table: id, course_id, ref (display path), chunk_idx, text, embedding
(BLOB of float32), src_hash (the source item's content hash — incremental
rebuild skips unchanged refs).

Search flow: embed the query → cosine top-N candidates (brute force — the
corpus is a few hundred chunks, no vector extension needed) → Cohere rerank
those candidates through bifrost → top_k cited passages.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import struct
from pathlib import Path

import httpx

CHUNK_CHARS = 800
RERANK_CANDIDATES = 20
TOP_K = 5
BATCH = 32

EMBED_MODEL = "cohere/embed-english-v3.0"
RERANK_MODEL = "cohere/rerank-english-v3.0"

_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


def _chunk(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Paragraph-aware chunking: pack paragraphs up to ~size chars."""
    paras = [p.strip() for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        if len(cur) + len(p) + 1 > size and cur:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        chunks.append(cur)
    return chunks or [""]


def _embed(cfg, texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    with httpx.Client(timeout=90) as client:
        for i in range(0, len(texts), BATCH):
            batch = texts[i:i + BATCH]
            r = client.post(
                f"{cfg.bifrost_url}/embeddings",
                json={"model": EMBED_MODEL, "input": batch},
            )
            r.raise_for_status()
            data = r.json()["data"]
            data.sort(key=lambda d: d["index"])
            out.extend(d["embedding"] for d in data)
    return out


def _rerank_scores(cfg, query: str, docs: list[str]) -> list[float]:
    """Rerank docs via Cohere rerank through bifrost; scores aligned to docs."""
    if not docs:
        return []
    with httpx.Client(timeout=90) as client:
        r = client.post(
            f"{cfg.bifrost_url}/rerank",
            json={
                "model": RERANK_MODEL,
                "query": query,
                "documents": [{"text": d} for d in docs],
            },
        )
        r.raise_for_status()
        results = r.json().get("results", [])
    scores = [0.0] * len(docs)
    for res in results:
        scores[res["index"]] = res["relevance_score"]
    return scores


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def _pack(v: list[float]) -> bytes:
    return b"".join(struct.pack("<f", x) for x in v)


def _unpack(b: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(b) // 4}f", b))


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _course_id(db, term_code: str) -> int | None:
    row = db.conn.execute(
        "SELECT id FROM courses WHERE term=? AND replace(code,' ','')=?",
        (term_code.split("/")[0], term_code.split("/")[1]),
    ).fetchone()
    return row[0] if row else None


def _corpus(cfg, db) -> list[dict]:
    """Source items: {ref, course_id, text, hash}. Content/notes/assignment
    markdown from disk + announcements, node descriptions, active facts."""
    items: list[dict] = []
    root = Path(cfg.data_root).resolve()

    def add(ref: str, course_id: int | None, text: str) -> None:
        if not text.strip():
            return
        items.append({
            "ref": ref, "course_id": course_id,
            "text": text, "hash": hashlib.sha256(text.encode()).hexdigest()[:16],
        })

    # disk markdown + html: content/, notes/, Assignments/ across course dirs
    # (html = unit introductions / slide wrappers — strip tags, they carry
    # real text; the sync stores slides that are html pages as .html)
    for top in ("content", "notes", "Assignments"):
        for md in sorted(root.glob(f"*/*/{top}/**/*.md")) + sorted(root.glob(f"*/*/{top}/**/*.html")):
            try:
                raw = md.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            text = _strip_html(raw) if md.suffix.lower() == ".html" else raw
            rel = str(md.relative_to(root))
            tc = rel.split("/")[0] + "/" + rel.split("/", 2)[1]
            add(rel, _course_id(db, tc), text)

    # announcements
    for r in db.conn.execute(
        "SELECT a.id, a.course_id, a.body FROM announcements a WHERE a.body IS NOT NULL"
    ).fetchall():
        add(f"announcements/{r['id']}", r["course_id"], _strip_html(r["body"]))

    # content node descriptions (HTML)
    for r in db.conn.execute(
        "SELECT id, course_id, description FROM content_nodes WHERE description IS NOT NULL"
    ).fetchall():
        add(f"overview/{r['id']}", r["course_id"], _strip_html(r["description"]))

    # active memory facts
    for r in db.conn.execute(
        "SELECT fact, course_id FROM memory_facts WHERE is_active=1"
    ).fetchall():
        add(f"facts/{r['course_id']}", r["course_id"], r["fact"])

    return items


def rebuild(cfg, db) -> dict:
    """Incremental: embed only items whose (ref, hash) changed. Returns counts."""
    db.conn.execute(
        """CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY, course_id INTEGER, ref TEXT, chunk_idx INTEGER,
            text TEXT, embedding BLOB, src_hash TEXT)"""
    )
    items = _corpus(cfg, db)
    known = {
        (r["ref"], r["src_hash"])
        for r in db.conn.execute("SELECT ref, src_hash FROM chunks").fetchall()
    }
    todo = [it for it in items if (it["ref"], it["hash"]) not in known]
    if not todo:
        return {"chunks": db.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
                "embedded_items": 0, "items": len(items)}
    texts = [t for it in todo for t in _chunk(it["text"])]
    vectors = _embed(cfg, texts)
    vec_iter = iter(vectors)  # consume sequentially — zipping per item from the
    # head of the list misaligns every item after the first (all get the same
    # head vectors → identical cosines). This was a real bug; fixed.
    cur = db.conn.cursor()
    for it in todo:
        cur.execute("DELETE FROM chunks WHERE ref=?", (it["ref"],))
        for idx, chunk_text in enumerate(_chunk(it["text"])):
            cur.execute(
                "INSERT INTO chunks (course_id, ref, chunk_idx, text, embedding, src_hash) "
                "VALUES (?,?,?,?,?,?)",
                (it["course_id"], it["ref"], idx, chunk_text, _pack(next(vec_iter)), it["hash"]),
            )
    db.conn.commit()
    return {"chunks": db.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
            "embedded_items": len(todo), "items": len(items)}


def search(cfg, db, query: str, course_id: int | None = None,
           top_k: int = TOP_K) -> list[dict]:
    q = db.conn.execute(
        "SELECT id, course_id, ref, text, embedding FROM chunks"
        + (" WHERE course_id=?" if course_id else ""),
        (course_id,) if course_id else (),
    ).fetchall()
    if not q:
        return []
    qv = _embed(cfg, [query])[0]
    scored = sorted(
        ((_cosine(qv, _unpack(r["embedding"])), r) for r in q),
        key=lambda t: t[0], reverse=True,
    )[:RERANK_CANDIDATES]
    docs = [r["text"] for _, r in scored]
    scores = _rerank_scores(cfg, query, docs)
    ranked = sorted(
        ((scores[i], r) for i, (_, r) in enumerate(scored)),
        key=lambda t: t[0], reverse=True,
    )[:top_k]
    return [
        {"ref": r["ref"], "course_id": r["course_id"],
         "text": r["text"][:400], "score": round(score, 4)}
        for score, r in ranked
    ]


def main() -> None:
    import argparse

    from sync.config import Config
    from sync.db import DB

    ap = argparse.ArgumentParser(description="semantic corpus index")
    ap.add_argument("cmd", choices=["rebuild", "search"])
    ap.add_argument("--query", "-q")
    ap.add_argument("--course", "-c", type=int)
    ap.add_argument("--top", type=int, default=TOP_K)
    args = ap.parse_args()
    cfg = Config.load()
    db = DB(Path(cfg.db_path))
    if args.cmd == "rebuild":
        print(json.dumps(rebuild(cfg, db), indent=2))
    else:
        if not args.query:
            raise SystemExit("search needs --query")
        for hit in search(cfg, db, args.query, args.course, args.top):
            print(f"[{hit['score']}] {hit['ref']}")
            print(f"    {hit['text'][:120]!r}")
