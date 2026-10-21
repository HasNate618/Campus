"""Campus eval harness: retrieval metrics now, answer metrics when a model is set.

Two halves, both skipped honestly when their inputs are missing:

* Retrieval runs in every mode the config supports (lexical always; semantic
  when `embed_model` is set; hybrid when a rerank model is set too) and reports
  hit@1, hit@5 and MRR against the files each question expects. It also runs
  with the exact-phrase ``instr()`` boost off, so the boost can be shown to be
  worth something rather than assumed.
* Answers run only when an LLM endpoint is configured. Each question goes
  through the real agent turn, recording whether a citation matches the
  expected file (and page), whether the expected strings appear, the tool-call
  count, wall-clock latency, and token usage. Cost is derived from
  eval/prices.yaml when that file exists.

Nothing here invents numbers. A missing input produces a skipped section, not a
guess, and results are written under eval/results/ (gitignored) so question
text and course content never get committed.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

DEFAULT_QUESTIONS = REPO / "eval" / "questions.example.yaml"
DEFAULT_PRICES = REPO / "eval" / "prices.yaml"
DEFAULT_RESULTS = REPO / "eval" / "results"


# ── questions ───────────────────────────────────────────────────────────────

def load_questions(path: Path | str) -> list[dict]:
    """Parse and validate a questions file. Raises on a malformed entry:
    a silently dropped question would quietly change the denominator."""
    import yaml

    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"questions file not found: {p}")
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or []
    if not isinstance(data, list):
        raise ValueError(f"{p}: top level must be a list of questions")

    out: list[dict] = []
    for i, q in enumerate(data):
        if not isinstance(q, dict):
            raise ValueError(f"{p}: entry {i} is not a mapping")
        for key in ("id", "question", "expected"):
            if key not in q:
                raise ValueError(f"{p}: entry {i} is missing {key!r}")
        expected = q["expected"] or {}
        files = expected.get("files") or []
        if not files:
            raise ValueError(f"{p}: {q['id']} needs expected.files")
        for f in files:
            if not isinstance(f, str) or not f.strip():
                raise ValueError(f"{p}: {q['id']} has a blank expected file")
        out.append(q)
    if not out:
        raise ValueError(f"{p}: no questions")
    return out


# ── metrics ─────────────────────────────────────────────────────────────────

def _ref_matches(ref: str, expected: list[str]) -> bool:
    """True when a search ref is the file the question expects.

    Exact match, or one path is a tail of the other, but a suffix match only
    counts when the shorter side names a directory: otherwise a bare "x.md"
    would be credited to "notes/x.md" and inflate the metrics.
    """
    ref = ref.replace("\\", "/").lstrip("./")
    for e in expected:
        e = e.replace("\\", "/").lstrip("./")
        if ref == e:
            return True
        short, long = (ref, e) if len(ref) <= len(e) else (e, ref)
        if "/" in short and long.endswith("/" + short):
            return True
    return False


def hit_at_k(refs: list[str], expected: list[str], k: int) -> float:
    return 1.0 if any(_ref_matches(r, expected) for r in refs[:k]) else 0.0


def reciprocal_rank(refs: list[str], expected: list[str]) -> float:
    for i, ref in enumerate(refs, start=1):
        if _ref_matches(ref, expected):
            return 1.0 / i
    return 0.0


def percentile(values: list[float], p: float) -> float | None:
    """p90 of a small sample without a numpy dependency. None for no data."""
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(p / 100 * (len(ordered) - 1))))
    return ordered[idx]


# ── retrieval ───────────────────────────────────────────────────────────────

class _ConnView:
    """sync.search only touches ``.conn``. Keeps the harness on a read-only
    sqlite3 connection instead of sync.db.DB, whose __init__ runs migrations."""

    def __init__(self, conn) -> None:
        self.conn = conn


def available_modes(cfg) -> list[str]:
    modes = ["lexical"]
    if cfg.embed_model:
        modes.append("semantic")
    if cfg.embed_model and cfg.rerank_model:
        modes.append("hybrid")
    return modes


def mode_config(cfg, mode: str):
    """A config variant that forces one retrieval mode through search()."""
    if mode == "lexical":
        return dataclasses.replace(cfg, embed_model="", rerank_model="")
    if mode == "semantic":
        return dataclasses.replace(cfg, rerank_model="")
    return cfg


def run_retrieval(cfg, conn, questions: list[dict]) -> list[dict]:
    import sqlite3  # noqa: F401  (type context for _ConnView readers)

    from sync.search import search

    view = _ConnView(conn)
    records: list[dict] = []
    for q in questions:
        expected = q["expected"]["files"]
        for mode in available_modes(cfg):
            for boost in (True, False):
                started = time.perf_counter()
                try:
                    hits = search(mode_config(cfg, mode), view, q["question"],
                                  top_k=5, phrase_boost=boost)
                    refs = [h["ref"] for h in hits]
                    error = None
                except Exception as e:  # a mode that the endpoint lacks
                    refs, error = [], f"{type(e).__name__}: {e}"
                records.append({
                    "id": q["id"],
                    "kind": q.get("kind"),
                    "mode": mode,
                    "phrase_boost": boost,
                    "hit@1": hit_at_k(refs, expected, 1),
                    "hit@5": hit_at_k(refs, expected, 5),
                    "mrr": reciprocal_rank(refs, expected),
                    "refs": refs[:5],
                    "error": error,
                    "latency_s": round(time.perf_counter() - started, 3),
                })
    return records


def summarize_retrieval(records: list[dict]) -> list[dict]:
    groups: dict[tuple[str, bool], list[dict]] = {}
    for r in records:
        groups.setdefault((r["mode"], r["phrase_boost"]), []).append(r)
    rows = []
    for (mode, boost), rs in sorted(groups.items()):
        rows.append({
            "mode": mode,
            "phrase_boost": boost,
            "n": len(rs),
            "hit@1": round(statistics.mean(r["hit@1"] for r in rs), 3),
            "hit@5": round(statistics.mean(r["hit@5"] for r in rs), 3),
            "mrr": round(statistics.mean(r["mrr"] for r in rs), 3),
            "errors": sum(1 for r in rs if r["error"]),
        })
    return rows


# ── answers ─────────────────────────────────────────────────────────────────

def load_prices(path: Path) -> dict:
    if not path.exists():
        return {}
    import yaml

    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _cost(usage: dict, prices: dict) -> float | None:
    """USD for one answer, or None when no price is known for its model."""
    entry = prices.get(usage.get("model") or "")
    if not entry:
        return None
    prompt = usage.get("prompt_tokens") or 0
    completion = usage.get("completion_tokens") or 0
    return round(
        prompt / 1_000_000 * float(entry.get("input_per_million") or 0)
        + completion / 1_000_000 * float(entry.get("output_per_million") or 0),
        6,
    )


def run_answers(cfg, db, questions: list[dict], prices: dict) -> list[dict]:
    from agent.chat import run_turn

    records: list[dict] = []
    for q in questions:
        expected = q["expected"]
        course_id = None
        if q.get("course"):
            row = db.conn.execute(
                "SELECT id FROM courses WHERE code = ?", (q["course"],)
            ).fetchone()
            course_id = row["id"] if row else None

        events: list[tuple[str, dict]] = []

        def emit(event, data, _sink=events):
            _sink.append((event, data))

        started = time.perf_counter()
        try:
            answer, _messages = run_turn(
                cfg, db, q["question"], course_id=course_id,
                verbose=False, emit=emit)
            error = None
        except Exception as e:
            answer, error = "", f"{type(e).__name__}: {e}"
        latency = round(time.perf_counter() - started, 3)

        done = next((d for e, d in events if e == "done"), {}) or {}
        usage = dict(done.get("usage") or {})
        usage["model"] = done.get("model") or cfg.llm_model
        cites = done.get("citations") or []
        expected_pages = expected.get("pages") or []

        cite_files = [c.get("ref") or c.get("path") or "" for c in cites]
        cite_ok = any(_ref_matches(f, expected["files"]) for f in cite_files)
        if cite_ok and expected_pages:
            cite_ok = any(
                c.get("page") in expected_pages
                for c in cites
                if _ref_matches(c.get("ref") or c.get("path") or "",
                                expected["files"])
            )
        contains = expected.get("answer_contains") or []
        mentions = [s for s in contains if s.lower() in (answer or "").lower()]

        records.append({
            "id": q["id"],
            "kind": q.get("kind"),
            "citation_ok": bool(cite_ok),
            "answer_contains": len(mentions),
            "answer_contains_expected": len(contains),
            "all_expected_strings": (
                len(mentions) == len(contains) if contains else None),
            "tool_calls": sum(1 for e, _ in events if e == "tool_start"),
            "latency_s": latency,
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "cost_usd": _cost(usage, prices),
            "error": error,
            # Deliberately NOT storing the answer text: results files could be
            # shared, and an answer quotes course content.
        })
    return records


def summarize_answers(records: list[dict]) -> dict:
    latencies = [r["latency_s"] for r in records if r["error"] is None]
    costs = [r["cost_usd"] for r in records if r["cost_usd"] is not None]
    tokens = [r["prompt_tokens"] + r["completion_tokens"] for r in records
              if r["prompt_tokens"] is not None and r["completion_tokens"] is not None]
    p90 = percentile(latencies, 90)
    return {
        "n": len(records),
        "errors": sum(1 for r in records if r["error"]),
        "citation_ok": round(
            statistics.mean(1.0 if r["citation_ok"] else 0.0 for r in records), 3)
        if records else None,
        "latency_median_s": (round(statistics.median(latencies), 2)
                             if latencies else None),
        "latency_p90_s": round(p90, 2) if p90 is not None else None,
        "tokens_total": sum(tokens) if tokens else None,
        "cost_usd_total": round(sum(costs), 4) if costs else None,
    }


# ── output ──────────────────────────────────────────────────────────────────

def markdown_summary(result: dict) -> str:
    lines = [f"# Eval {result['started_at']}", ""]
    lines.append(f"Questions: {result['question_count']}. "
                 f"Modes: {', '.join(result['modes'])}.")
    lines += ["", "## Retrieval", "",
              "| mode | phrase boost | n | hit@1 | hit@5 | MRR | errors |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
    for row in result.get("retrieval_summary") or []:
        lines.append(
            f"| {row['mode']} | {'on' if row['phrase_boost'] else 'off'} "
            f"| {row['n']} | {row['hit@1']} | {row['hit@5']} | {row['mrr']} "
            f"| {row['errors']} |")
    answers = result.get("answer_summary")
    lines += ["", "## Answers", ""]
    if not answers:
        lines.append("Skipped: no LLM endpoint configured.")
    else:
        lines.append(f"- answered: {answers['n']} (errors: {answers['errors']})")
        lines.append(f"- citation matched the expected file: {answers['citation_ok']}")
        lines.append(f"- latency median / p90: {answers['latency_median_s']}s / "
                     f"{answers['latency_p90_s']}s")
        if answers["tokens_total"] is not None:
            lines.append(f"- tokens: {answers['tokens_total']} total")
        if answers["cost_usd_total"] is not None:
            lines.append(f"- cost: ${answers['cost_usd_total']} total "
                         f"(from eval/prices.yaml)")
        else:
            lines.append("- cost: no eval/prices.yaml entry for the model, "
                         "so tokens only")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Campus eval: retrieval metrics, plus answer metrics when "
                    "an LLM endpoint is configured")
    ap.add_argument("--questions", default=str(DEFAULT_QUESTIONS))
    ap.add_argument("--prices", default=str(DEFAULT_PRICES))
    ap.add_argument("--out", default=str(DEFAULT_RESULTS))
    ap.add_argument("--no-answer", action="store_true",
                    help="retrieval metrics only, never call the model")
    args = ap.parse_args(argv)

    from sync.config import Config
    from sync.db import DB

    cfg = Config.load()
    questions = load_questions(args.questions)

    conn = __import__("sqlite3").connect(str(cfg.db_path))
    conn.row_factory = __import__("sqlite3").Row
    try:
        retrieval = run_retrieval(cfg, conn, questions)
    finally:
        conn.close()

    answer_records: list[dict] = []
    answer_summary = None
    if cfg.llm_endpoints() and not args.no_answer:
        db = DB(cfg.db_path)
        try:
            answer_records = run_answers(
                cfg, db, questions, load_prices(Path(args.prices)))
        finally:
            db.close()
        answer_summary = summarize_answers(answer_records)

    result = {
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "question_count": len(questions),
        "modes": available_modes(cfg),
        "retrieval_summary": summarize_retrieval(retrieval),
        "retrieval": retrieval,
        "answer_summary": answer_summary,
        "answers": answer_records,
    }

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = out_dir / f"{stamp}.json"
    md_path = out_dir / f"{stamp}.md"
    json_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    summary = markdown_summary(result)
    md_path.write_text(summary, encoding="utf-8")

    print(summary)
    print(f"Wrote {json_path.relative_to(REPO)} and {md_path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
