# Daily auto-sync, useful sync logs, and an AI-assisted digest — design

**Date:** 2026-11-18
**Status:** design for approval
**Owner's request:** stop pressing Sync every day; make one daily time configurable;
include missed-run catch-up by default; stop showing “no changes” noise; make the
digest materially different from the log; include links to changed content; use
AI calls where useful.

## Problem

Campus currently syncs only when someone presses the button. That is fine for
protecting a D2L session from MFA churn, but it makes a daily habit out of a
mechanical action. At the same time, the Sync page and the Home digest are the
same markdown file: `SyncEngine.digest_and_log()` writes one `YYYY-MM-DD.md`
under `data_root/sync_logs`, and `services.get_digest()` returns the newest one.
The result is a daily wall of `- COURSE: no changes` bullets that is neither a
useful operational log nor a useful digest.

The user's lived experience is that Duo stopped appearing months ago — the
persisted browser session keeps the token valid — so the original reason for a
strictly manual trigger no longer justifies the daily click.

## Goals

- Add one opt-in automatic sync per day at a configurable local time.
- Make missed-run catch-up on by default, with a switch to turn it off.
- Keep manual Sync working, and never let scheduled and manual runs overlap.
- Separate the operational sync log from the human digest.
- Log what happened: trigger, duration, status, changed courses, actual changed
  item titles, mining results, and failures. Omit unchanged courses.
- Make the digest answer “what changed and what should I look at” with concise
  prose and working in-app links.
- Use the configured LLM once per sync for the digest when available; fall back
  to deterministic markdown when it is not.
- Reuse existing configuration, settings, sync, and auth machinery. No new
  service, dependency, database table, or host-level cron.

## Non-goals

- Background scraping, continuous polling, or multiple syncs per day.
- Re-authentication loops or forcing a Duo push on a schedule.
- Sending full course documents to an LLM. The digest sees bounded metadata and
  short excerpts only.
- Rich text editing of digests, per-course digest settings, or digest history UI.
- A separate AI toggle. The existing `llm_url`/`llm_model` configuration is the
  gate; if no endpoint is configured, the deterministic digest is used.
- Distributing the scheduler across multiple API workers. Deployment is one
  uvicorn process (`Dockerfile:75`).

## Anti-goals

- A digest that merely restates per-course counts in sentence form.
- A log that hides failures to look tidy.
- Model-authored URLs. Links must be minted server-side from known IDs.
- A scheduler that silently marks a day as done when another sync was already
  running and no new run was started.

## Current state and findings

- `api/routers/sync.py::trigger_sync` calls `api/services.py::trigger_sync`,
  which spawns one daemon thread guarded by `services._sync_lock` and
  `_sync_in_progress`. It returns `started`, `in_progress`, or similar. This is
  the single correct entry point for both manual and scheduled runs.
- `SyncEngine.run()` calls `self.db.start_sync()`, whose default trigger is
  `"manual"`. The schema already permits `manual`, `cron`, `web`, and `digest`
  (`schema.sql:302-303`), but nothing passes `cron` today.
- `api/main.py` has no lifespan hook. Adding one is safe: deployment uses a
  single process, and tests that construct `TestClient(app)` without a context
  manager do not run lifespan.
- `sync/config.py::Config` is a dataclass with layers
  `defaults < config.yaml < env < settings.yaml`. `api/settings_fields.py` is
  the web write allowlist and validator registry. The web panel groups fields
  through `web/src/settings/fieldMeta.tsx` and renders by `kind` in
  `SettingsBody.tsx`.
- `sync/d2l.py::TokenBucket` caps requests at 3/sec with a burst of 10, handles
  401/429/5xx with one bounded retry, and `sync/sync.py` skips unchanged files
  via sha256. Playwright is used for authentication, not routine page scraping.
  One daily run is no more aggressive than the manual habit it replaces.
- `self.deltas` currently records file changes as `{"kind", "path"}` only;
  announcements also have `course_id`, `title`, `body`, and `posted_at`. There
  is no stable ID for opening a changed file from a digest today.
- `web/src/lib/ZenMarkdown.tsx` is the shared markdown renderer. DOMPurify in
  `web/src/lib/md.ts` allows ordinary links, including same-origin paths.

## Constraints and assumptions

