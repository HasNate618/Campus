"""Semantic corpus index: embeddings + rerank via the configured LLM endpoint.

chunks table: id, course_id, ref (display path), chunk_idx, text, embedding
(BLOB of float32), src_hash (the source item's content hash — incremental
rebuild skips unchanged refs).

Search flow: embed the query → cosine top-N candidates (brute force — the
corpus is a few hundred chunks, no vector extension needed) → rerank
those candidates through the LLM endpoint → top_k cited passages.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import struct
from pathlib import Path

import httpx

from agent.chat import llm_headers

CHUNK_CHARS = 800
RERANK_CANDIDATES = 20
TOP_K = 5
BATCH = 32

# Embedding/rerank models are OPT-IN (read from cfg.embed_model /
# cfg.rerank_model). Most OpenAI-compatible endpoints don't serve /embeddings
# or /rerank, so when both are empty the corpus search runs lexical-only
# (substring + term-overlap) with no extra model. Raised when the endpoint
# lacks the capability, so callers can degrade to lexical instead of crashing.
class ModelUnavailable(Exception):
    pass

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
    """Embed via cfg.llm_endpoints()[0] /embeddings using cfg.embed_model. Raises
    ModelUnavailable if the endpoint 404s or otherwise lacks embeddings so the
    caller can fall back to lexical ranking."""
    if not cfg.embed_model:
        raise ModelUnavailable("embed_model not configured")
    endpoints = cfg.llm_endpoints()
    if not endpoints:
        raise ModelUnavailable("no LLM endpoint configured")
    base = endpoints[0]
    out: list[list[float]] = []
    with httpx.Client(timeout=90) as client:
        for i in range(0, len(texts), BATCH):
            batch = texts[i:i + BATCH]
            try:
                r = client.post(
                    f"{base}/embeddings",
                    headers=llm_headers(cfg),
                    json={"model": cfg.embed_model, "input": batch},
                )
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise ModelUnavailable(
                    f"embeddings endpoint unavailable: {e.response.status_code}") from e
            except httpx.HTTPError as e:
                raise ModelUnavailable(f"embeddings request failed: {e}") from e
            data = r.json()["data"]
            data.sort(key=lambda d: d["index"])
            out.extend([d["embedding"] for d in data])
    return out


def _rerank_scores(cfg, query: str, docs: list[str]) -> list[float]:
    """Rerank docs via the LLM endpoint's /rerank using cfg.rerank_model;
    scores aligned to docs. Raises ModelUnavailable if the endpoint lacks
    /rerank so the caller can keep cosine order."""
    if not docs:
        return []
    if not cfg.rerank_model:
        raise ModelUnavailable("rerank_model not configured")
    endpoints = cfg.llm_endpoints()
    if not endpoints:
        raise ModelUnavailable("no LLM endpoint configured")
    base = endpoints[0]
    with httpx.Client(timeout=90) as client:
        try:
            r = client.post(
                f"{base}/rerank",
                headers=llm_headers(cfg),
                json={
                    "model": cfg.rerank_model,
                    "query": query,
                    "documents": [{"text": d} for d in docs],
                },
            )
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise ModelUnavailable(
                f"rerank endpoint unavailable: {e.response.status_code}") from e
        except httpx.HTTPError as e:
            raise ModelUnavailable(f"rerank request failed: {e}") from e
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
    """Incremental: (re)embed only items whose (ref, hash) changed.

    Lexical mode (cfg.embed_model empty): no /embeddings call — embeddings
    are stored as empty blobs and search() ranks lexically. The empty model
    guard below wipes any stale vectors so a mode switch is clean.
    """
    db.conn.execute(
        """CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY, course_id INTEGER, ref TEXT, chunk_idx INTEGER,
            text TEXT, embedding BLOB, src_hash TEXT)"""
    )
    # Track which embed_model built the vectors. A NULL/'none' means lexical
    # (no vectors). If the configured model changed, wipe stale vectors so we
    # never mix embeddings from two models into one cosine space.
    db.conn.execute(
        "CREATE TABLE IF NOT EXISTS chunk_meta "
        "(k TEXT PRIMARY KEY, v TEXT)"
    )
    stored_model = db.conn.execute(
        "SELECT v FROM chunk_meta WHERE k='embed_model'").fetchone()
    stored_model = stored_model[0] if stored_model else None
    want_model = cfg.embed_model or "none"  # "none" = lexical (empty vectors)
    if stored_model != want_model:
        db.conn.execute("DELETE FROM chunks")
        db.conn.execute(
            "INSERT INTO chunk_meta (k, v) VALUES ('embed_model', ?) "
            "ON CONFLICT(k) DO UPDATE SET v=?", (want_model, want_model))
        db.conn.commit()

    items = _corpus(cfg, db)
    known = {
        (r["ref"], r["src_hash"])
        for r in db.conn.execute("SELECT ref, src_hash FROM chunks").fetchall()
    }
    todo = [it for it in items if (it["ref"], it["hash"]) not in known]
    if not todo:
        return {"chunks": db.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
                "embedded_items": 0, "items": len(items)}
    # Lexical mode: write empty embeddings, no network.
    if not cfg.embed_model:
        cur = db.conn.cursor()
        for it in todo:
            cur.execute("DELETE FROM chunks WHERE ref=?", (it["ref"],))
            for idx, chunk_text in enumerate(_chunk(it["text"])):
                cur.execute(
                    "INSERT INTO chunks (course_id, ref, chunk_idx, text, embedding, src_hash) "
                    "VALUES (?,?,?,?,?,?)",
                    (it["course_id"], it["ref"], idx, chunk_text, b"", it["hash"]),
                )
        db.conn.commit()
        return {"chunks": db.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
                "embedded_items": 0, "items": len(items)}
    texts = [t for it in todo for t in _chunk(it["text"])]
    try:
        vectors = _embed(cfg, texts)
    except ModelUnavailable as e:
        # Endpoint lacks /embeddings: fall back to lexical, log once.
        import logging
        logging.getLogger(__name__).warning("embeddings unavailable (%s); indexing lexical-only", e)
        cur = db.conn.cursor()
        for it in todo:
            cur.execute("DELETE FROM chunks WHERE ref=?", (it["ref"],))
            for idx, chunk_text in enumerate(_chunk(it["text"])):
                cur.execute(
                    "INSERT INTO chunks (course_id, ref, chunk_idx, text, embedding, src_hash) "
                    "VALUES (?,?,?,?,?,?)",
                    (it["course_id"], it["ref"], idx, chunk_text, b"", it["hash"]),
                )
        db.conn.commit()
        db.conn.execute("UPDATE chunk_meta SET v='none' WHERE k='embed_model'")
        db.conn.commit()
        return {"chunks": db.conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
                "embedded_items": 0, "items": len(items), "lexical_fallback": True}
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


def _lexical_hits(db, course_id: int | None, query: str, limit: int = 8
                  ) -> tuple[set[int], set[int]]:
    """Exact-substring pre-filter. Returns (phrase_ids, term_ids):
    - phrase_ids: chunks containing the WHOLE query verbatim — verbatim
      answers that semantic ranking can bury ("Email Response Time" scored
      cosine 0.34 vs a 0.48 cutoff, then rerank 0.0 vs noise).
    - term_ids: chunks containing any >=3-char term (candidate enrichment).
    SQLite instr() — LIKE has no default escape."""
    query = query.strip().strip('"\'“”`').strip()
    phrase = query.lower()
    terms = [t for t in re.split(r"\s+", query) if len(t) >= 3][:6]
    if not terms:
        return set(), set()
    conds = " OR ".join(["instr(lower(text), lower(?)) > 0"] * len(terms))
    args = [t.lower() for t in terms]
    sql = f"SELECT id FROM chunks WHERE {conds}"
    if course_id is not None:
        sql = f"SELECT id FROM chunks WHERE course_id=? AND ({conds})"
        args = [course_id] + args
    term_ids = {r[0] for r in db.conn.execute(sql + " LIMIT ?", args + [limit])}
    phrase_ids: set[int] = set()
    if len(phrase) >= 3:
        sql2 = "SELECT id FROM chunks WHERE instr(lower(text), lower(?)) > 0"
        args2 = [course_id] if course_id is not None else []
        if course_id is not None:
            sql2 = ("SELECT id FROM chunks WHERE course_id=? "
                    "AND instr(lower(text), lower(?)) > 0")
        for r in db.conn.execute(sql2 + " LIMIT ?", args2 + [phrase, limit]):
            phrase_ids.add(r[0])
    return phrase_ids, term_ids


def _snippet(text: str, query: str, width: int = 240) -> str:
    """Window the returned passage around the first query occurrence — the
    flat first-400-chars cut once truncated the matched phrase itself out of
    the snippet (the "Email Response Time" line sits at char 490 of its
    chunk, so the model saw the welcome text and NOT the answer)."""
    i = text.lower().find(query.strip().lower())
    if i < 0:
        return text[:400]
    start = max(0, i - width // 2)
    end = min(len(text), i + len(query.strip()) + width // 2)
    return f"{'…' if start > 0 else ''}{text[start:end]}{'…' if end < len(text) else ''}"


def search(cfg, db, query: str, course_id: int | None = None,
           top_k: int = TOP_K) -> list[dict]:
    # models often pass the user's quoted phrase verbatim — strip the
    # quote chars so lexical phrase matching still works
    query = query.strip().strip('"\'\u201c\u201d`').strip()
    q = db.conn.execute(
        "SELECT id, course_id, ref, text, embedding FROM chunks"
        + (" WHERE course_id=?" if course_id else ""),
        (course_id,) if course_id else (),
    ).fetchall()
    if not q:
        return []
    # Lexical mode (no embed_model, or /embeddings unavailable): rank by the
    # lexical ranker only — no cosine, no rerank. This is the zero-extra-model
    # path that works for every deployment.
    if not cfg.embed_model:
        return _lexical_rank(db, q, query, course_id, top_k)
    # Semantic mode: embed query + cosine, then try rerank. Both steps
    # degrade to lexical if the endpoint lacks the capability.
    try:
        qv = _embed(cfg, [query])[0]
    except ModelUnavailable as e:
        import logging
        logging.getLogger(__name__).warning(
            "embeddings unavailable at search (%s); lexical-only", e)
        return _lexical_rank(db, q, query, course_id, top_k)
    scored = sorted(
        ((_cosine(qv, _unpack(r["embedding"])), r) for r in q
         if _unpack(r["embedding"])),
        key=lambda t: t[0], reverse=True,
    )[:RERANK_CANDIDATES]
    # lexical boost: exact-substring matches cosine missed must still reach
    # the reranker (short phrases vs long chunks embed badly).
    phrase_ids, lex_ids = _lexical_hits(db, course_id, query)
    if lex_ids:
        seen = {r["id"] for _, r in scored}
        extra = [(_cosine(qv, _unpack(r["embedding"])), r)
                 for r in q if r["id"] in lex_ids and r["id"] not in seen
                 and _unpack(r["embedding"])]
        if extra:
            scored = sorted(scored + extra, key=lambda t: t[0], reverse=True)[:RERANK_CANDIDATES]
    docs = [r["text"] for _, r in scored]
    # Rerank best-effort; on 404/error keep cosine order.
    try:
        scores = _rerank_scores(cfg, query, docs)
    except ModelUnavailable as e:
        import logging
        logging.getLogger(__name__).warning(
            "rerank unavailable (%s); keeping cosine order", e)
        scores = [s for s, _ in scored]
    ranked = sorted(
        ((scores[i], r) for i, (_, r) in enumerate(scored)),
        key=lambda t: t[0], reverse=True,
    )[:top_k]
    # verbatim phrase matches are the answer to "where is this said" — the
    # reranker can still bury a long/noisy chunk below unrelated noise, so
    # force them to the FRONT of the result set (append-then-slice would
    # drop them: they'd sit beyond the top_k cut).
    if phrase_ids:
        have = {r["id"] for _, r in ranked}
        phrase_hits = [(1.0, r) for r in q
                       if r["id"] in phrase_ids and r["id"] not in have]
        if phrase_hits:
            ranked = phrase_hits + ranked
            ranked = ranked[:top_k]
    # near-zero semantic results = the reranker failed the query; the
    # exact-substring term matches are then the best answer (the model often
    # REFRAMES a user's phrase — "email response time policy" — which breaks
    # the verbatim phrase match while the chunk still contains the words).
    # Rank by term overlap count (more query terms in the chunk = better),
    # not by chunk insertion order.
    elif (len([t for t in re.split(r"\s+", query) if len(t) >= 3]) >= 2
          and ranked and max(score for score, _ in ranked) < 0.1):
        terms = [t for t in re.split(r"\s+", query) if len(t) >= 3][:6]
        scored_terms: list[tuple[float, object]] = []
        for r in q:
            t = r["text"].lower()
            c = sum(1 for w in terms if w in t)
            if c > 0:
                scored_terms.append((0.3 + 0.15 * c, r))
        scored_terms.sort(key=lambda x: (-x[0], -_cosine(qv, _unpack(x[1]["embedding"]))))
        have = {r["id"] for _, r in ranked}
        term_hits = [(s, r) for s, r in scored_terms if r["id"] not in have]
        if term_hits:
            ranked = term_hits[:top_k] + ranked
            ranked = ranked[:top_k]
    return [
        {"ref": r["ref"], "course_id": r["course_id"],
         "text": _snippet(r["text"], query), "score": round(score, 4)}
        for score, r in ranked
    ]


def _lexical_rank(db, q, query: str, course_id: int | None, top_k: int) -> list[dict]:
    """Rank chunks by lexical signal only (no embeddings/rerank).

    Phrase matches (whole query verbatim) go first, then term-overlap count,
    then insertion order. This is the deployment-agnostic path.
    """
    phrase_ids, term_ids = _lexical_hits(db, course_id, query)
    if phrase_ids:
        hits = [r for r in q if r["id"] in phrase_ids]
        return [
            {"ref": r["ref"], "course_id": r["course_id"],
             "text": _snippet(r["text"], query), "score": 1.0}
            for r in hits[:top_k]
        ]
    terms = [t for t in re.split(r"\s+", query) if len(t) >= 3][:6]
    if not terms:
        return []
    ranked_terms: list[tuple[float, object]] = []
    for r in q:
        t = r["text"].lower()
        c = sum(1 for w in terms if w in t)
        if c > 0:
            ranked_terms.append((0.3 + 0.15 * c, r))
    ranked_terms.sort(key=lambda x: -x[0])
    return [
        {"ref": r["ref"], "course_id": r["course_id"],
         "text": _snippet(r["text"], query), "score": round(score, 4)}
        for score, r in ranked_terms[:top_k]
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
