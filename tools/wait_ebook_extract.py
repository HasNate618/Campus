#!/usr/bin/env python3
"""Wait for the pdf-extractor's in-flight job (our e-book, 148 pages) to
finish, then pull the markdown from the jobs API and write the .md sibling +
mark the file processed. The sync's PUT timed out at 120s, so without this
the extraction result would be lost."""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sync.config import Config
from sync.db import DB

JOBS_URL = "http://pdf-extractor:8000/api/jobs"  # container DNS; host: 127.0.0.1:8001


def main() -> int:
    cfg = Config.load()
    db = DB(cfg.db_path)
    row = db.conn.execute(
        "SELECT id, path FROM files WHERE path LIKE '%Level_up%'").fetchone()
    if not row:
        print("e-book file row not found")
        return 1
    target = Path(row["path"]).name.replace("_", " ")
    print(f"waiting for job containing: {target!r}")
    deadline = time.time() + 5400  # 90 min max
    while time.time() < deadline:
        try:
            jobs = json.load(urllib.request.urlopen(JOBS_URL, timeout=10))
        except Exception as e:
            print("jobs fetch failed:", e)
            time.sleep(20)
            continue
        for j in jobs:
            if "Level_up" in j.get("filename", "") or "e-book" in j.get("filename", ""):
                if j.get("status") == "done":
                    content = j.get("content") or ""
                    if not content:
                        print("job done but no content")
                        return 1
                    md = (cfg.data_root / row["path"]).with_suffix(".md")
                    md.write_text(content, encoding="utf-8")
                    db.conn.execute(
                        "UPDATE files SET processed=1 WHERE id=?", (row["id"],))
                    db.conn.commit()
                    print(f"SAVED {md} ({len(content)} chars); processed=1")
                    return 0
                print(f"  in flight: {j['filename'][:45]} {j.get('pages_done')}/{j.get('pages_total')}")
                break
        time.sleep(45)
    print("timed out waiting")
    return 1


if __name__ == "__main__":
    sys.exit(main())
