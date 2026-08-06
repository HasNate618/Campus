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


def _media_bs_id(name: str) -> int:
    """Synthetic stable Brightspace id for module-media topic nodes (files
    materialized from description links). Hash-derived so re-syncs upsert
    instead of duplicating; can't collide with real content-tool ids."""
    return int(hashlib.sha1(name.encode()).hexdigest()[:8], 16)


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

    # ── embedded resources (PDFs linked inside content HTML) ─────────────
    EMBEDDED_EXTS = (".pdf", ".ppt", ".pptx", ".doc", ".docx", ".xlsx", ".xls", ".zip")

    def sync_embedded(self, course_id: int, org_unit: int, course_dir: Path) -> None:
        """Fetch course-content binaries linked inside downloaded HTML
        (Brightspace Elements Pages link the real deck statically, e.g.
        /content/enforced/{orgUnit}/Lectures/Version-Control-and-Git.pdf).
        Saves under content/, registers as a file on the owning topic node
        (so the dashboard gets a PDF entry), queues extraction, and rewrites
        the link to /api/assets so it opens locally instead of the raw URL."""
        content_dir = course_dir / "content"
        if not content_dir.exists():
            return
        try:
            from tools.cache_images import _session_headers
            headers = _session_headers(self.cfg)
        except Exception:
            return
        asset_base = f"/api/assets/{course_dir.relative_to(self.cfg.data_root)}"
        for html in sorted(content_dir.rglob("*.html")):
            try:
                raw = html.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            node = self.db.conn.execute(
                """SELECT f.content_node_id FROM files f WHERE f.path=?""",
                (str(html.relative_to(self.cfg.data_root)),)).fetchone()
            node_id = node["content_node_id"] if node else None
            rewritten = raw
            for url in re.findall(r'href="(https?://[^"]+)"', raw):
                # enforced URLs carry the enrollment suffix: /content/enforced/{org_unit}-{ENROLLMENT}/{path}
                m = re.match(rf"https?://[^/]+/content/enforced/{org_unit}[-A-Za-z0-9_]*/([^\"?#]+)", url)
                if not m:
                    continue
                path_part = urllib.parse.unquote(m.group(1))
                if not path_part.lower().endswith(self.EMBEDDED_EXTS):
                    continue
                filename = _safe_name(path_part.split("/")[-1])
                dest_dir = content_dir.joinpath(*path_part.split("/")[:-1])
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / filename
                rel = str(dest.relative_to(self.cfg.data_root))
                try:
                    resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=120)
                    resp.raise_for_status()
                except Exception:
                    continue
                # guard: a 200 with text/html is the D2L login/interstitial
                # page (stale session cookies) — never save HTML as a binary
                ctype = (resp.headers.get("content-type") or "").lower()
                if "html" in ctype:
                    continue
                body = resp.content
                if len(body) > self.cfg.max_file_size or not body:
                    continue
                sha = hashlib.sha256(body).hexdigest()
                kind = "slide" if filename.lower().endswith((".pdf", ".ppt", ".pptx")) else "other"
                file_id, is_new = self.db.upsert_file(
                    course_id, rel, kind, "brightspace", sha, len(body), node_id)
                if is_new:
                    dest.write_bytes(body)
                    self.stats["files_new"] += 1
                    self.deltas.append({"kind": "file_new", "path": rel})
                else:
                    existing = self.db.conn.execute(
                        "SELECT sha256 FROM files WHERE id=?", (file_id,)).fetchone()
                    if existing and existing["sha256"] != sha:
                        dest.write_bytes(body)
                        self.stats["files_changed"] += 1
                        self.deltas.append({"kind": "file_changed", "path": rel})
                if node_id is not None:
                    rewritten = rewritten.replace(
                        url, f"{asset_base}/{urllib.parse.quote(path_part)}", 1)
            if rewritten != raw:
                html.write_text(rewritten, encoding="utf-8")

    # ── module-description media (files/videos linked inside module HTML) ─
    # Some courses (SE 2203B) never attach files to content topics — the real
    # material is linked from module descriptions as /content/enforced/...
    # URLs and quickLink coursefile dialogs. The content walk + sync_embedded
    # (which scans on-disk *.html only) never see those, so the files were
    # neither downloaded nor registered. This pass materializes them:
    # download → save under content/Units/ → create a topic under the module →
    # register the file (extractable, indexable, chips in the tree) → rewrite
    # the stored description link to the local /api/assets URL. Idempotent:
    # one file per canonical filename (dedup across modules AND URL forms),
    # synthetic topic ids are hash-stable.
    MODULE_MEDIA_EXTS = (".pdf", ".ppt", ".pptx", ".doc", ".docx",
                         ".xlsx", ".xls", ".zip", ".mp4", ".webm", ".mov")

    def _fetch_media(self, url: str, headers: dict) -> bytes | None:
        """Session-cookie fetch of a Brightspace enforced URL; None on any
        failure or if the response is an HTML interstitial (login page)."""
        try:
            r = httpx.get(url, headers=headers, follow_redirects=False, timeout=120)
            if r.status_code != 200 or not r.content:
                return None
            if b"<!DOCTYPE" in r.content[:200]:
                return None
            if len(r.content) > self.cfg.max_file_size:
                return None
            ctype = (r.headers.get("content-type") or "").lower()
            if "html" in ctype:
                return None
            return r.content
        except Exception:
            return None

    def sync_module_media(self, course_id: int, org_unit: int, course_dir: Path) -> None:
        course = self.db.conn.execute(
            "SELECT term, code FROM courses WHERE id=?", (course_id,)).fetchone()
        if not course:
            return
        try:
            from tools.cache_images import _session_headers
            headers = _session_headers(self.cfg)
        except Exception:
            return
        code_dir = course["code"].replace(" ", "")
        enroll_suffix: str | None = None

        def canon_key(name: str) -> str:
            return re.sub(r"[^a-z0-9.]", "", name.lower())

        # pass 1: collect targets (one per canonical filename) + per-module refs
        targets: list[dict] = []
        by_key: dict[str, dict] = {}
        module_refs: list[tuple[int, str, dict]] = []  # (node row id, raw url, target)
        for row in self.db.conn.execute(
                "SELECT id, brightspace_id, description FROM content_nodes "
                "WHERE course_id=? AND node_type='module' AND description IS NOT NULL",
                (course_id,)).fetchall():
            desc = row["description"]
            if enroll_suffix is None:
                m = re.search(r"/content/enforced/(\d+-[A-Za-z0-9_]+)/", desc)
                if m:
                    enroll_suffix = m.group(1)
            for raw in re.findall(r'(?:href|src)="([^"]+)"', desc):
                if (raw.startswith("/api/assets") or raw.startswith("#")
                        or "youtube.com" in raw or "vimeo" in raw):
                    continue
                path_part = None
                m = re.match(
                    r"^(?:https?://[^/]+)?(/content/enforced/\d+-[A-Za-z0-9_]+/[^\"?#]+)", raw)
                if m:
                    path_part = urllib.parse.unquote(m.group(1))
                else:
                    q = re.search(
                        r"quickLink\.d2l\?[^\"']*type=coursefile[^\"']*fileId=([^&\"]+)", raw)
                    if q and enroll_suffix:
                        fid = urllib.parse.unquote(q.group(1)).replace("+", " ")
                        path_part = f"/content/enforced/{enroll_suffix}/{fid}"
                if not path_part:
                    continue
                name = path_part.split("/")[-1]
                if not name.lower().endswith(self.MODULE_MEDIA_EXTS):
                    continue
                key = canon_key(name)
                tgt = by_key.get(key)
                if tgt is None:
                    tgt = {
                        "name": name,
                        "fetch_url": self.cfg.base_url + path_part,
                        "is_video": name.lower().endswith((".mp4", ".webm", ".mov")),
                        "module_bs_id": row["brightspace_id"],
                    }
                    by_key[key] = tgt
                    targets.append(tgt)
                module_refs.append((row["id"], raw, tgt))
        if not targets:
            return

        # pass 2: download + register (topic under the FIRST referencing module)
        media_dir = course_dir / "content" / "Units"
        media_dir.mkdir(parents=True, exist_ok=True)
        asset_base = f"/api/assets/{course['term']}/{code_dir}/content/Units"
        rewrites: dict[int, list[tuple[str, str]]] = {}  # node row id -> [(raw, asset)]
        for tgt in targets:
            fname = _safe_name(tgt["name"])
            dest = media_dir / fname
            body = dest.read_bytes() if (dest.exists() and dest.stat().st_size > 0) else None
            if body is None:
                body = self._fetch_media(tgt["fetch_url"], headers)
                if body is None:
                    print(f"  media fetch failed: {tgt['fetch_url']}")
                    continue
                dest.write_bytes(body)
            sha = hashlib.sha256(body).hexdigest()
            bs_id = _media_bs_id(tgt["name"])
            node = self.db.conn.execute(
                "SELECT id FROM content_nodes WHERE course_id=? AND brightspace_id=?",
                (course_id, bs_id)).fetchone()
            if node is None:
                self.db.upsert_content_node(course_id, {
                    "brightspace_id": bs_id,
                    "parent_brightspace_id": tgt["module_bs_id"],
                    "node_type": "topic", "topic_type": "file",
                    "title": fname, "description": None,
                    "url": tgt["fetch_url"], "due_at": None,
                    "is_hidden": False, "is_locked": False,
                    "sort_order": 1000 + len(targets),
                })
                node = self.db.conn.execute(
                    "SELECT id FROM content_nodes WHERE course_id=? AND brightspace_id=?",
                    (course_id, bs_id)).fetchone()
            rel = f"{course['term']}/{code_dir}/content/Units/{fname}"
            kind = "slide" if fname.lower().endswith((".pdf", ".ppt", ".pptx")) else "other"
            file_id, is_new = self.db.upsert_file(
                course_id, rel, kind, "brightspace", sha, len(body), node["id"])
            if is_new:
                self.stats["files_new"] += 1
                self.deltas.append({"kind": "file_new", "path": rel})
            else:
                existing = self.db.conn.execute(
                    "SELECT sha256 FROM files WHERE id=?", (file_id,)).fetchone()
                if existing and existing["sha256"] != sha:
                    self.stats["files_changed"] += 1
                    self.deltas.append({"kind": "file_changed", "path": rel})
            asset = f"{asset_base}/{fname}"
            for row_id, raw, t in module_refs:
                if t is tgt:
                    rewrites.setdefault(row_id, []).append((raw, asset))

        # pass 3: rewrite stored descriptions to the local asset URLs
        for row_id, pairs in rewrites.items():
            row = self.db.conn.execute(
                "SELECT description FROM content_nodes WHERE id=?", (row_id,)).fetchone()
            desc = row["description"]
            for raw, asset in pairs:
                desc = desc.replace(f'"{raw}"', f'"{asset}"')
            self.db.conn.execute(
                "UPDATE content_nodes SET description=? WHERE id=?", (desc, row_id))
        self.db.conn.commit()
        print(f"  module media: {len(targets)} file(s) materialized, "
              f"{len(rewrites)} module description(s) rewritten")

    # ── dropbox (assignments) ───────────────────────────────────────────
    def _download_assignment_attachments(self, course_id: int, org_unit: int, folder_id: int,
                                         folder_name: str, attachments: list,
                                         course_dir: Path) -> None:
        """Download dropbox folder attachments into Assignments/<name>/ and
        stamp each entry with its local asset path."""
        if not attachments:
            return
        adir = course_dir / "Assignments" / _safe_name(folder_name)
        adir.mkdir(parents=True, exist_ok=True)
        for at in attachments:
            fname = _safe_name(at.get("FileName") or f"attachment-{at.get('FileId')}")
            dest = adir / fname
            if not (dest.exists() and dest.stat().st_size > 0):
                try:
                    resp = self.client.get_raw(
                        self.client.le(org_unit, f"/dropbox/folders/{folder_id}/attachments/{at['FileId']}"))
                    if resp.status_code == 200 and len(resp.content) > 0:
                        dest.write_bytes(resp.content)
                except Exception:
                    continue
            if dest.exists() and dest.stat().st_size > 0:
                rel = dest.relative_to(course_dir).as_posix()
                at["local"] = f"{course_dir.parent.name}/{course_dir.name}/{rel}"
                # register with the corpus so extraction + the AI's file tools
                # treat it like content (kind='assignment', source='brightspace')
                try:
                    sha = hashlib.sha256(dest.read_bytes()).hexdigest()
                    file_id, is_new = self.db.upsert_file(
                        course_id, at["local"], "assignment", "brightspace",
                        sha, dest.stat().st_size)
                    if is_new:
                        self.stats["files_new"] += 1
                        self.deltas.append({"kind": "file_new", "path": at["local"]})
                    else:
                        existing = self.db.conn.execute(
                            "SELECT sha256 FROM files WHERE id=?", (file_id,)).fetchone()
                        if existing and existing["sha256"] != sha:
                            self.stats["files_changed"] += 1
                            self.deltas.append({"kind": "file_changed", "path": at["local"]})
                except Exception:
                    pass

    def sync_dropbox(self, course_id: int, org_unit: int) -> None:
        course = self.db.conn.execute(
            "SELECT term, code FROM courses WHERE id=?", (course_id,)).fetchone()
        if not course:
            return
        course_dir = self.cfg.data_root / course["term"] / course["code"].replace(" ", "")
        try:
            folders = self.client.get(self.client.le(org_unit, "/dropbox/folders/"))
        except D2LError:
            return
        # dropbox categories (Project/Labs) + lp group categories (group
        # assignments' "Project" category) so folders' ids become names
        categories: dict = {}
        try:
            for c in self.client.get(self.client.le(org_unit, "/dropbox/categories/")):
                categories[c.get("Id")] = c.get("Name")
        except D2LError:
            pass
        group_cats: dict = {}
        try:
            for g in self.client.get(self.client.lp(f"/{org_unit}/groupcategories/")):
                group_cats[g.get("GroupCategoryId")] = g.get("Name")
        except D2LError:
            pass
        # the user's team per group category — the "Group 29" prefix that
        # Brightspace shows on group assignments
        try:
            me = (self.client.get(self.client.lp("/users/whoami")) or {}).get("Identifier")
            for cat_id, cat_name in group_cats.items():
                try:
                    for g in self.client.get(self.client.lp(f"/{org_unit}/groupcategories/{cat_id}/groups/")):
                        # whoami Identifier is a string; enrollments are ints
                        if any(str(x) == str(me) for x in (g.get("Enrollments") or [])):
                            self.db.upsert_course_group(course_id, cat_name, g.get("Name"))
                            break
                except D2LError:
                    pass
        except D2LError:
            pass
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
            # rubrics ride inside the folder's Assessment object (D2L sends
            # the full rubric: criteria groups, levels, per-cell feedback)
            assessment = f.get("Assessment") or {}
            rubrics = assessment.get("Rubrics") or []
            attachments = f.get("Attachments") or []
            if attachments:
                self._download_assignment_attachments(course_id, org_unit, f.get("Id"), f.get("Name"),
                                                      attachments, course_dir)
            availability = f.get("Availability") or None
            self.db.upsert_assignment(course_id, {
                "title": f.get("Name", "Assignment"),
                "description": desc,
                "due_at": f.get("DueDate"),
                "weight": None,
                "brightspace_folder_id": f.get("Id"),
                "url": f"{self.cfg.base_url}/d2l/lms/dropbox/user/folders/{f.get('Id')}/",
                "rubrics_json": json.dumps(rubrics) if rubrics else None,
                "category": categories.get(f.get("CategoryId")),
                "group_category": group_cats.get(f.get("GroupTypeId")),
                "points": assessment.get("ScoreDenominator"),
                "attachments_json": json.dumps(attachments) if attachments else None,
                "availability_json": json.dumps(availability) if availability else None,
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
            body_html = (n.get("Body") or {}).get("Html", "")
            is_new = self.db.upsert_announcement(course_id, {
                "brightspace_id": n.get("Id"),
                "title": n.get("Title", "(announcement)"),
                "body": body,
                "body_html": body_html,
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
                # covered by this sync's delta — never re-digested via the backlog
                self.db.conn.execute(
                    "UPDATE announcements SET digested_at=datetime('now') WHERE course_id=? AND brightspace_id=?",
                    (course_id, n.get("Id")))
                self.db.conn.commit()

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

    def _extract_doc(self, path: Path) -> bool:
        """Word .doc → text via antiword → .md sibling (the AI's
        content_read_file auto-falls-back to the .md sibling)."""
        try:
            md = path.with_suffix(".md")
            if md.exists() and md.stat().st_size > 0:
                return True
            if path.suffix.lower() == ".docx":
                import docx  # python-docx
                text = "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
            else:
                out = subprocess.run(["antiword", str(path)], capture_output=True,
                                     text=True, timeout=60)
                if out.returncode != 0:
                    return False
                text = out.stdout
            if text.strip():
                md.write_text(text, encoding="utf-8")
                return True
        except Exception:
            pass
        return False

    def run_extraction_queue(self, course_id: int | None = None) -> int:
        """Serialize extraction of unprocessed files (one at a time — the
        pdf-extractor worker is single and local engine is slow). Never
        blocks the sync critical path: called after digest."""
        done = 0
        rows = self.db.unprocessed_files(course_id) if course_id else \
            self.db.conn.execute("SELECT * FROM files WHERE processed=0").fetchall()
        for row in rows:
            path = Path(self.cfg.data_root) / row["path"]
            if path.suffix.lower() in (".doc", ".docx"):
                if self._extract_doc(path):
                    done += 1
                    print(f"  extracted: {row['path']}", flush=True)
                self.db.mark_processed(row["id"])  # one attempt; .md sibling persists
                continue
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
                self.sync_embedded(course["id"], org_unit, course_dir)
                self.sync_module_media(course["id"], org_unit, course_dir)
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
                # semantic corpus index (incremental — embeddings via bifrost;
                # best-effort: a bifrost blip must never fail the sync)
                try:
                    from sync.search import rebuild as rebuild_index
                    idx = rebuild_index(self.cfg, self.db)
                    print(f"  index: {idx['chunks']} chunks ({idx['embedded_items']} embedded)")
                except Exception as e:
                    print(f"  index rebuild skipped: {e}")
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

    def _undigested_chats(self, limit: int = 40) -> list[dict]:
        """Recent chat turns never fed to the digest (the chat-memory safety
        net — catches durable facts the model didn't record mid-conversation).
        Marked digested_at after the digest scans them."""
        try:
            rows = self.db.conn.execute(
                """SELECT m.id, m.role, m.content, s.course_id, c.code
                   FROM chat_messages m
                   JOIN chat_sessions s ON s.id = m.session_id
                   LEFT JOIN courses c ON c.id = s.course_id
                   WHERE m.digested_at IS NULL AND m.role IN ('user','assistant')
                     AND m.content != ''
                   ORDER BY m.id DESC LIMIT ?""",
                (limit,)).fetchall()
        except Exception:
            return []  # pre-migration DB (no digested_at column) — skip the net
        chats = []
        for r in reversed(rows):
            content = (r["content"] or "").strip()
            if len(content) > 600:
                content = content[:600] + "…"
            chats.append({"id": r["id"], "role": r["role"],
                          "course": r["code"], "content": content})
        return chats

    def _undigested_announcements(self, courses) -> list[dict]:
        """Historical announcements never fed to the digest (backlog backfill).
        New ones are marked digested_at at sync time (they ride the deltas)."""
        try:
            cids = [c["id"] for c in courses]
            q = ("SELECT id, title, posted_at, body FROM announcements "
                 "WHERE digested_at IS NULL AND posted_at >= datetime('now', ?)")
            args: list = [f"-{self.cfg.digest_announcement_days} days"]
            if cids:
                q += " AND course_id IN (%s)" % ",".join("?" * len(cids))
                args += cids
            q += " ORDER BY posted_at DESC LIMIT 25"
            out = []
            for r in self.db.conn.execute(q, args).fetchall():
                body = re.sub(r"<[^>]+>", " ", r["body"] or "")
                body = re.sub(r"\s+", " ", body).strip()
                out.append({"id": r["id"], "title": r["title"],
                            "posted_at": r["posted_at"], "body": body[:800]})
            return out
        except Exception:
            return []

    def digest_and_log(self, run_id: int, courses) -> None:
        """Bifrost AI pass: delta digest (+ undigested announcement backlog)
        → memory_facts + markdown sync log. (Notification is sent once by
        run(), covering the whole sync.)"""
        backlog = self._undigested_announcements(courses)
        chats = self._undigested_chats()
        if not self.deltas and not backlog and not chats:
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
        if backlog:
            prompt += (
                "\n\nHISTORICAL ANNOUNCEMENTS (backfill — these predate this sync). "
                "Extract ONLY facts still relevant TODAY: extensions, policies, bonus "
                "rules, grace periods, persistent instructions. SKIP anything whose "
                "relevance window has passed or that is superseded by newer "
                f"announcements or assignments:\n{json.dumps(backlog, indent=1)}"
            )
        if chats:
            prompt += (
                "\n\nRECENT CHAT ACTIVITY (conversations with the student since the last "
                "digest — the safety net: the student may have stated facts or decisions "
                "the model didn't record mid-conversation). Extract ONLY durable facts: "
                "student-stated decisions, corrections, personal schedule details, things "
                "explicitly said to remember. SKIP casual chat, questions, and anything "
                "ephemeral or already covered above. Category per the whitelist.\n"
                f"{json.dumps(chats, indent=1)}"
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
        # backfilled announcements are now in memory — never re-digested
        if backlog:
            self.db.conn.executemany(
                "UPDATE announcements SET digested_at=datetime('now') WHERE id=?",
                [(b["id"],) for b in backlog])
        # scanned chat turns are now in memory — never re-digested
        if chats:
            self.db.conn.executemany(
                "UPDATE chat_messages SET digested_at=datetime('now') WHERE id=?",
                [(c["id"],) for c in chats])
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