- Python 3.12, FastAPI, React/Vite, SQLite WAL, existing `httpx` dependency.
- One API process. The in-process lock is already correct under this
  assumption; the scheduler does not try to solve multi-worker coordination.
- The API may be stopped, asleep, or restarted at the configured time.
- The browser session/token persists and normally needs no Duo approval. If an
  auth failure does occur, the existing re-auth path may prompt; a scheduled
  run must not retry repeatedly.
- LLM calls are optional and best-effort. A failed or slow model call must
  never fail a sync or leave the digest empty.
- The user's configured `timezone` applies. Empty means the server's local
  timezone.

## Approaches considered

### Scheduling

1. **In-process checker (chosen).** A daemon thread started by FastAPI lifespan
   checks once a minute, reads the current `Config.load()`, and calls the
   existing sync trigger. State is one small JSON file next to `settings.yaml`.
   Changes apply without restart. This fits the single-process deployment and
   needs no new dependency.
2. **Host cron / systemd timer.** Independent of the web process, but every
   settings change would have to rewrite host or container configuration. That
   fights the user-facing Settings requirement and is deployment-specific.
3. **A scheduling library.** More durable in multi-process deployments, but
   this app is explicitly single-process and one daily job does not warrant a
   dependency or a job store.

### Log and digest

1. **Keep one file (rejected).** Smallest change, but the two views keep
   duplicating each other — the exact complaint.
2. **Deterministic-only separation.** A cleaner log and a templated digest with
   links. Predictable and free, but still mechanical prose.
3. **Structured AI with fallback (chosen).** Deterministic code collects
   change cards with server-owned links, then one bounded LLM call turns them
   into a short narrative. Markers are replaced with the exact links. If the
   model is unavailable, the deterministic renderer produces the digest.
4. **Free-form AI over raw content (rejected).** More context, but expensive,
   sends much more data off-host, and invites invented claims. Not needed for
   “new slides, changed announcement, new deadline”.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scheduler location | FastAPI lifespan + `api/scheduler.py` | Uses existing settings and trigger; no infra changes |
| Check interval | 60 seconds | One daily job; low overhead, no drift because due-time is computed from wall clock |
| On-time window when catch-up is off | 15 minutes after the scheduled time | A running process need not hit the exact minute; a process started later has genuinely missed it |
| Catch-up unit | One local calendar date | A full sync sweeps all courses, so one run covers any number of missed days |
| Schedule state | `<settings-dir>/auto_sync_state.json` | Anchored the same way as settings, writable in Docker, not part of user config |
| Settings | `auto_sync_enabled`, `auto_sync_time`, `auto_sync_catch_up` | Small, explicit contract; no interval/cron syntax for a once-daily feature |
| Defaults | off, `03:00`, catch-up on | Preserve existing behaviour until enabled; after enabling, “catch up” is the user's requested default |
| Trigger label | `cron` in `sync_runs.trigger` | Schema already supports it; makes scheduled runs distinguishable in history |
| Log storage | one markdown file per run under `sync_logs/runs/` | Two manual runs on the same day must not overwrite each other |
| Digest storage | `sync_logs/digest.md`, plus legacy fallback | One current digest; old daily files remain readable after upgrade |
| Links | Server-owned markers replaced after model output | The model cannot invent a URL or a file ID |
| AI failure | Deterministic fallback, logged | Sync correctness never depends on the LLM |

## Architecture

```text
Settings UI ──PUT /api/settings──▶ settings.yaml
                                      │
                                      ▼
                              Config.load()
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
api/scheduler.py               SyncEngine.run(trigger)        digest renderer
  due? ─▶ services.trigger_sync  collects enriched deltas      + one optional
  state file                     builds SyncReport              LLM call
        │                             │                             │
        ▼                             ▼                             ▼
  one cron run                 runs/<date>/<id>.md          sync_logs/digest.md
                                      │                             │
                                      ▼                             ▼
                            GET /api/sync/runs/:id/log   GET /api/digest/latest
                            (SyncPage markdown)          (Home markdown)
```

## Configuration contract

### New `Config` fields in `sync/config.py`

