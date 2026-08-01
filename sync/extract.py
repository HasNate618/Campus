"""PDF extraction CLI + bifrost model listing."""
from __future__ import annotations

import argparse
import sys

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
    from sync.token_store import TokenStore
    from sync.d2l import D2LClient
    from sync.sync import SyncEngine

    ap = argparse.ArgumentParser(description="Extract PDFs to markdown (keeps originals)")
    ap.add_argument("--code", help="course code filter")
    ap.add_argument("--file", help="specific file (path under data_root)")
    ap.add_argument("--max-mb", type=float, help="size cap in MB (default: config)")
    args = ap.parse_args()

    cfg = Config.load()
    store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
    # token not needed for extraction — pass a stub so D2LClient can init
    client = D2LClient(cfg.base_url, store.load)
    db = DB(cfg.db_path)
    engine = SyncEngine(cfg, db, client)
    try:
        return engine.extract(code=args.code, file_path=args.file, max_mb=args.max_mb)
    finally:
        client.close()
        db.close()


if __name__ == "__main__":
    sys.exit(main())
