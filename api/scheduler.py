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
    # The date whose run FINISHED successfully. `last_date` alone used to mean
    # "attempted", and it was written the moment trigger_sync returned
    # 'started' — which happens before the daemon thread does any work. A 05:00
    # run that failed on an expired token therefore marked the whole day done
    # and was never retried. These two fields separate the attempt from the
    # outcome so a failed slot can be tried again.
    last_success_date: str | None = None
    # Attempts made for `last_date`, and when the last one was made (UTC ISO).
    # Bounded and spaced so a persistent failure cannot spin every tick.
    attempts: int = 0
    last_attempt_at: str | None = None


#: How many times one day's slot may be attempted before giving up until
#: tomorrow. Three covers a token that needs a re-auth plus one transient blip.
MAX_ATTEMPTS_PER_DAY = 3
#: Minimum spacing between attempts of the same day. The tick is 60s; without a
#: gap a failing run would be retried every minute.
RETRY_SPACING = dt.timedelta(minutes=30)


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
    """Return the local date that should be synced, or None.

    A day is finished only when a run for it SUCCEEDED. An attempt that failed
    leaves the day due, subject to the attempt cap and the retry spacing, so an
    expired token at 05:00 no longer cancels the day.
    """
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
    today = local.date().isoformat()
    same_zone = state is not None and state.last_timezone == effective_timezone(cfg)
    if state and same_zone:
        # Already synced successfully today: nothing to do.
        if state.last_success_date == today:
            return None
        if state.last_date == today:
            # Attempted but not yet successful. Retry only within the cap and
            # only after the spacing has elapsed.
            if state.attempts >= MAX_ATTEMPTS_PER_DAY:
                return None
            last = _parse_utc(state.last_attempt_at)
            if last is not None and now - last < RETRY_SPACING:
                return None
    return local.date()


def _parse_utc(value: str | None) -> dt.datetime | None:
    """Parse a stored UTC timestamp, tolerating a naive or malformed value."""
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def state_path(cfg: Config) -> Path:
    return settings_path(cfg).parent / "auto_sync_state.json"


def read_state(path: Path) -> ScheduleState:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return ScheduleState()
        attempts = data.get("attempts")
        return ScheduleState(
            last_date=data.get("last_date") if isinstance(data.get("last_date"), str) else None,
            last_timezone=(data.get("last_timezone")
                           if isinstance(data.get("last_timezone"), str) else None),
            last_success_date=(data.get("last_success_date")
                               if isinstance(data.get("last_success_date"), str) else None),
            attempts=attempts if isinstance(attempts, int) and attempts >= 0 else 0,
            last_attempt_at=(data.get("last_attempt_at")
                             if isinstance(data.get("last_attempt_at"), str) else None),
        )
    except (OSError, ValueError):
        return ScheduleState()


def write_state(path: Path, state: ScheduleState) -> None:
    payload = {
        "last_date": state.last_date,
        "last_timezone": state.last_timezone,
        "last_success_date": state.last_success_date,
        "attempts": state.attempts,
        "last_attempt_at": state.last_attempt_at,
    }
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

        from api import services

        # Settle the previous attempt BEFORE deciding whether today is due. The
        # run happens on a background thread, so its outcome only exists in
        # sync_runs; reading it here is what turns "attempted" into "succeeded".
        state = self._settle(cfg, state, path, services)

        target = due_date(current, cfg, state)
        if target is None:
            return "not_due"

        result = services.trigger_sync(trigger="cron")
        status = result.get("status") if isinstance(result, dict) else ""
        if status == "started":
            # Record the ATTEMPT, not a success. `last_success_date` is only
            # written by _settle once a run for this date has finished ok.
            attempts = state.attempts + 1 if state.last_date == target.isoformat() else 1
            write_state(path, ScheduleState(
                last_date=target.isoformat(),
                last_timezone=effective_timezone(cfg),
                last_success_date=state.last_success_date,
                attempts=attempts,
                last_attempt_at=current.astimezone(dt.timezone.utc).isoformat(),
            ))
            return "started"
        if status == "in_progress":
            return "in_progress"
        return "skipped"

    @staticmethod
    def _settle(cfg: Config, state: ScheduleState, path: Path, services) -> ScheduleState:
        """Promote a finished cron run to last_success_date.

        Without this the scheduler cannot tell a failed attempt from a successful
        one: trigger_sync returns 'started' before the work happens, so the old
        code marked the day done on launch and a token failure at 05:00 silently
        cancelled every later attempt that day.
        """
        if not state.last_date or state.last_success_date == state.last_date:
            return state
        try:
            runs = services.list_sync_runs(limit=10)
        except Exception:
            log.exception("auto-sync: could not read run outcomes")
            return state
        # Only cron runs count: a manual sync the user ran is not the scheduled
        # slot succeeding, and crediting it would hide a broken schedule.
        for run in runs or []:
            if (run.get("trigger") != "cron"
                    or run.get("status") not in ("ok", "partial")):
                continue
            started = str(run.get("started_at") or "")
            if not started:
                continue
            # started_at is a naive UTC string from SQLite; compare the DATE in
            # the schedule's own zone, since a 05:00 local slot can fall on
            # either UTC date.
            when = _parse_utc(started.replace(" ", "T"))
            if when is None:
                continue
            try:
                local_date = when.astimezone(_zone(cfg)).date().isoformat()
            except Exception:
                continue
            if local_date == state.last_date:
                settled = ScheduleState(
                    last_date=state.last_date,
                    last_timezone=state.last_timezone,
                    last_success_date=state.last_date,
                    attempts=state.attempts,
                    last_attempt_at=state.last_attempt_at,
                )
                write_state(path, settled)
                log.info("auto-sync: %s settled by cron run %s (%s)",
                         state.last_date, run.get("id"), run.get("status"))
                return settled
        return state