| Field | Type | Default | Env var | Meaning |
| --- | --- | --- | --- | --- |
| `auto_sync_enabled` | `bool` | `False` | `CAMPUS_AUTO_SYNC_ENABLED` | Master switch |
| `auto_sync_time` | `str` | `"03:00"` | `CAMPUS_AUTO_SYNC_TIME` | 24-hour local time, one run per day |
| `auto_sync_catch_up` | `bool` | `True` | `CAMPUS_AUTO_SYNC_CATCH_UP` | Run once after a missed slot instead of skipping the day |

- Add the bools to `_BOOL_ENV_ATTRS`.
- `auto_sync_time` from config.yaml/env is not re-validated on load; the
  scheduler treats an unparseable value as disabled and logs a warning. Web
  writes are validated.
- These are ordinary top-layer settings; no new precedence rules.

### New fields in `api/settings_fields.py`

- `auto_sync_enabled`: `Field(kind="bool", group="sync", validate=v_bool)`.
- `auto_sync_time`: `Field(kind="time", group="sync", validate=v_clock,
  empty="reject")`. `v_clock` accepts exactly `HH:MM`, `00 ≤ HH ≤ 23`,
  `00 ≤ MM ≤ 59`; it rejects empty. The UI maps an empty time input to `null`
  (delete override), not `""`.
- `auto_sync_catch_up`: `Field(kind="bool", group="sync", validate=v_bool)`.
- Add `"time"` to `_TRIMMED_KINDS` in `api/routers/settings.py`.
- Update `tests/test_settings.py::test_registry_shape` with the three new keys.

### Frontend fields in `web/src/settings/`

- Extend `SettingsField.kind` with `"time"`.
- Render `field.kind === "time"` as `<input type="time">`; empty → `onChange(null)`.
- Add labels/help in `fieldMeta.tsx`, group `sync`:
  - “Automatic sync” — “Run Brightspace sync once a day.”
  - “Sync time” — “24-hour time in the timezone below.”
  - “Catch up missed syncs” — “If Campus was off at that time, sync once when
    it starts. One full sync covers all missed days.”
- Keep `timezone` adjacent so the relationship is visible.

## Scheduler behaviour

New module `api/scheduler.py`, with pure helpers plus a small lifecycle class.

### Due-time rule

Given local now, configured `HH:MM`, timezone, and catch-up flag:

- No run before the configured time on the local date.
- `catch_up = true`: if now is at or after the configured time, the current
  local date is due.
- `catch_up = false`: the current local date is due only from the configured
  time through `+15 minutes`; later, the slot is skipped.
- One date is attempted at most once, even if settings change later that day.

This means:

- App off for three days, starts at 10:00, scheduled 03:00, catch-up on → one
  sync immediately.
- Same, catch-up off → no sync until tomorrow at 03:00.
- App starts at 02:59 → nothing until 03:00.
- User enables auto-sync at 17:00 with 03:00 and catch-up on → one sync on the
  next checker tick. This is intended: “catch up” means catch up.

### State file

`<settings_path().parent>/auto_sync_state.json`:

```json
{"last_date": "2026-11-18", "last_timezone": "America/Toronto"}
```

- Read tolerantly: missing, corrupt, or wrong-shape file means “no prior run”.
- Write atomically with `sync.token_store.write_secret(..., chmod_parent=False)`.
- If `last_date` equals today's local date **and** `last_timezone` equals the
  effective timezone name, skip. A timezone change invalidates the memory and
  allows one run; document this as deliberate.
- Write state **after** `trigger_sync()` returns `started`, not before. If it
  returns `in_progress`, do not write state; a later tick will retry once the
  manual sync finishes.
- A run that starts and then fails is still attempted. No same-day retry loop.

### Lifecycle

- `AutoSyncScheduler.start()` launches one daemon thread and sets a stop event.
- `stop()` sets the event and joins with a short timeout.
- `api/main.py` creates/starts it in a FastAPI `lifespan` and stops it on
  shutdown. Do not start it at import time.
- Each tick:
  1. `cfg = Config.load()` — fresh, so Settings changes apply without restart.
  2. If disabled or time unparseable, log only on state transition and return.
  3. Compute due date and read state.
  4. If due, call `services.trigger_sync(trigger="cron")`.
  5. On `started`, write state; on `in_progress`, leave it for the next tick.
  6. Catch and log every exception. The checker thread must never die.

### Trigger plumbing

- `api/services.py::trigger_sync(course_id=None, trigger="manual")` passes
  `trigger` through to `SyncEngine.run`.
