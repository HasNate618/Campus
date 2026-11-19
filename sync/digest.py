"""One bounded LLM call turns sync change cards into a short digest.

The model never sees URLs and never authors links: it references cards by
marker, and the server substitutes the exact server-owned href afterwards.
Any failure or empty/garbage output falls back to deterministic markdown.
"""
from __future__ import annotations

import logging
import re

import httpx

from agent.chat import llm_headers
from sync.report import (
    ChangeCard,
    SyncReport,
    build_change_cards,
    render_digest_fallback,
    strip_model_links,
    substitute_card_links,
)

log = logging.getLogger(__name__)

_SYSTEM = """You write a tiny study digest for a university student. They scan
it in ten seconds; they do not read essays.

Rules:
- Use only the supplied change cards. At most 120 words TOTAL.
- Sections, in this order, each a heading followed by short bullets:
  ## What changed
  ## Watch out for
  Include ## Needs attention only when failures are listed.
- One bullet per item. Each bullet is ONE short line: course code, then the
  fact, then its marker once, e.g. "- SE 3352A: new slides on architectural
  styles [c1]". Never repeat a marker.
- No paragraphs, no "Study implication" or summary sections, no restating a
  card's full text, no contact details unless the card is about contact info.
- Dates and deadlines go in Watch out for, with the date if the card has one.
- Refer to claims only by marker, e.g. [c3]. Never write URLs or link syntax
  other than markers. If nothing changed, say so plainly and use no markers.
"""

_TIMEOUT_S = 90
_MAX_CHARS = 8000
# The configured chat model reasons before answering (observed ~1600 reasoning
# tokens on a 4-card digest). A 600 cap guillotined the answer mid-heading and
# every digest silently degraded to the deterministic fallback. Budget for the
# reasoning plus the short answer; the word limit lives in the prompt.
_MAX_TOKENS = 3000


def _prompt(cards: list[ChangeCard], report: SyncReport) -> str:
    lines = ["Change cards (title and excerpt only):"]
    for card in cards:
        line = f"[{card.marker}] {card.course_code} · {card.kind}: {card.title}"
        if card.detail:
            line += f" — {str(card.detail)[:240]}"
        lines.append(line)
    for failure in report.failures[:10]:
        lines.append(f"[failure] {failure}")
    return "\n".join(lines)


def _clean_model_output(raw: str, cards: list[ChangeCard]) -> str:
    text = re.sub(r"^\s*```(?:markdown)?\s*", "", str(raw or ""))
    text = re.sub(r"\s*```\s*$", "", text)
    text = strip_model_links(text)[:_MAX_CHARS]
    text = substitute_card_links(text, cards)
    return text.strip() + "\n" if text.strip() else ""


def make_digest(cfg, model: str | None, report: SyncReport) -> tuple[str, str]:
    """Return (markdown, generated_by). Never raises into the sync path."""
    cards = build_change_cards(report)
    fallback = render_digest_fallback(report)
    endpoints = cfg.llm_endpoints()
    if not endpoints:
        return fallback, "deterministic"

    payload = {
        "model": model or cfg.llm_model,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": _prompt(cards, report)},
        ],
        "temperature": 0.2,
        "max_tokens": _MAX_TOKENS,
    }
    try:
        response = httpx.post(
            f"{endpoints[0].rstrip('/')}/chat/completions",
            headers=llm_headers(cfg),
            json=payload,
            timeout=_TIMEOUT_S,
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        markdown = _clean_model_output(raw, cards)
        if not markdown:
            return fallback, "deterministic"
        return markdown, "ai"
    except Exception as exc:
        log.warning("AI digest unavailable (%s: %s); using deterministic digest",
                    type(exc).__name__, str(exc)[:200])
        return fallback, "deterministic"
