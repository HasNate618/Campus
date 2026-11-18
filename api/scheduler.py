"""In-process once-daily sync checker.

Reads the live config on every tick so the Settings panel takes effect without
an API restart. One local date is attempted at most once; state lives beside
settings.yaml so restarts and missed slots are handled predictably.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

from sync.config import Config, settings_path
from sync.token_store import write_secret

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScheduleState:
    last_date: str | None = None
    last_timezone: str | None = None


def parse_clock(value: str) -> dt.time | None:
    if not isinstance(value, str):
        return None
    try:
        hour_s, minute_s = value.split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
        return dt.time(hour, minute)
    except (TypeError, ValueError):
        return None


def effective_timezone(cfg: Config) -> str:
    return cfg.timezone or "local"


def _zone(cfg: Config):
    if cfg.timezone:
        return ZoneInfo(cfg.timezone)
    return dt.datetime.now().astimezone().tzinfo or dt.timezone.utc


def due_date(now: dt.datetime, cfg: Config, state: ScheduleState | None = None,
             window: dt.timedelta = dt.timedelta(minutes=15)) -> dt.date | None:
    """Return the local date that should be synced, or None."""
    if not cfg.auto_sync_enabled:
        return None
    clock = parse_clock(cfg.auto_sync_time)
    if clock is None:
        return None
    try:
        zone = _zone(cfg)
    except Exception:
        return None
    local = now.astimezone(zone) if now.tzinfo else now.replace(tzinfo=zone)
    scheduled = dt.datetime.combine(local.date(), clock, tzinfo=zone)
    if local < scheduled:
        return None
    if not cfg.auto_sync_catch_up and local > scheduled + window:
        return None
    if state and state.last_date == local.date().isoformat() \
            and state.last_timezone == effective_timezone(cfg):
        return None
    return local.date()


def state_path(cfg: Config) -> Path:
    return settings_path(cfg).parent / "auto_sync_state.json"


def read_state(path: Path) -> ScheduleState:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return ScheduleState()
        return ScheduleState(
            last_date=data.get("last_date") if isinstance(data.get("last_date"), str) else None,
            last_timezone=(data.get("last_timezone")
                           if isinstance(data.get("last_timezone"), str) else None),
        )
    except (OSError, ValueError):
        return ScheduleState()


def write_state(path: Path, state: ScheduleState) -> None:
    payload = {"last_date": state.last_date, "last_timezone": state.last_timezone}
    write_secret(path, json.dumps(payload), chmod_parent=False)


class AutoSyncScheduler:
    def __init__(self, interval_s: int = 60):
        self.interval_s = interval_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="campus-auto-sync",
                                        daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.tick()
            except Exception:
                log.exception("auto-sync checker tick failed")

    def tick(self, now: dt.datetime | None = None) -> str:
        cfg = Config.load()
        if not cfg.auto_sync_enabled:
            return "disabled"
        if parse_clock(cfg.auto_sync_time) is None:
            log.warning("auto-sync disabled: invalid time %r", cfg.auto_sync_time)
            return "invalid_time"
        try:
            _zone(cfg)
        except Exception:
            log.warning("auto-sync disabled: invalid timezone %r", cfg.timezone)
            return "invalid_timezone"

        path = state_path(cfg)
        state = read_state(path)
        current = now or dt.datetime.now(dt.timezone.utc)
        target = due_date(current, cfg, state)
        if target is None:
            return "not_due"

        from api import services
        result = services.trigger_sync(trigger="cron")
        status = result.get("status") if isinstance(result, dict) else ""
        if status == "started":
            write_state(path, ScheduleState(target.isoformat(), effective_timezone(cfg)))
            return "started"
        if status == "in_progress":
            return "in_progress"
        return "skipped"
