"""The settings write allowlist and its validators.

One table serves two purposes: a key absent from REGISTRY can never be written
to settings.yaml, and every value written has passed the same validator the
loader's consumers rely on. UI copy (labels, help, ordering) belongs in the
frontend — this module is the contract, not the presentation.

`normalize()` returns the value to persist, or None to mean "delete this key
from the overrides file" (i.e. inherit from config.yaml / env again).
"""
from __future__ import annotations

import json
import zoneinfo
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit


class ValidationError(ValueError):
    """A value that must never reach settings.yaml."""


@dataclass(frozen=True)
class Field:
    key: str
    kind: str          # text | secret | bool | int | json | url | list
    validate: Callable[[Any], Any]
    group: str = "ai"
    secret: bool = False
    restart: bool = False
    couples: tuple[str, ...] = ()
    empty: str = "delete"   # what "" means: store | delete | reject


# ── validators ───────────────────────────────────────────────────────────
def _is_url(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    u = urlsplit(v)
    return u.scheme in ("http", "https") and bool(u.netloc)


def v_bool(v: Any) -> bool:
    if not isinstance(v, bool):   # bool first: isinstance(1, int) is True
        raise ValidationError("must be true or false")
    return v


def v_int(lo: int, hi: int) -> Callable[[Any], int]:
    def check(v: Any) -> int:
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValidationError("must be a whole number")
        if v < lo or v > hi:
            raise ValidationError(f"must be between {lo} and {hi}")
        return v
    return check


def v_text(allow_empty: bool) -> Callable[[Any], str]:
    def check(v: Any) -> str:
        if not isinstance(v, str):
            raise ValidationError("must be text")
        if not allow_empty and not v.strip():
            raise ValidationError("must not be empty")
        return v
    return check


def v_url(allow_empty: bool) -> Callable[[Any], str]:
    def check(v: Any) -> str:
        if not isinstance(v, str):
            raise ValidationError("must be text")
        if not v.strip():
            if allow_empty:
                return ""
            raise ValidationError("must not be empty")
        if not _is_url(v):
            raise ValidationError(f"not an http(s) URL: {v}")
        return v
    return check


def v_url_list(v: Any) -> list[str]:
    if not isinstance(v, list):
        raise ValidationError("must be a list of URLs")
    out: list[str] = []
    for u in v:
        if not _is_url(u):
            raise ValidationError(f"not an http(s) URL: {u!r}")
        out.append(u)
    return out


def v_timezone(v: Any) -> str:
    if not isinstance(v, str):
        raise ValidationError("must be text")
    if not v.strip():
        return ""
    try:
        zoneinfo.ZoneInfo(v)
    except Exception:
        raise ValidationError(f"unknown timezone: {v}") from None
    return v


def v_tool_choice(v: Any) -> Any:
    """The endpoint's `tool_choice`: a literal string or a JSON object.

    sync/config.py:166-171 documents both forms — "auto" for endpoints that
    require one, or {"type": "function", ...}. The object form is persisted
    PARSED, because agent/chat.py:108-109 forwards whatever is not None: a
    stringified object would be sent as a string where the API expects an
    object.

    Only a leading `{` is treated as JSON. A bare word is not valid JSON, and
    `json.loads` would reject it — but "auto"/"required"/"none" are exactly
    the literal values this field exists to carry.
    """
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        stripped = v.strip()
        if not stripped:
            raise ValidationError("empty")   # normalize() maps "" -> delete first
        if not stripped.startswith("{"):
            return stripped
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as e:
            raise ValidationError(f"invalid JSON: {e}") from None
        if not isinstance(parsed, dict):
            raise ValidationError("must be a JSON object")
        return parsed
    raise ValidationError("must be a JSON object or string")


# ── the allowlist ────────────────────────────────────────────────────────
GROUPS: tuple[str, ...] = ("ai", "search", "content", "sync", "notifications", "advanced")

REGISTRY: dict[str, Field] = {
    # ai
    "llm_urls": Field("llm_urls", "list", v_url_list, group="ai",
                      couples=("llm_url",), empty="store"),
    "llm_api_key": Field("llm_api_key", "secret", v_text(True), group="ai",
                         secret=True),
    "llm_model": Field("llm_model", "text", v_text(False), group="ai",
                       empty="reject"),
    "llm_tool_choice": Field("llm_tool_choice", "json", v_tool_choice,
                             group="advanced"),
    # search
    "embed_model": Field("embed_model", "text", v_text(False), group="search",
                         empty="reject"),
    "rerank_model": Field("rerank_model", "text", v_text(False), group="search",
                          empty="reject"),
    # content
    "auto_extract_pdfs": Field("auto_extract_pdfs", "bool", v_bool, group="content"),
    "office_to_pdf": Field("office_to_pdf", "bool", v_bool, group="content"),
    "pdf_extractor_url": Field("pdf_extractor_url", "url", v_url(True),
                               group="content", empty="store"),
    "long_scan_skip_pages": Field("long_scan_skip_pages", "int", v_int(0, 100_000),
                                  group="content"),
    "digest_pdf_excerpt_chars": Field("digest_pdf_excerpt_chars", "int",
                                      v_int(0, 1_000_000), group="content"),
    # sync
    "pilot_only": Field("pilot_only", "bool", v_bool, group="sync"),
    "institution": Field("institution", "text", v_text(True), group="sync"),
    "timezone": Field("timezone", "text", v_timezone, group="sync", empty="store"),
    # notifications
    "ntfy_url": Field("ntfy_url", "url", v_url(True), group="notifications",
                      empty="store"),
    # advanced
    "mcp_urls": Field("mcp_urls", "list", v_url_list, group="advanced",
                      couples=("mcp_url",), restart=True, empty="store"),
    "max_file_size": Field("max_file_size", "int", v_int(1, 10 ** 12),
                           group="advanced"),
    "max_extract_size": Field("max_extract_size", "int", v_int(1, 10 ** 12),
                              group="advanced"),
    "office_convert_timeout_s": Field("office_convert_timeout_s", "int",
                                      v_int(1, 100_000), group="advanced"),
    "digest_announcement_days": Field("digest_announcement_days", "int",
                                      v_int(0, 100_000), group="advanced"),
}


def normalize(field: Field, raw: Any) -> Any:
    """Value to persist, or None to delete the key.

    Empty-string handling is per field, not per kind: `""` is a meaningful
    stored value for url/timezone fields ("disabled"), means "delete" for
    secrets and free text, and is rejected for the model fields.
    """
    if raw is None:
        return None
    if isinstance(raw, str) and not raw.strip():
        if field.empty == "store":
            return field.validate(raw)
        if field.empty == "delete":
            return None
        raise ValidationError("must not be empty")
    return field.validate(raw)
