"""PDF extraction CLI + bifrost model listing."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx


def list_models() -> int:
    from sync.config import Config

    cfg = Config.load()
    try:
        r = httpx.get(cfg.bifrost_url + "/models", timeout=15)
        r.raise_for_status()
        ids = sorted(m["id"] for m in r.json().get("data", []))
    except Exception as e:
        print(f"Failed to list models from {cfg.bifrost_url}: {e}")
        return 1
    print(f"Bifrost models ({len(ids)}):")
    for mid in ids:
        marker = "  <- default" if mid == cfg.bifrost_model else ""
        print(f"  {mid}{marker}")
    print("\nSet the digest model via config.yaml (bifrost_model) or `python -m sync sync --model M`.")
    return 0


def main() -> int:
    from sync.config import Config
    from sync.db import DB
    from sync.d2l import D2LClient
    from sync.sync import SyncEngine

    ap = argparse.ArgumentParser(description="Extract PDFs to markdown (keeps originals)")
    ap.add_argument("--code", help="course code filter")
    ap.add_argument("--file", help="specific file (path under data_root)")
    ap.add_argument("--max-mb", type=float, help="size cap in MB (default: config)")
    args = ap.parse_args()

    cfg = Config.load()
    db = DB(cfg.db_path)
    client = D2LClient(cfg.base_url, lambda: None)  # token not needed for extraction
    engine = SyncEngine(cfg, db, client)
    try:
        course_id = None
        if args.code:
            course = db.get_course_by_code(args.code)
            if not course:
                print(f"Unknown course: {args.code}")
                return 2
            course_id = course["id"]
        if args.file:
            rel = str(Path(args.file).relative_to(Path(cfg.data_root)))
            row = db.conn.execute("SELECT * FROM files WHERE path=?", (rel,)).fetchone()
            if not row:
                print(f"file not in catalog: {rel}")
                return 2
            ok = engine.extract_pdf(row)
            print("extracted" if ok else "FAILED", rel)
            return 0 if ok else 1
        n = engine.run_extraction_queue(course_id)
        print(f"extraction queue done: {n} extracted")
        # one completion ping (the sync's own ntfy already fired)
        try:
            import httpx as _h
            _h.post(f"{cfg.ntfy_url}/hippocampus",
                    json={"topic": "hippocampus", "message": f"Extraction done — {n} PDFs extracted",
                          "priority": "default"}, timeout=10)
        except Exception:
            pass
        return 0
    finally:
        client.close()
        db.close()


if __name__ == "__main__":
    sys.exit(main())
