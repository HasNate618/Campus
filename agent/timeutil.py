"""One place for "now" and for rendering harness timestamps.

The container runs in UTC while the user lives in America/Toronto. Stored D2L
due dates are a MIX of UTC (`2026-12-07T04:59:59.000Z`), date-only
(`2026-12-01`) and naive datetime (`2026-11-29T23:59`). Rendering those with a
plain `fromisoformat(...).strftime()` printed the UTC wall time and called it a
local deadline — `2026-11-27T22:00:00Z` (5pm EST) was shown to the agent as
"Fri Nov 27, 00:00", a five-hour error that then surfaced in answers about what
is due.

Keep conversions here so the prompt, memory card and API all agree.
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sync.config import Config


def tz(cfg: Config | None = None):
    """The configured zone, falling back to the system zone."""
    name = getattr(cfg, "timezone", None) if cfg else None
    if not name:
        return dt.datetime.now().astimezone().tzinfo or dt.timezone.utc
    try:
        return ZoneInfo(name)
    except Exception:
        return dt.datetime.now().astimezone().tzinfo or dt.timezone.utc


def tz_name(cfg: Config | None = None) -> str:
    """The configured zone's NAME, for the prompt. Falls back to the system name."""
    zone = tz(cfg)
    return getattr(zone, "key", None) or str(zone)


def now_local(cfg: Config | None = None) -> dt.datetime:
    return dt.datetime.now(tz(cfg))


def parse_harness_dt(value: str | None, cfg: Config | None = None) -> dt.datetime | None:
    """Parse any timestamp shape found in the harness into an AWARE datetime.

    - `...Z` and offsets are UTC/aware already.
    - date-only is a deadline labelled by the LMS in local calendar terms; noon
      keeps DST-safe day semantics (same rule as web/src/lib/format.ts).
    - naive datetime is assumed to be UTC, which is what SQLite's
      datetime('now') and D2L's payloads actually write.
    """
    if not value or not isinstance(value, str):
        return None
    s = value.strip().replace(" ", "T") if len(value) > 10 else value.strip()
    try:
        if s.endswith("Z"):
            parsed = dt.datetime.fromisoformat(s[:-1] + "+00:00")
        else:
            parsed = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        if len(s) == 10:
            # date-only: interpret in the user's zone, not as UTC midnight.
            parsed = dt.datetime.combine(parsed.date(), dt.time(12, 0),
                                         tzinfo=tz(cfg))
        else:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def to_local(value: str | None, cfg: Config | None = None) -> dt.datetime | None:
    parsed = parse_harness_dt(value, cfg)
    if parsed is None:
        return None
    return parsed.astimezone(tz(cfg))


def fmt_local(value: str | None, cfg: Config | None = None,
              fmt: str = "%a %b %d, %Y %H:%M") -> str:
    """Render a harness timestamp in the configured timezone."""
    local = to_local(value, cfg)
    return local.strftime(fmt) if local else "unknown"


def sqlish_now(cfg: Config | None = None) -> str:
    """A UTC string shaped like SQLite's datetime('now') for string compares.

    Stored due dates are `YYYY-MM-DD HH:MM:SS` UTC (or ISO `Z`), never a
    timezone-aware literal with an offset, so a bound written as
    `2026-11-25T11:24:00-05:00` cannot be compared with them lexically: the '-'
    sorts before digits and the window silently drops items. Compare in UTC.
    """
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
