#!/usr/bin/env python3
"""Dev tool: run the AI digest over announcements already in the DB.

The H1 crash (category CHECK) left 24 SE 2250B announcements undigested.
This backfills memory_facts + sync log + ntfy from them, and validates
the digest pipeline with the configured model. No deletions, idempotent-ish.
"""
import sys

from sync.config import Config
from sync.db import DB
from sync.token_store import TokenStore
from sync.d2l import D2LClient
from sync.sync import SyncEngine

cfg = Config.load()
store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
client = D2LClient(cfg.base_url, store.load)
db = DB(cfg.db_path)
engine = SyncEngine(cfg, db, client)

course = db.get_course_by_code("SE 2250B")
rows = db.conn.execute(
    "SELECT title, course_id FROM announcements WHERE course_id=?",
    (course["id"],),
).fetchall()
engine.deltas = [
    {"kind": "announcement", "title": r["title"], "course_code": "SE 2250B"}
    for r in rows
]
print(f"digesting {len(engine.deltas)} announcements with model={engine.model}")

run_id = db.start_sync(trigger="manual")
engine.digest_and_log(run_id, [course])

facts = db.conn.execute(
    "SELECT fact, category, source FROM memory_facts ORDER BY id DESC LIMIT 15"
).fetchall()
print(f"\n{len(facts)} recent memory_facts:")
for f in facts:
    print(f"  [{f['category']:12}] {f['fact'][:90]}")

import glob
log = sorted(glob.glob("{data_root}/sync_logs/*.md"))[-1]
print(f"\nsync log: {log}")
print(open(log).read()[:800])
