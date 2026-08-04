"""Campus sync — deterministic Brightspace pull (H1 pilot).

Usage:  python -m sync  [--code SE 2250B] [--dry-run]

Pipeline per HANDOFF.md: enrollments → match pilot course → content
tree → download files → dropbox → news → syllabus → upsert SQLite →
pdf-extractor → AI digest → sync log + ntfy. All deterministic except
auth (manual, Duo). Deltas only — sha256 change detection.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

import httpx

from sync.config import Config
from sync.d2l import D2LClient, D2LError
from sync.db import DB
from sync.token_store import TokenStore

TOPIC_TYPE_MAP = {1: "file", 2: "link", 3: "link"}


def _safe_name(s: str, max_len: int = 80) -> str:
    s = re.sub(r'[<>:"/\\|?*]', "_", s).strip().strip(".")
    return s[:max_len] or "untitled"


def _norm_code(code: str) -> str:
    return re.sub(r"\s+", "", code).upper()


def _extract_code(name: str) -> str:
    """'SE 2250B 001 LEC FW25: SOFTWARE CONSTRUCTION' -> 'SE2250B'."""
    head = (name or "").split(":")[0]
    m = re.match(r"([A-Z]+\s*\d{4}[A-Z]?)", head)
    return _norm_code(m.group(1)) if m else ""


class SyncEngine:
    def __init__(self, cfg: Config, db: DB, client: D2LClient, model: str | None = None):
        self.cfg = cfg
        self.db = db
        self.client = client
        self.model = model or cfg.bifrost_model  # --model flag overrides config
        self.stats = {"courses_processed": 0, "files_new": 0,
                      "files_changed": 0, "announcements_new": 0,
                      "facts_added": 0, "pdfs_extracted": 0}
        self.deltas: list[dict] = []  # for the AI digest

    # ── enrollments ─────────────────────────────────────────────────────
    def fetch_enrollments(self, active_only: bool = False) -> list[dict]:
        items: list[dict] = []
        bookmark = None
        while True:
            # no isActive filter: pilot course (SE 2250B) is a past enrollment
            path = self.client.lp("/enrollments/myenrollments/?orgUnitTypeId=3")
            if active_only:
                path = path.replace("?", "?isActive=true&", 1)
            if bookmark:
                path += f"&bookmark={bookmark}"
            data = self.client.get(path)
            items.extend(data.get("Items", []))
            paging = data.get("PagingInfo") or {}
            if paging.get("HasMoreItems") and paging.get("Bookmark"):
                bookmark = paging["Bookmark"]
            else:
                break
        return items

    def match_course(self, enrollments: list[dict], code: str) -> dict | None:
        target = _norm_code(code)
        for e in enrollments:
            ou = e.get("OrgUnit", {})
            candidates = {_norm_code(ou.get("Code", ""))}
            # Western FW25+ enrollments use UGRD_xxxx codes; the human course
            # code ("SE 2250B") only appears in the Name field
            name_code = _extract_code(ou.get("Name", ""))
            if name_code:
                candidates.add(name_code)
            if target in candidates:
                return ou
        return None

    # ── content tree ────────────────────────────────────────────────────
    def sync_content(self, course_id: int, org_unit: int, course_dir: Path) -> None:
        root = self.client.get(self.client.le(org_unit, "/content/root/"))
        content_dir = course_dir / "content"
        content_dir.mkdir(parents=True, exist_ok=True)

        def walk(modules: list, parent_bs_id: int | None, path_parts: list[str],
                 sort_base: int = 0) -> None:
            for idx, item in enumerate(modules):
                bs_id = item.get("Id")
                # Brightspace sends Description as {Text, Html} — prefer the
                # HTML: module landing pages (course schedule tables, banner
                # images, embedded hyperlinks like the Git/Unity tutorial)
                # only survive in the Html form; .Text flattens them.
                desc_obj = item.get("Description") or {}
                description = desc_obj.get("Html") or desc_obj.get("Text") or None
                node = {
                    "brightspace_id": bs_id,
                    "parent_brightspace_id": parent_bs_id,
                    "title": item.get("Title", "untitled"),
                    "description": description,
                    "is_hidden": item.get("IsHidden", False),
                    "is_locked": item.get("IsLocked", False),
                    "sort_order": sort_base + idx,
                }
                if item.get("Type") == 0:  # module
                    node["node_type"] = "module"
                    node["due_at"] = item.get("ModuleDueDate")
                    self.db.upsert_content_node(course_id, node)
                    children = []
                    try:
                        children = self.client.get(
                            self.client.le(org_unit, f"/content/modules/{bs_id}/structure/"))
                    except D2LError:
                        pass
                    walk(children, bs_id, path_parts + [_safe_name(item.get("Title", ""))], 0)
                else:  # topic
                    ttype = item.get("TopicType", 0)
                    node["node_type"] = "topic"
                    node["topic_type"] = TOPIC_TYPE_MAP.get(ttype, "other")
                    node["due_at"] = item.get("DueDate") or item.get("EndDate")
                    if ttype in (2, 3):
                        node["url"] = item.get("Url")
                    self.db.upsert_content_node(course_id, node)
                    if ttype == 1:  # file topic — download
                        self._download_topic_file(course_id, org_unit, bs_id,
                                                  item.get("Title", ""), content_dir, path_parts)

        walk(root, None, [])

    def _download_topic_file(self, course_id: int, org_unit: int, topic_id: int,
                             title: str, content_dir: Path, path_parts: list[str]) -> None:
        # fast path: topic already has a linked file on disk — skip the download
        # (the July-era sync downloaded everything every run; this makes syncs
        # seconds once linkage is complete)
        linked = self.db.conn.execute(
            """SELECT f.id FROM files f
               JOIN content_nodes cn ON cn.id = f.content_node_id
               WHERE cn.course_id=? AND cn.brightspace_id=?""",
            (course_id, topic_id)).fetchone()
        if linked:
            p = Path(self.cfg.data_root) / self.db.conn.execute(
                "SELECT path FROM files WHERE id=?", (linked["id"],)).fetchone()["path"]
            if p.exists():
                return
        try:
            resp = self.client.get_raw(self.client.le(org_unit, f"/content/topics/{topic_id}/file"))
        except D2LError:
            return
        body = resp.content
        if len(body) > self.cfg.max_file_size:
            return
        # filename from Content-Disposition, else topic title (unquote %20 etc)
        disp = resp.headers.get("content-disposition", "")
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disp)
        raw_name = m.group(1) if m else title
        filename = _safe_name(urllib.parse.unquote(raw_name))
        subdir = content_dir.joinpath(*path_parts) if path_parts else content_dir
        subdir.mkdir(parents=True, exist_ok=True)
        rel = str((subdir / filename).relative_to(self.cfg.data_root))
        sha = hashlib.sha256(body).hexdigest()
        # link the file to its content topic (topic_id == the content node's
        # brightspace id, upserted earlier in the walk) so the UI can show
        # what file a topic has
        node = self.db.conn.execute(
            "SELECT id FROM content_nodes WHERE course_id=? AND brightspace_id=?",
            (course_id, topic_id)).fetchone()
        file_id, is_new = self.db.upsert_file(
            course_id, rel, "slide" if filename.lower().endswith((".pdf", ".ppt", ".pptx")) else "other",
            "brightspace", sha, len(body), node["id"] if node else None)
        if is_new:
            (subdir / filename).write_bytes(body)
            self.stats["files_new"] += 1
            self.deltas.append({"kind": "file_new", "path": rel})
        else:
            existing = self.db.conn.execute(
                "SELECT sha256 FROM files WHERE id=?", (file_id,)).fetchone()
            if existing and existing["sha256"] != sha:
                (subdir / filename).write_bytes(body)
                self.stats["files_changed"] += 1
                self.deltas.append({"kind": "file_changed", "path": rel})

    # ── dropbox (assignments) ───────────────────────────────────────────
    def sync_dropbox(self, course_id: int, org_unit: int) -> None:
        try:
            folders = self.client.get(self.client.le(org_unit, "/dropbox/folders/"))
        except D2LError:
            return
        for f in folders:
            if f.get("IsCategory", False):
                continue
            # Western's dropbox list omits "Instructions" entirely — the
            # assignment description lives in "CustomInstructions"
            # ({Text, Html}); the brightspace-mcp reads .Html there too.
            # Fall back to Instructions for D2L instances that still send it.
            desc = None
            for key in ("Instructions", "CustomInstructions"):
                obj = f.get(key)
                if isinstance(obj, dict):
                    desc = obj.get("Html") or obj.get("Text") or None
                    if desc:
                        break
            self.db.upsert_assignment(course_id, {
                "title": f.get("Name", "Assignment"),
                "description": desc,
                "due_at": f.get("DueDate"),
                "weight": None,
                "brightspace_folder_id": f.get("Id"),
                "url": f"{self.cfg.base_url}/d2l/lms/dropbox/user/folders/{f.get('Id')}/",
            })

    # ── news (announcements) ────────────────────────────────────────────
    def sync_news(self, course_id: int, org_unit: int) -> None:
        try:
            items = self.client.get(self.client.le(org_unit, "/news/"))
        except D2LError:
            return

        def author_of(n) -> str | None:
            # Western returns CreatedBy as int (user id) — handle both shapes
            created = n.get("CreatedBy")
            if isinstance(created, dict):
                return created.get("DisplayName")
            return None

        for n in items:
            body = (n.get("Body") or {}).get("Text", "")
            is_new = self.db.upsert_announcement(course_id, {
                "brightspace_id": n.get("Id"),
                "title": n.get("Title", "(announcement)"),
                "body": body,
                "author": author_of(n),
                "posted_at": n.get("StartDate"),
                "is_pinned": n.get("IsPinned", False),
            })
            if is_new:
                self.stats["announcements_new"] += 1
                self.deltas.append({"kind": "announcement",
                                    "title": n.get("Title"),
                                    "body": body[:800],  # excerpt for the digest
                                    "posted_at": n.get("StartDate")})

    # ── syllabus ────────────────────────────────────────────────────────
    def sync_syllabus(self, course_id: int, org_unit: int, course_dir: Path) -> None:
        try:
            data = self.client.get(self.client.le(org_unit, "/syllabus/"))
        except D2LError:
            return
        # data can be list of sections with Html, or plain JSON
        parts = []
        if isinstance(data, list):
            for s in data:
                html = s.get("Html") or s.get("Description") or ""
                parts.append(f"## {s.get('Title', '')}\n\n{html}")
        elif isinstance(data, dict) and data.get("Sections"):
            for s in data["Sections"]:
                parts.append(f"## {s.get('Title', '')}\n\n{s.get('Html', '')}")
        if parts:
            (course_dir / "syllabus.html").write_text("\n\n".join(parts))
            self.db.audit("sync", "courses", course_id, "syllabus_saved")

    # ── pdf-extractor (cloud engine by default; serialized queue after sync)
    def extract_pdf(self, file_row) -> bool:
        """PUT raw PDF to pdf-extractor → write .md beside it → mark processed.
        Original PDF is always kept for viewing. (No engine param — the
        pdf-extractor uses its cloud engine by default; local mode caused
        high CPU load on the host and was removed.)"""
        path = Path(self.cfg.data_root) / file_row["path"]
        if not path.exists() or path.suffix.lower() != ".pdf":
            self.db.mark_processed(file_row["id"])
            return False
        try:
            # Long PDFs (e-books, big slide decks) need a long PUT — the
            # worker is a single VLM at ~10s/page; a 148-page book takes
            # ~25 min. The old fixed 120s timed out and the pdf-extractor
            # dropped the in-flight job, so big files never extracted.
            size_mb = path.stat().st_size / (1024 * 1024)
            timeout = 3600 if size_mb > 2 else 120
            r = httpx.put(f"{self.cfg.pdf_extractor_url}/process",
                          content=path.read_bytes(), timeout=timeout)
            r.raise_for_status()
            data = r.json()
            content = data.get("page_content", "")
            if not content:
                self.db.mark_processed(file_row["id"])
                return False
            md = path.with_suffix(".md")
            md.write_text(content)
            self.db.mark_processed(file_row["id"])
            excerpt = content[: self.cfg.digest_pdf_excerpt_chars]
            self.deltas.append({"kind": "pdf_extracted", "path": str(md),
                                "excerpt": excerpt})
            return True
        except Exception:
            return False

    def run_extraction_queue(self, course_id: int | None = None) -> int:
        """Serialize extraction of unprocessed PDFs (one at a time — the
        pdf-extractor worker is single and local engine is slow). Never
        blocks the sync critical path: called after digest."""
        done = 0
        rows = self.db.unprocessed_files(course_id) if course_id else \
            self.db.conn.execute("SELECT * FROM files WHERE processed=0").fetchall()
        for row in rows:
            path = Path(self.cfg.data_root) / row["path"]
            if path.suffix.lower() != ".pdf":
                self.db.mark_processed(row["id"])  # not a PDF — nothing to extract
                continue
            if path.stat().st_size > self.cfg.max_extract_size:
                self.db.mark_processed(row["id"])  # too big — skip permanently
                continue
            if self.extract_pdf(row):
                done += 1
                print(f"  extracted: {row['path']}", flush=True)
        self.stats["pdfs_extracted"] = done
        return done

    def _extraction_bg(self) -> None:
        """Detach extraction as its OWN process so it survives the sync CLI
        exiting. The pdf-extractor worker is single and slow (VLM page-by-
        page); the extract CLI pings ntfy when done."""
        try:
            log = self.cfg.data_root / "sync_logs" / "extraction.log"
            log.parent.mkdir(parents=True, exist_ok=True)
            with open(log, "a") as f:
                subprocess.Popen(
                    [sys.executable, "-u", "-m", "sync", "extract"],
                    cwd=str(Path(__file__).resolve().parent.parent),
                    stdout=f, stderr=subprocess.STDOUT,
                    start_new_session=True)
        except Exception as e:
            print(f"  extraction spawn failed: {e}")

    def extract(self, code: str | None = None, file_path: str | None = None,
                max_mb: float | None = None) -> int:
        """Extract PDFs to markdown. Filters: course code, specific file,
        or size cap. Keeps originals. Idempotent (processed files skipped)."""
        limit = (max_mb or self.cfg.max_extract_size / 1024 / 1024) * 1024 * 1024
        done, skipped = 0, 0
        if file_path:
            rel = str(Path(file_path).relative_to(self.cfg.data_root))
            rows = self.db.conn.execute(
                "SELECT * FROM files WHERE path=?", (rel,)).fetchall()
        else:
            q = "SELECT * FROM files WHERE kind='slide' OR kind='other'"
            if code:
                course = self.db.get_course_by_code(code)
                if not course:
                    print(f"Unknown course: {code}")
                    return 2
                q += f" AND course_id={course['id']}"
            rows = self.db.conn.execute(q).fetchall()
        for row in rows:
            path = Path(self.cfg.data_root) / row["path"]
            if path.suffix.lower() != ".pdf" or row["processed"]:
                continue
            if path.stat().st_size > limit:
                print(f"  skip (>{max_mb or self.cfg.max_extract_size/1024/1024:.0f}MB): {row['path']}")
                skipped += 1
                continue
            if self.extract_pdf(row):
                done += 1
                print(f"  extracted: {row['path']}")
            else:
                print(f"  FAILED: {row['path']}")
        print(f"Extract done: {done} extracted, {skipped} skipped by size")
        return 0

    def run(self, code: str | None = None, dry_run: bool = False) -> int:
        run_id = self.db.start_sync()
        try:
            enrollments = self.fetch_enrollments()
            courses = [self.db.get_course_by_code(code)] if code else self.db.get_pilot_courses()
            if not courses:
                print("No course matched. Pass --code SE 2250B or mark a course is_pilot=1")
                return 2

            if not dry_run:
                self._notify(f"Sync started — {len(courses)} course(s)", "default")

            for course in courses:
                ou = self.match_course(enrollments, course["code"])
                if not ou:
                    print(f"  {course['code']}: NOT in enrollments (past term?) — skipping")
                    continue
                org_unit = ou["Id"]
                if not course["brightspace_org_unit_id"]:
                    self.db.link_org_unit(course["id"], org_unit)
                    self.db.audit("sync", "courses", course["id"], "link_org_unit",
                                  {"org_unit_id": org_unit})

                course_dir = self.cfg.data_root / course["term"] / course["code"].replace(" ", "")
                course_dir.mkdir(parents=True, exist_ok=True)
                print(f"  {course['code']} (orgUnit {org_unit})")

                if dry_run:
                    continue
                self.sync_content(course["id"], org_unit, course_dir)
                self.sync_dropbox(course["id"], org_unit)
                self.sync_news(course["id"], org_unit)
                self.sync_syllabus(course["id"], org_unit, course_dir)
                # NOTE: extraction is NOT done here — it runs as a detached
                # background job after the digest (see _extraction_bg). The
                # old inline loop made syncs hang on the single pdf-extractor
                # VLM worker for 10min per file.
                # cache Brightspace-hosted images locally (best-effort; needs
                # session cookies from auth) so html renders offline
                try:
                    from tools.cache_images import cache_course_images
                    cache_course_images(self.cfg, self.db, course["id"])
                except Exception:
                    pass
                self.stats["courses_processed"] += 1

            if not dry_run:
                self.digest_and_log(run_id, courses)
                # extraction is a BACKGROUND job — never blocks the sync.
                # The pdf-extractor worker is single and slow (VLM page-by-
                # page); an inline queue made every sync hang for minutes.
                if self.cfg.auto_extract_pdfs:
                    print("  extraction queued (background)...", flush=True)
                    self._extraction_bg()
                # memory card regen (only when something changed)
                if self.stats["facts_added"] > 0 or self.deltas:
                    try:
                        from agent.memory import regenerate_cards
                        regenerate_cards(self.cfg, self.db, courses=[c["id"] for c in courses])
                    except Exception as e:
                        print(f"  card regen skipped: {e}")
                self._notify(
                    f"Sync done — {self.stats['files_new']} new files, "
                    f"{self.stats['files_changed']} changed, "
                    f"{self.stats['announcements_new']} announcements, "
                    f"{self.stats['facts_added']} facts"
                    + (", extraction running" if self.cfg.auto_extract_pdfs else ""),
                    "green")
            self.db.finish_sync(run_id, "ok", **self.stats)
            print(f"\nSync OK: {json.dumps(self.stats)}")
            return 0
        except Exception as e:
            self.db.finish_sync(run_id, "failed", error=str(e))
            print(f"Sync FAILED: {e}", file=sys.stderr)
            return 1

    def digest_and_log(self, run_id: int, courses) -> None:
        """Bifrost AI pass: delta digest → memory_facts + markdown sync log.
        (Notification is sent once by run(), covering the whole sync.)"""
        if not self.deltas:
            (self.cfg.data_root / "sync_logs").mkdir(parents=True, exist_ok=True)
            log_path = self.cfg.data_root / "sync_logs" / f"{time.strftime('%Y-%m-%d')}.md"
            log_path.write_text(f"# Sync {time.strftime('%Y-%m-%d %H:%M')}\n\nNothing new in any course.\n")
            self.db.conn.execute("UPDATE sync_runs SET log_path=? WHERE id=?", (str(log_path), run_id))
            self.db.conn.commit()
            return

        prompt = (
            "You are the digest engine for a student's course-sync system.\n"
            f"Today is {time.strftime('%Y-%m-%d')}. The changes below come from a Brightspace sync.\n"
            "Return STRICT JSON: {\"facts\": [{\"fact\": str, \"category\": str, "
            "\"confidence\": float}], \"log\": str}\n"
            "facts: short durable facts worth remembering (deadline changes, announcements).\n"
            "category must be one of: general, scheduling, grading, course-policy, "
            "prof-note, exam, assignment, logistics.\n"
            "TIME RULES (critical):\n"
            "- Resolve relative dates ('tomorrow', 'next week', 'Friday') into ABSOLUTE dates "
            "(YYYY-MM-DD) using today's date.\n"
            "- Convert ephemeral instructions ('install X before class') into dated facts "
            "('install X by YYYY-MM-DD').\n"
            "- SKIP any fact whose relevance window has already passed, or that has no date "
            "and is a one-off instruction.\n"
            "- Never store 'tomorrow'/'next week' — always the concrete date.\n"
            "log: a 3-6 line markdown sync log for the student (no preamble, no 'Lesson').\n"
            f"Changes:\n{json.dumps(self.deltas, indent=1)}"
        )
        try:
            r = httpx.post(f"{self.cfg.bifrost_url}/chat/completions",
                           json={"model": self.model,
                                 "messages": [{"role": "user", "content": prompt}]},
                           timeout=120)
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            content = content[content.find("{"):content.rfind("}") + 1]
            result = json.loads(content)
        except Exception as e:
            print(f"  digest failed: {e} — body: {r.text[:200] if 'r' in dir() else 'no response'}")
            return

        allowed = {"general", "scheduling", "grading", "course-policy",
                   "prof-note", "exam", "assignment", "logistics"}
        for f in result.get("facts", []):
            category = f.get("category", "general")
            if category not in allowed:
                category = "general"  # model strayed — coerce, don't crash
            self.db.conn.execute(
                """INSERT INTO memory_facts (course_id, fact, category, confidence, source)
                   VALUES (?,?,?,?,?)""",
                (courses[0]["id"] if len(courses) == 1 else None, f["fact"],
                 category, float(f.get("confidence", 0.5)),
                 f"sync:{time.strftime('%Y-%m-%d')}"),
            )
            self.stats["facts_added"] += 1
        self.db.conn.commit()

        (self.cfg.data_root / "sync_logs").mkdir(parents=True, exist_ok=True)
        log_path = self.cfg.data_root / "sync_logs" / f"{time.strftime('%Y-%m-%d')}.md"
        log_path.write_text(f"# Sync {time.strftime('%Y-%m-%d %H:%M')}\n\n{result.get('log', '')}\n")
        self.db.conn.execute("UPDATE sync_runs SET log_path=? WHERE id=?", (str(log_path), run_id))
        self.db.conn.commit()

    def _notify(self, message: str, priority: str = "default") -> None:
        try:
            httpx.post(f"{self.cfg.ntfy_url}/campus",
                       data=message.encode(),
                       headers={"Priority": priority, "Title": "Campus"},
                       timeout=10)
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser(description="Campus Brightspace sync (H1 pilot)")
    ap.add_argument("--code", help="course code to sync (default: all is_pilot)")
    ap.add_argument("--dry-run", action="store_true", help="enrollments + match only")
    ap.add_argument("--model", help="bifrost model for the digest (default: config)")
    args = ap.parse_args()

    cfg = Config.load()
    store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
    if store.needs_refresh():
        print("No valid token — run `python -m sync auth` first (Duo approval needed)")
        return 1

    client = D2LClient(cfg.base_url, store.load)
    client.initialize()
    db = DB(cfg.db_path)
    engine = SyncEngine(cfg, db, client, model=args.model)
    try:
        return engine.run(code=args.code, dry_run=args.dry_run)
    finally:
        client.close()
        db.close()


if __name__ == "__main__":
    sys.exit(main())
