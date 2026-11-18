"""Pure sync-report and digest rendering. No DB, no network, no clock reads."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import quote


@dataclass
class ChangeCard:
    marker: str
    course_id: int
    course_code: str
    kind: str
    title: str
    detail: str = ""
    href: str | None = None


@dataclass
class SyncReport:
    run_id: int
    started_at: str
    finished_at: str
    duration_s: float
    trigger: str
    status: str
    courses_checked: int
    courses_changed: int
    stats: dict
    changes: list[ChangeCard]
    failures: list[str]
    warnings: list[str] = field(default_factory=list)
    mined_items: list[ChangeCard] = field(default_factory=list)


def _md_escape(text: object) -> str:
    return re.sub(r"([\\`*_\[\]])", r"\\\1", str(text or "").strip())


def _fmt_duration(seconds: float) -> str:
    secs = max(0, int(seconds))
    if secs < 60:
        return f"{secs}s"
    minutes, rest = divmod(secs, 60)
    if minutes < 60:
        return f"{minutes}m {rest}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m"


def _fmt_started(value: object) -> str:
    text = str(value or "")
    return text[:16].replace("T", " ")


def _trigger_label(trigger: str) -> str:
    return {"cron": "scheduled"}.get(trigger, trigger)


def content_href(course, file_id: int | None, node_id: int | None,
                 rel: str | None) -> str | None:
    """Link a changed file to the content tree, falling back to workspace."""
    if not rel or not course:
        return None
    prefix = f"{course['term']}/{str(course['code']).replace(' ', '')}/"
    if not rel.startswith(prefix):
        return None
    cid = course["id"]
    if node_id is not None and file_id is not None:
        return f"/courses/{cid}/content/{node_id}?file={file_id}"
    return f"/courses/{cid}/workspace?path={quote(rel[len(prefix):], safe='')}"


def announcement_href(course_id: int, announcement_id: int | None) -> str | None:
    if not announcement_id:
        return None
    return f"/courses/{course_id}#announcement-{announcement_id}"


def _course_map(courses) -> dict[int, dict]:
    return {c["id"]: c for c in courses}


def build_report(*, run_id: int, started_at: str, finished_at: str,
                 duration_s: float, trigger: str, status: str, stats: dict, courses,
                 deltas: list[dict], mining: dict,
                 course_failures: list[tuple[str, str]],
                 mining_failures: list[str], extraction_failures: list[str],
                 warnings: list[str] | None = None) -> SyncReport:
    """Turn the run's raw deltas/mining results into a report with cards."""
    courses_by_id = _course_map(courses)
    changes: list[ChangeCard] = []
    seen_courses: set[int] = set()
    for d in deltas:
        raw_cid = d.get("course_id")
        if not isinstance(raw_cid, int):
            continue
        cid = raw_cid
        course = courses_by_id.get(cid)
        if not course:
            continue
        code = course["code"]
        kind = d.get("kind")
        title = d.get("title") or _path_name(d.get("path"))
        href = None
        detail = ""
        if kind in ("file_new", "file_changed"):
            href = content_href(course, d.get("file_id"), d.get("node_id"), d.get("path"))
            detail = "New file" if kind == "file_new" else "Changed file"
        elif kind == "announcement":
            href = announcement_href(cid, d.get("announcement_id"))
            detail = str(d.get("body") or "")[:240]
        elif kind == "syllabus":
            href = content_href(course, d.get("file_id"), d.get("node_id"), d.get("path"))
            detail = "Syllabus updated"
        else:
            continue
        seen_courses.add(cid)
        changes.append(ChangeCard("", cid, code, kind, title, detail, href))

    mined: list[ChangeCard] = []
    for cid, out in (mining or {}).items():
        course = courses_by_id.get(cid)
        if not course:
            continue
        for item in out.get("items", []):
            kind = item.get("kind")
            target = item.get("href_target")
            if kind == "assignment" and target:
                href = f"/courses/{cid}/assignments/{target}"
            elif kind in ("event", "exam"):
                href = f"/courses/{cid}#schedule"
            else:
                href = f"/courses/{cid}"
            mined.append(ChangeCard("", cid, course["code"], kind,
                                    item.get("title") or "Schedule change",
                                    item.get("detail") or item.get("starts_at") or "",
                                    href))

    failures: list[str] = []
    for code, err in course_failures or []:
        failures.append(f"{code}: {err}")
    failures.extend(mining_failures or [])
    failures.extend(extraction_failures or [])

    return SyncReport(
        run_id=run_id,
        started_at=started_at,
        finished_at=finished_at,
        duration_s=max(0.0, float(duration_s)),
        trigger=trigger,
        status=status,
        courses_checked=len(courses),
        courses_changed=len(seen_courses),
        stats=stats or {},
        changes=changes,
        failures=failures,
        warnings=list(warnings or []),
        mined_items=mined,
    )