- `SyncEngine.run(code=None, dry_run=False, trigger="manual")` calls
  `self.db.start_sync(trigger)`. Only the scheduler passes `"cron"`.
- Existing callers and tests that use no `trigger` argument keep manual
  behaviour.

### Status reporting

Extend `GET /api/sync/status` with:

```json
{
  "auto_sync": {
    "enabled": true,
    "time": "03:00",
    "catch_up": true,
    "timezone": "America/Toronto",
    "last_attempt_date": "2026-11-18"
  }
}
```

`timezone` is the configured name or `"local"`. SyncPage shows a compact line
such as “Auto sync: daily at 03:00 · catch-up on” when enabled. No countdown is
required.

## Sync report and log contract

### Delta enrichment

At every `self.deltas.append` for a file, add:
`course_id`, `title` (basename), `file_id`, and `node_id` when known. The four
capture points are `_download_topic_file`, `sync_embedded`, `sync_module_media`,
and `_download_assignment_attachments`.

Announcement deltas additionally get `announcement_id` from the upsert result
if available, or from a lookup by `brightspace_id` after the upsert.

Helper in `sync/sync.py` or a small `sync/report.py`:

```python
content_href(course, file_id, node_id, rel) -> str | None
```

- With `node_id`: `/courses/{course_id}/content/{node_id}?file={file_id}`.
- Without `node_id` but with a course-relative path:
  `/courses/{course_id}/workspace?path={encoded_rel}`.
- Announcement: `/courses/{course_id}#announcement-{announcement_id}`.
- Otherwise no link; the title remains plain text.

Do not use `data_root`-relative paths in workspace links — strip the
`{term}/{code}/` prefix first.

### Report shape

Build one plain dict/dataclass per run. Suggested fields:

```text
run_id, started_at, finished_at, duration_s, trigger, status,
courses_checked, courses_changed, stats, changes[], failures[], warnings[]
```

`changes[]` entries carry a stable marker (`c1`, `c2`, ...), course code/id,
kind, title, optional detail/excerpt, and optional `href`. Only real changes
become entries; “no changes” courses do not.

Failures include per-course LMS errors, mining failures, **hard** extraction
failures, and top-level sync errors. A hard extraction failure is an exception
raised while extracting a file that was going to be processed. Deliberate
skips — oversize files, long scanned PDFs, unsupported types, or office files
not eligible for conversion — are not failures and must not be listed.
`run_extraction_queue()` should return or record a `failed` count so the report
can include it. Warnings include “auto-sync skipped: time invalid”.

### Log renderer

`render_sync_log(report)` is pure and deterministic. It replaces the current
per-course-count renderer and is called with the enriched report.

Required shape:

```md
# Sync run 1842 · 2026-11-18 03:00 · 1m 42s · ok · scheduled

Checked 6 courses · 2 changed · 4 new files · 1 changed file · 2 announcements

## Changes

- **SE 3352A** — 3 changes
  - [Week 11 slides.pdf](...)
  - [Assignment 4 brief.pdf](...)
  - [Room change for Friday's lab](...)
- **SE 3316A** — 1 change
  - [Course outline 2026.pdf](...)

## Extracted

+2 facts · +1 event · backfilled 1 assignment

## Problems

None.
```

Rules:

- No per-course “no changes” lines.
- If there are no changes, write “No course content changed.” once.
- If there are no problems, write `None.` rather than omitting the section.
- Titles are escaped for Markdown; hrefs come only from the helper above.
- Keep the old pure function name if convenient, but its signature is internal
  and `tests/test_mine.py::test_render_sync_log_deterministic` should be updated.

### Storage

- Log: `data_root/sync_logs/runs/YYYY-MM-DD/{run_id}.md`. Set
  `sync_runs.log_path` to this absolute path.
- Digest: `data_root/sync_logs/digest.md`, overwritten on successful runs only.
- Digest metadata: `data_root/sync_logs/digest.meta.json`, written atomically
  beside the digest with `generated_at` (ISO timestamp) and `generated_by`
  (`ai` or `deterministic`). The fixed filename cannot supply `generated_at`
  the way a dated filename did.
- A top-level failed sync writes its run log and updates `sync_runs`, but does
  **not** overwrite `digest.md` or its metadata. The digest remains the last
  good sweep; failures are visible in Sync history and `Needs attention` on the
  next successful digest. Never tell the user “nothing changed” after a sweep
  that did not finish.
