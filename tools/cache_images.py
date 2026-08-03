#!/usr/bin/env python3
"""Download Brightspace-hosted images into the course folder and rewrite the
html/description srcs to local /api/assets paths — so images work without a
live proxy/session (offline, cached locally).

Scans: module descriptions (DB) + *.html files on disk. Downloads via the
session cookies captured at auth time (cookies.json).
"""
import json
import re
import sys
import urllib.parse
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sync.config import Config
from sync.db import DB

IMG_RE = re.compile(r'(<img[^>]+src=")([^"]+)"', re.IGNORECASE)
HOSTS = ("westernu.brightspace.com", "s.brightspace.com")


def _session_headers(cfg: Config) -> dict:
    cookie_file = Path(cfg.token_dir) / "cookies.json"
    headers = {"User-Agent": "Campus/0.1"}
    if cookie_file.exists():
        try:
            data = json.loads(cookie_file.read_text())
            parts = [f"{c['name']}={c['value']}" for c in data.get("cookies", [])
                     if "brightspace.com" in c.get("domain", "")]
            if parts:
                headers["Cookie"] = "; ".join(parts)
        except Exception:
            pass
    return headers


def _safe_name(url: str) -> str:
    name = urllib.parse.unquote(url.split("/")[-1].split("?")[0])
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")
    return name or "image.png"


def _download(url: str, dest: Path, headers: dict) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        r = httpx.get(url, headers=headers, timeout=30, follow_redirects=False)
        if r.status_code != 200 or b"<!DOCTYPE" in r.content[:200]:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(r.content)
        return True
    except Exception:
        return False


def cache_course_images(cfg: Config, db: DB, course_id: int) -> dict:
    stats = {"downloaded": 0, "rewritten_files": 0, "rewritten_descs": 0, "failed": 0}
    course = db.conn.execute("SELECT * FROM courses WHERE id=?", (course_id,)).fetchone()
    if not course:
        return stats
    course_dir = cfg.data_root / course["term"] / course["code"].replace(" ", "")
    assets_dir = course_dir / "_assets"
    headers = _session_headers(cfg)

    seen: dict[str, str] = {}  # original url -> local path

    def local_for(url: str) -> str | None:
        if url in seen:
            return seen[url]
        name = _safe_name(url)
        dest = assets_dir / name
        if not _download(url, dest, headers):
            stats["failed"] += 1
            seen[url] = ""
            return None
        seen[url] = f"/api/assets/{course['term']}/{course['code'].replace(' ', '')}/_assets/{name}"
        stats["downloaded"] += 1
        return seen[url]

    def rewrite(html: str) -> str:
        def repl(m: re.Match) -> str:
            src = m.group(2)
            if not any(h in src for h in HOSTS):
                return m.group(0)
            local = local_for(src)
            if not local:
                return m.group(0)
            return f'{m.group(1)}{local}"'
        return IMG_RE.sub(repl, html)

    # 1) module descriptions in the DB
    for row in db.conn.execute(
            "SELECT id, description FROM content_nodes WHERE course_id=? AND description IS NOT NULL",
            (course_id,)).fetchall():
        if not row["description"] or "brightspace.com" not in row["description"]:
            continue
        new_desc = rewrite(row["description"])
        if new_desc != row["description"]:
            db.conn.execute("UPDATE content_nodes SET description=? WHERE id=?",
                            (new_desc, row["id"]))
            stats["rewritten_descs"] += 1
    db.conn.commit()

    # 2) html files on disk
    for f in course_dir.rglob("*.html"):
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "brightspace.com" not in text:
            continue
        new_text = rewrite(text)
        if new_text != text:
            f.write_text(new_text, encoding="utf-8")
            stats["rewritten_files"] += 1
    return stats


def main() -> int:
    cfg = Config.load()
    db = DB(cfg.db_path)
    total = {"downloaded": 0, "rewritten_files": 0, "rewritten_descs": 0, "failed": 0}
    for row in db.conn.execute("SELECT id, code FROM courses").fetchall():
        s = cache_course_images(cfg, db, row["id"])
        print(f"{row['code']}: {s}")
        for k in total:
            total[k] += s[k]
    print(f"TOTAL: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