def _path_name(path: object) -> str:
    """Basename used when a delta has no explicit title."""
    return str(path or "changed file").replace("\\", "/").rsplit("/", 1)[-1]


def build_change_cards(report: SyncReport, limit: int = 40) -> list[ChangeCard]:
    """Assign sequential markers and cap the payload sent to the model."""
    out: list[ChangeCard] = []
    for card in list(report.changes) + list(report.mined_items):
        if len(out) >= limit:
            break
        out.append(ChangeCard(f"c{len(out) + 1}", card.course_id, card.course_code,
                              card.kind, card.title, card.detail, card.href))
    return out


def render_sync_log(report: SyncReport) -> str:
    s = report.stats
    parts = [
        f"{s.get('files_new', 0)} new files",
        f"{s.get('files_changed', 0)} changed files",
        f"{s.get('announcements_new', 0)} announcements",
    ]
    lines = [
        f"# Sync run {report.run_id} · {_fmt_started(report.started_at)} · "
        f"{_fmt_duration(report.duration_s)} · {report.status} · "
        f"{_trigger_label(report.trigger)}",
        "",
        f"Checked {report.courses_checked} courses · {report.courses_changed} changed · "
        + " · ".join(parts),
    ]
    if report.warnings:
        lines += ["", "Notes: " + "; ".join(report.warnings)]

    lines += ["", "## Changes", ""]
    if not report.changes:
        lines.append("No course content changed.")
    else:
        by_course: dict[str, list[ChangeCard]] = {}
        for card in report.changes:
            by_course.setdefault(card.course_code, []).append(card)
        for code, cards in by_course.items():
            lines.append(f"- **{_md_escape(code)}** — {len(cards)} change"
                         f"{'s' if len(cards) != 1 else ''}")
            for card in cards:
                label = _md_escape(card.title)
                lines.append(f"  - [{label}]({card.href})" if card.href
                             else f"  - {label}")

    mined = report.stats.get("facts_added", 0), report.stats.get("events_added", 0)
    lines += ["", "## Extracted", "",
              f"+{mined[0]} facts · backfilled {report.stats.get('assignments_added', 0)} assignments"]

    lines += ["", "## Problems", ""]
    if report.failures:
        lines.extend(f"- {_md_escape(f)}" for f in report.failures)
    else:
        lines.append("None.")
    return "\n".join(lines) + "\n"


def render_digest_fallback(report: SyncReport) -> str:
    cards = build_change_cards(report)
    if not cards and not report.failures:
        return "Nothing new in Brightspace since the last sync.\n"

    lines = ["## What changed", ""]
    if cards:
        for card in cards[:8]:
            label = _md_escape(card.title)
            link = f"[{label}]({card.href})" if card.href else label
            lines.append(f"- **{_md_escape(card.course_code)}** — {link}")
    else:
        lines.append("- Nothing new in Brightspace.")

    watch = [c for c in cards if c.kind in ("event", "exam", "assignment")]
    lines += ["", "## Watch out for", ""]
    if watch:
        for card in watch[:5]:
            label = _md_escape(card.title)
            link = f"[{label}]({card.href})" if card.href else label
            lines.append(f"- {link}" + (f" — {card.detail}" if card.detail else ""))
    else:
        lines.append("- No upcoming deadlines changed.")

    if report.failures:
        lines += ["", "## Needs attention", ""]
        lines.extend(f"- {_md_escape(f)}" for f in report.failures[:5])
    return "\n".join(lines) + "\n"


def strip_model_links(text: str) -> str:
    """Remove model-authored links before server markers are substituted."""
    text = re.sub(r"\[[^\]]*\]\(\s*(?:https?:)?//[^)]+\)", "", text)
    text = re.sub(r"<\s*(?:https?:)?//[^>]+>", "", text)
    text = re.sub(r"\bhttps?://[^\s<>]+", "", text)
    return text


def substitute_card_links(text: str, cards: list[ChangeCard]) -> str:
    by_marker = {c.marker: c for c in cards}

    def replace(match: re.Match[str]) -> str:
        card = by_marker.get(match.group(1))
        if not card or not card.href:
            return ""
        return f"[{_md_escape(card.title)}]({card.href})"

    return re.sub(r"\[(c\d+)\]", replace, text)