- `services.get_sync_log()` keeps using `sync_runs.log_path`; no API contract
  change.
- `services.get_digest()` prefers `digest.md`; if absent, falls back to the
  newest legacy `YYYY-MM-DD.md` so existing installs keep working.
- `get_digest()` reads `digest.meta.json` when present; otherwise it uses
  legacy fallback values (`generated_by="legacy"`, `generated_at` from the
  dated file stem or mtime). Add `generated_by` to the response. Keep `source`
  as the file path for compatibility.

## Digest contract

### Change cards

Before the LLM call, deterministically select up to 40 meaningful changes:
new/changed files, new announcements, item-level date/grade changes from
mining, and failures. Each card is bounded:

- title ≤ 120 chars
- excerpt ≤ 240 chars (announcements only)
- course code, kind, marker, and server-owned href

The payload contains no full PDF text and no raw announcement HTML.

### Item-level mining records

Today `mine_course()` returns only counts, so a digest built from it could only
restate counts. Extend the mining contract to return the actual inserted items:

- `apply_mining()` returns its existing counts plus an `items` list. Each item
  has `kind` (`fact`, `event`, `exam`, `assignment`), `title`/`fact`, optional
  `starts_at`/`due_at`/`weight`, and the inserted/updated row id when available.
- `mine_course()` returns the same shape, accumulating `items` across courses.
  Existing count keys stay so current callers and tests can be migrated
  mechanically; the digest uses `items`.
- `SyncEngine.run()` passes this richer result into the report. No new database
  table is needed: the records are the rows just written by `apply_mining()`.
- Cards for events/exams/assignment updates use the existing calendar or
  assignment routes where an id exists; facts without a target link to the
  course hub. Do not infer provenance from a file path.

### AI call

New module `sync/digest.py`, function `make_digest(cfg, model, report) -> tuple[str, str]` returning `(markdown, generated_by)`.

- If `cfg.llm_endpoints()` is empty → deterministic fallback.
- One `POST {endpoint}/chat/completions` using existing `llm_headers(cfg)`,
  bounded timeout (60s), no retry beyond the client's normal transport.
- Prompt requirements:
  - At most 250 words.
  - Sections `## What changed` and `## Watch out for`, plus `## Needs attention`
    only when failures exist.
  - Only claims supported by change cards.
  - Reference each claim with its marker, e.g. `[c3]`.
  - Never write URLs; markers are the only link syntax.
  - If nothing changed and nothing failed, say so and omit link markers.
- Validate output: cap at 8000 chars; strip code fences; if empty or malformed,
  use fallback.
- Strip model-authored links before substitution: remove `[text](url)`,
  `<url>`, and bare `http(s)://` URLs from the model text. A model that ignores
  “markers only” must not leave a live off-host link in the digest.
- Replace `\[c\d+\]` with `[escaped title](href)` from the card map. Drop unknown
  markers. This is the only way links enter the digest.
- Log model failure at warning level; never raise into `SyncEngine.run`.

### Deterministic fallback

`render_digest_fallback(report)` produces the same sections from the change
cards without a model:

- `## What changed`: up to 8 grouped bullets with links.
- `## Watch out for`: mined events/exams/assignment updates only, text with
  course link.
- `## Needs attention`: failures when present.
- Empty case: “Nothing new in Brightspace since the last sync.”

### Example output

```md
## What changed

- **SE 3352A** — New Week 11 slides and an updated Assignment 4 brief. [Week 11 slides](...), [Assignment 4 brief](...)
- **SE 3316A** — The course outline now lists the midterm as 25%. [Course outline](...)

## Watch out for

- Assignment 4 is back on Friday. [Assignment 4](...)

## Needs attention

- SE 3310A: LMS sync failed — 403 on /content/topics/123
```

## Frontend changes

- `SyncPage.tsx`: render `syncLog(...).markdown` through `ZenMarkdown` instead
  of a plain text div, so log links work. Keep the `.log-view` container.
- `TodayPage.tsx`: no visual redesign required; it already renders the digest
  through `ZenMarkdown`. Extend the local `Digest` type with `generated_by?`.
