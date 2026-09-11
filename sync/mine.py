"""Autonomous sync mining — pure helpers shared by corpus builder, parser, applier.

Deterministic first: everything in this section is regex/hashing only, no LLM.
"""
from __future__ import annotations

import hashlib
import re

OUTLINE_NAME_RE = re.compile(r"(outline|course\s*outline|syllabus)", re.I)
DATE_LINE_RE = re.compile(
    r"(\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}(/\d{2,4})?\b|"
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b|"
    r"\b(midterm|final|exam|quiz|lab|assignment|project|due|deadline|weight|worth|%)\b)",
    re.I)
POLICY_LINE_RE = re.compile(
    r"\b(grading|weight|worth|%|policy|policies|plagiarism|accommodat|late|penalty|"
    r"office hours|instructor|professor|ta\b|textbook|prerequisite|attendance)\b",
    re.I)


def stable_uid(code: str, title: str, starts_at: str) -> str:
    """16-hex-char dedupe key: sha1(code|title|starts_at).

    Same input twice (re-sync) MUST yield the same key so INSERT OR IGNORE
    dedupes; different courses/titles/dates MUST differ."""
    h = hashlib.sha1(f"{code}|{title}|{starts_at}".encode("utf-8")).hexdigest()
    return h[:16]


def classify_file(rel: str) -> str:
    """outline | assignment | content | slides | other — from path alone, no I/O."""
    low = (rel or "").lower()
    if OUTLINE_NAME_RE.search(low):
        return "outline"
    if "dropbox" in low or "assignment" in low or "assignments" in low:
        return "assignment"
    if "/slides/" in low or low.endswith((".pptx", ".ppt", ".pdf")):
        return "slides"
    if "/content/" in low or low.endswith((".md", ".html")):
        return "content"
    return "other"


def is_noise_fact(text: str) -> bool:
    """True for sync-chatter facts that must never reach memory cards.

    Matches 'X file(s) were added/updated/posted' phrasing in any case.
    Deliberately narrow: real facts ('Final is worth 45%') never match."""
    return bool(re.search(
        r"\b\d*\s*(files?|slides?|documents?|announcements?)\b.{0,20}"
        r"\b(were|was|has been|have been)\b.{0,20}"
        r"\b(added|updated|posted|synced|uploaded)\b",
        text or "", re.I))