- Add internal-link handling to `ZenMarkdown` or a small wrapper: clicks on
  same-origin `/courses/...` links should use React Router `navigate()` rather
  than a full page reload. External links keep current behaviour.
- `CourseHubPage.tsx`: give each announcement row
  `id="announcement-{id}"` and scroll it into view when the URL hash matches.
  Without this, announcement digest links land on the course hub but not the
  item.

## Tests

### Config and settings

- New fields round-trip through settings.yaml and report `source`.
- `v_clock` accepts `00:00`, `23:59`, `7:05` in the UI sanitized to `07:05`
  only if the input supplies it; rejects `24:00`, `12:60`, `abc`, `""`.
- Env vars set the new config fields; bool env parsing handles `0`/`1`.
- Registry shape test updated.

### Scheduler (pure + integration)

- Before time → no run; at/after time with catch-up → run once.
- Catch-up off inside the 15-minute window → run; outside → skip.
- Same date twice → skip.
- Corrupt state file → treated as no prior run.
- Timezone changes due boundary correctly; invalid timezone → skipped with log.
- `trigger_sync()` returning `in_progress` does not write state.
- Settings change is observed on the next tick without restart.
- `trigger_sync(trigger="cron")` results in a `sync_runs` row with `trigger=cron`.
- Manual trigger still records `manual`.

### Log and deltas

- File delta helpers include `course_id`, `file_id`, and `title`.
- Announcement delta includes `announcement_id`.
- `render_sync_log` omits unchanged courses, includes duration/status/trigger,
  lists actual titles, and has deterministic output for the same report.
- No-change report contains “No course content changed.” and no course bullets.
- Failures appear under `## Problems`.

### Digest

- No LLM configured → `generated_by == "deterministic"` and links are present.
- Mocked LLM returns markers → exact server hrefs substituted; invented URLs in
  model text are stripped, including raw markdown links and bare URLs.
- Unknown marker is dropped.
- `apply_mining()`/`mine_course()` return item-level records for inserted events,
  exams, facts, and assignment updates; the digest turns them into cards with
  working links.
- A top-level failed run leaves `digest.md` and its metadata untouched.
- Model failure/empty response → fallback.
- Payload is bounded: ≤40 cards, excerpt lengths capped.
- Failures produce `## Needs attention`.
- `get_digest()` prefers `digest.md`, falls back to legacy daily file.

### Frontend

- Time field renders as `<input type="time">` and saves the selected value.
- Digest/log links use React Router navigation (unit-tested helper if needed).
- Announcement hash scroll is covered by a component test or a simple DOM test
  if the existing setup supports it; otherwise manual verification is noted.

## Documentation

- `README.md`: replace “sync you trigger, not a background scrape” with the
  opt-in once-daily model; keep the MFA explanation but say the saved session
  normally avoids prompts.
- `docs/DESIGN.md`: update the “Manual / nudged (MFA push)” and “Background LMS
  sync” lines to match the new decision.
- `docs/CONFIGURATION.md` and `config.example.yaml`: document the three new
  settings, defaults, timezone interaction, and state file location.
- `docs/WEB_UI.md`: mention the new Settings fields and the separate log/digest.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scheduled run starts while manual run is active | Reuse `services.trigger_sync`; on `in_progress`, do not mark the date and retry next tick |
| Catch-up fires immediately after enabling | Documented; catch-up is on by default at the user's request. Turn it off or choose a future time |
| Duo prompt at an inconvenient time | Existing token normally avoids it; one auth attempt, no loop; failure recorded and notified |
| LLM produces bad markdown or invents links | Marker-only links, output cap, validation, deterministic fallback |
| Two syncs same day overwrite log | Per-run log path keyed by run id |
| Legacy digest disappears on upgrade | `get_digest()` fallback to newest legacy daily file |
| Settings file unwritable | Scheduler still runs from config/env; state write failure is logged, not fatal to sync |

## Builder discretion

The following are minor and may be settled while planning without another
round with the user: helper names, exact CSS classes, whether the report is a
dataclass or a plain dict, exact order of Settings fields within the sync
group, the 60-second check interval (±15s is fine), whether `auto_sync_time`
accepts `H:MM` from config.yaml in addition to `HH:MM`, and the exact copy of
the SyncPage status line.

## Approval gate

This document is the approval request. Product code, migrations, dependency
changes, and UI implementation start only after the user approves it.
