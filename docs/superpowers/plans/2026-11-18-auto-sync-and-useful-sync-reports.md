# Daily auto-sync, useful sync logs, and an AI-assisted digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable once-daily guarded sync with missed-run catch-up, and split operational sync logs from a concise AI-assisted digest with server-owned links.

**Architecture:** The in-process scheduler reads live config each minute and calls the existing `services.trigger_sync` guard, recording one local date per attempt. `SyncEngine` enriches deltas with IDs/titles, builds a `SyncReport`, writes a per-run log, and generates a separate digest from bounded cards; the LLM only sees markers and the server substitutes exact links. A FastAPI lifespan owns the checker thread; existing config/settings layers and the existing `sync_runs` table carry the rest.

**Tech Stack:** Python 3.12, FastAPI, SQLite, PyYAML, httpx, React/Vite, TypeScript, pytest.

**Spec:** `docs/superpowers/specs/2026-11-18-auto-sync-and-useful-sync-reports-design.md`

## Global Constraints

- One opt-in automatic sync per day at a configurable local time.
- Catch-up on by default: one full sync after a missed slot covers all missed days.
- Defaults: `auto_sync_enabled=False`, `auto_sync_time="03:00"`, `auto_sync_catch_up=True`.
- Check interval: 60 seconds. On-time window when catch-up is off: 15 minutes after the scheduled time.
- One local calendar date is attempted at most once; write state only after `trigger_sync()` returns `started`.
- Manual and scheduled runs must use the same guard; scheduled runs use `sync_runs.trigger = "cron"`.
- No new service, dependency, database table, or host-level cron. Deployment is one uvicorn process.
- Use the existing `timezone` setting; empty means server-local time.
- No full documents sent to the LLM: titles, short announcement excerpts, and mined facts/events only.
- Model-authored URLs are disallowed; only server-owned markers become links.
- LLM failure degrades to deterministic digest and must never fail a sync.
- A failed sweep must not overwrite the last good digest or claim “nothing changed.”
- No per-course “no changes” lines in logs.
- Do not count deliberate extraction skips as failures; count only hard extraction failures.
- Git commits require explicit user approval in this session; leave changes uncommitted until asked.

## Review Focus

- **App asleep for several days, then starts after 03:00 with catch-up on:** exactly one sync must run. Test: `tests/test_scheduler.py::test_catch_up_runs_once_after_missed_days`.
- **Manual sync already active when the checker fires:** no second sync starts and the date is not consumed. Test: `tests/test_scheduler.py::test_in_progress_does_not_mark_date`.
- **Model ignores “markers only” and emits a raw markdown URL:** no live off-host link may survive. Test: `tests/test_digest.py::test_raw_model_links_are_stripped`.
- **Top-level auth/LMS failure before a sweep finishes:** previous digest remains and no “nothing changed” claim is written. Test: `tests/test_digest.py::test_failed_run_does_not_overwrite_digest`.
- **Quiet courses and deliberate extraction skips:** they must not appear as noise or problems. Tests: `tests/test_report.py::test_log_omits_unchanged_courses` and `tests/test_report.py::test_extraction_skips_are_not_failures`.

---

### Task 1: Configuration and settings fields

**Files:**
- Modify: `sync/config.py`
- Modify: `api/settings_fields.py`
- Modify: `api/routers/settings.py`
- Modify: `web/src/settings/useSettings.ts`
- Modify: `web/src/settings/SettingsBody.tsx`
- Modify: `web/src/settings/fieldMeta.tsx`
- Test: `tests/test_config.py`
- Test: `tests/test_settings.py`

**Interfaces:**
- Consumes: existing `Config` layering, `REGISTRY`, `normalize()`, settings UI renderer.
- Produces: `Config.auto_sync_enabled: bool`, `Config.auto_sync_time: str`, `Config.auto_sync_catch_up: bool`; env names `CAMPUS_AUTO_SYNC_ENABLED`, `CAMPUS_AUTO_SYNC_TIME`, `CAMPUS_AUTO_SYNC_CATCH_UP`; `REGISTRY` keys of the same names; `"time"` field kind.

- [ ] **Step 1: Write failing config tests**

Add to `tests/test_config.py`:
- `test_auto_sync_defaults_are_portable`: `Config()` has `False`, `"03:00"`, `True`.
- `test_auto_sync_env_overrides`: env bool `0`/`1`, time string, catch-up bool parse correctly through `Config.load()`.
- Assert `settings_path()` still anchors `auto_sync_state.json` beside settings via the scheduler task later (no test here).

- [ ] **Step 2: Run them**

Run: `pytest tests/test_config.py::test_auto_sync_defaults_are_portable tests/test_config.py::test_auto_sync_env_overrides -q`
Expected: FAIL on missing attributes.

- [ ] **Step 3: Add the three Config fields**

In `sync/config.py`: add the dataclass fields near `timezone`; add the three env mappings to `ENV_OVERRIDES`; add the two bool attrs to `_BOOL_ENV_ATTRS`. Keep all existing defaults and portable-default contract unchanged.

- [ ] **Step 4: Write failing settings tests**

Add to `tests/test_settings.py`:
- `test_clock_validation`: `v_clock` accepts `"03:00"`, `"00:00"`, `"23:59"`; rejects `"24:00"`, `"12:60"`, `"7:05"` from the API, `"abc"`, and `""` through `normalize()`.
- Update `test_registry_shape` expected set with `auto_sync_enabled`, `auto_sync_time`, `auto_sync_catch_up`.

- [ ] **Step 5: Run them**

Run: `pytest tests/test_settings.py::test_clock_validation tests/test_settings.py::test_registry_shape -q`
Expected: FAIL on missing keys.

- [ ] **Step 6: Add registry and API kind support**

In `api/settings_fields.py`: add `v_clock(v) -> str` using `re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v)`; add three `Field(..., group="sync")`, with `auto_sync_time` using `empty="reject"`. In `api/routers/settings.py`: add `"time"` to `_TRIMMED_KINDS`.

- [ ] **Step 7: Add frontend time field support**

- `web/src/settings/useSettings.ts`: extend `SettingsField.kind` union with `"time"`.
- `web/src/settings/SettingsBody.tsx`: add a `field.kind === "time"` branch before the text fallback rendering `<input type="time">`; empty value calls `onChange(null)`.
- `web/src/settings/fieldMeta.tsx`: add three entries in group `sync` with labels/help from the design; keep `institution` order 2 and `timezone` order 3, put `auto_sync_enabled` order 1, `auto_sync_time` order 4, `auto_sync_catch_up` order 5.

- [ ] **Step 8: Run tests and diagnostics**

Run: `pytest tests/test_config.py tests/test_settings.py -q`
Run: `lens_diagnostics source=lsp scope=paths paths=["web/src/settings/useSettings.ts","web/src/settings/SettingsBody.tsx","web/src/settings/fieldMeta.tsx"] severity=all`
Expected: PASS, no TS diagnostics.

- [ ] **Step 9: Commit**

```bash
git add sync/config.py api/settings_fields.py api/routers/settings.py web/src/settings tests/test_config.py tests/test_settings.py
git commit -m "feat: add auto-sync settings fields"
```

### Task 2: Enriched deltas, mining items, and hard extraction failures

**Files:**
- Modify: `sync/mine.py`
- Modify: `sync/sync.py`
- Test: `tests/test_mine.py`
- Test: `tests/test_sync_deltas.py` (new)

**Interfaces:**
- Consumes: `self.deltas`, `apply_mining`, `mine_course`, `run_extraction_queue`.
- Produces: file deltas with `course_id`, `title`, `file_id`, `node_id?`; announcement deltas with `announcement_id`; mining dicts with `items: list[dict]`; `SyncEngine.extraction_failures: list[str]`.

- [ ] **Step 1: Write failing mining item tests**

In `tests/test_mine.py`, change `test_apply_mining_dedupes_and_backfills` to assert counts via `{k: r1[k] for k in ("facts","events","exams","assignments")}` and add assertions:
- `r1["items"]` contains one item of each kind with non-empty `title`.
- The exam item has `ref_id` equal to the inserted `exams.id`.
- The assignment item has `href_target` equal to the updated assignment id.
- `r2["items"] == []`.

Add `test_mine_course_returns_items`: extend the existing fake miner result with one event and assert `out["items"]` survives `mine_course()`.

- [ ] **Step 2: Run them**

Run: `pytest tests/test_mine.py::test_apply_mining_dedupes_and_backfills tests/test_mine.py::test_mine_course_returns_items -q`
Expected: FAIL because `items` is absent.

- [ ] **Step 3: Extend `apply_mining()`**

In `sync/mine.py`: initialize `res = {"facts": 0, "events": 0, "exams": 0, "assignments": 0, "items": []}`. Append an item on every successful insert/backfill with shape:
`{"kind": "fact"|"event"|"exam"|"assignment", "title": str, "detail": str|None, "ref_id": int|None, "href_target": int|None, "starts_at": str|None}`.
Keep audit calls and dedupe behaviour unchanged. In `mine_course()`, return `apply_mining()` output directly; on the no-delta/no-corpus/failure paths return the same shape with `items=[]`.

- [ ] **Step 4: Write failing delta enrichment tests**

Create `tests/test_sync_deltas.py`:
- `test_topic_file_delta_has_ids`: call `SyncEngine._download_topic_file` with a fake client returning PDF bytes and a DB with a matching content node; assert the appended delta has `course_id`, `title == filename`, `file_id`, and `node_id`.
- `test_announcement_delta_has_announcement_id`: call `sync_news` with a fake client item; assert delta has `announcement_id`.
- `test_extraction_hard_failure_recorded`: monkeypatch `extract_pdf` to raise/return false per the existing extraction path; assert `engine.extraction_failures` gets one entry and unsupported skips do not.

- [ ] **Step 5: Run them**

Run: `pytest tests/test_sync_deltas.py -q`
Expected: FAIL on missing fields/attribute.

- [ ] **Step 6: Enrich all delta append sites**

In `sync/sync.py`, add `course_id`, `title`, `file_id`, `node_id` to the four file-delta appends in `_download_topic_file`, `sync_embedded`, `sync_module_media`, `_download_assignment_attachments`. Use `node["id"]` or `topics[0]` where known. For assignment attachments, pass the assignment folder id as `node_id` only if the folder maps to a content node; otherwise leave `node_id=None` and keep `rel`. Add `announcement_id` to the announcement delta using the `brightspace_id` lookup after upsert. Add `self.extraction_failures: list[str]` in `__init__`; append only when `extract_pdf` or office conversion actually fails, not on unsupported/oversize/long-scan skips.

- [ ] **Step 7: Update dependent callers**

In `SyncEngine.run()`, mining failure fallback must be `{"facts": 0, "events": 0, "exams": 0, "assignments": 0, "items": []}`; `if any(mined.values())` must ignore the `items` key by checking the four count keys. In `mine_main()`, accumulate only count keys.

- [ ] **Step 8: Run tests and diagnostics**

Run: `pytest tests/test_mine.py tests/test_sync_deltas.py -q`
Run: `lens_diagnostics source=lsp scope=paths paths=["sync/mine.py","sync/sync.py","tests/test_sync_deltas.py"] severity=all`
Expected: PASS, no diagnostics.

- [ ] **Step 9: Commit**

```bash
git add sync/mine.py sync/sync.py tests/test_mine.py tests/test_sync_deltas.py
git commit -m "feat: enrich sync deltas and mining items"
```

### Task 3: Report, log renderer, and deterministic digest fallback

**Files:**
- Create: `sync/report.py`
- Modify: `sync/sync.py`
- Modify: `tests/test_mine.py`
- Test: `tests/test_report.py` (new)

**Interfaces:**
- Consumes: enriched deltas and mining `items` from Task 2.
- Produces: `SyncReport`, `ChangeCard`, `build_report()`, `render_sync_log(report)`, `build_change_cards(report, limit=40)`, `render_digest_fallback(report)`, `strip_model_links(text)`, `substitute_card_links(text, cards)`, `content_href(course, file_id, node_id, rel)`, `announcement_href(course_id, announcement_id)`.

- [ ] **Step 1: Write failing report tests**

Create `tests/test_report.py`:
- `test_log_omits_unchanged_courses`: report with 2 courses, one quiet; log contains the changed course title and no `"no changes"` substring.
- `test_log_has_operational_header`: log contains trigger, duration, status, `Checked`, and `## Problems` with `None.` when clean.
- `test_extraction_skips_are_not_failures`: report with `warnings=["1 skipped (unsupported type)"]` and no failures renders under a summary line, not `## Problems`.
- `test_fallback_digest_has_links_and_empty_case`: cards become markdown links; empty report says `Nothing new in Brightspace since the last sync.`
- `test_link_helpers_prefer_content_node`: `content_href` returns `/courses/7/content/12?file=9`, falls back to `/courses/7/workspace?path=...`, and returns `None` without ids.
- `test_strip_model_links`: removes `[x](https://evil)`, `<https://evil>`, bare `https://evil`, then `substitute_card_links` inserts only known markers.

- [ ] **Step 2: Run them**

Run: `pytest tests/test_report.py -q`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `sync/report.py`**

Define the dataclasses and pure functions above. `build_change_cards()` includes file deltas, announcement deltas, mining `items`, and failures, ordered by course then kind. Marker format is `c1`, `c2`, ... sequential in card order. Card titles escape markdown special characters. `strip_model_links()` must run before `substitute_card_links()`; drop unknown markers. `render_sync_log()` follows the design's exact section shape and never prints unchanged courses.

- [ ] **Step 4: Replace the old log renderer**

In `sync/sync.py`, import and re-export `render_sync_log` from `sync.report` for compatibility. Update `tests/test_mine.py::test_render_sync_log_deterministic` to call `render_sync_log(report)` with a `SyncReport` fixture and assert the new header/change/problem content rather than old count strings.

- [ ] **Step 5: Integrate report storage in `SyncEngine`**

Replace `digest_and_log()` with `write_run_artifacts(report) -> None`:
- create `sync_logs/runs/YYYY-MM-DD/<run_id>.md`, write `render_sync_log(report)`, set `sync_runs.log_path`;
- for this task, call `render_digest_fallback(report)` and write `sync_logs/digest.md` plus `digest.meta.json` with `generated_by="deterministic"` only when `report.status != "failed"`; Task 4 replaces the fallback call with `make_digest(self.cfg, self.model, report)`;
- skip digest generation entirely for `dry_run` and failed reports.
Also add `write_failure_log(run_id, error)` for the top-level exception path: writes only the run log with `## Problems`, never touches `digest.md`.

- [ ] **Step 6: Wire report construction into `run()`**

In `sync/sync.py::run()`: accept `trigger: str = "manual"`; pass it to `db.start_sync(trigger)`; record `started = time.time()` after start; collect `courses_checked`, `courses_changed`, `course_failures`, `mining_failures`, `extraction_failures`, `self.deltas`; build the report before `finish_sync()`; call `write_run_artifacts(report)` on success/partial. In the exception path call `write_failure_log()` and `finish_sync(..., "failed")`.

- [ ] **Step 7: Run tests and diagnostics**

Run: `pytest tests/test_report.py tests/test_mine.py::test_render_sync_log_deterministic -q`
Run: `lens_diagnostics source=lsp scope=paths paths=["sync/report.py","sync/sync.py","tests/test_report.py"] severity=all`
Expected: PASS, no diagnostics.

- [ ] **Step 8: Commit**

```bash
git add sync/report.py sync/sync.py tests/test_report.py tests/test_mine.py
git commit -m "feat: separate sync log from digest"
```

### Task 4: AI digest generation and digest API metadata

**Files:**
- Create: `sync/digest.py`
- Modify: `api/services.py`
- Modify: `web/src/pages/TodayPage.tsx` (type only)
- Test: `tests/test_digest.py` (new)
- Test: `tests/test_services_digest.py` (new)

**Interfaces:**
- Consumes: `SyncReport`, `build_change_cards`, `render_digest_fallback`, `strip_model_links`, `substitute_card_links` from Task 3; `cfg.llm_endpoints()`, `llm_headers(cfg)`.
- Produces: `make_digest(cfg, model, report) -> tuple[str, str]` returning `(markdown, "ai"|"deterministic")`; `digest.meta.json` sidecar; `get_digest()` response includes `generated_by`.

- [ ] **Step 1: Write failing digest tests**

Create `tests/test_digest.py`:
- `test_no_llm_uses_fallback`: `cfg.llm_urls=[]`, `cfg.llm_url=""` → `generated_by == "deterministic"`.
- `test_marker_substitution`: mocked LLM returns `What changed\n[c1]`, output has exact card href.
- `test_raw_model_links_are_stripped`: mocked output also contains `[evil](https://evil.example/x)` and `https://evil.example/y`; neither survives.
- `test_unknown_marker_dropped`.
- `test_model_failure_uses_fallback`: httpx raises; result is deterministic.
- `test_failed_run_does_not_overwrite_digest`: call `write_run_artifacts` with a failed report; existing `digest.md` and meta unchanged.
- `test_payload_is_bounded`: model request messages contain ≤40 cards and announcement excerpts ≤240 chars.

- [ ] **Step 2: Run them**

Run: `pytest tests/test_digest.py -q`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `sync/digest.py`**

In `sync/digest.py`, implement `make_digest(cfg, model, report)`:
- if no endpoints → fallback;
- build a system+user message listing only markers, course, kind, title, detail/excerpt, and href omitted from the prompt (the model must never see URLs);
- one `httpx.post(f"{endpoint}/chat/completions", headers=llm_headers(cfg), json=..., timeout=60)`;
- strip code fences, cap 8000 chars, call `strip_model_links()` then `substitute_card_links()`;
- on any exception or empty output → fallback;
- log warning with endpoint/model but never raise.

Update `SyncEngine.write_run_artifacts()` from Task 3 to call `make_digest(self.cfg, self.model, report)` and write the returned `generated_by` into `digest.meta.json`.

- [ ] **Step 4: Write failing API tests**

Create `tests/test_services_digest.py`:
- `test_get_digest_prefers_new_layout`: write `digest.md` + `digest.meta.json`, assert markdown/source/generated_at/generated_by.
- `test_get_digest_legacy_fallback`: only `2026-11-17.md` exists, assert `generated_by == "legacy"` and generated_at from stem.
- `test_get_digest_empty`: no files returns the existing empty shape plus `generated_by: "legacy"`.

- [ ] **Step 5: Run them**

Run: `pytest tests/test_services_digest.py -q`
Expected: FAIL because `generated_by` is absent.

- [ ] **Step 6: Update `get_digest()`**

In `api/services.py`, read `SCHOOL_ROOT / "sync_logs" / "digest.md"` and its `digest.meta.json` first; otherwise keep the dated-glob fallback. Add `generated_by` to all return shapes. Keep `source` as the absolute file path.

- [ ] **Step 7: Update frontend type and diagnostics**

Add `generated_by?: "ai" | "deterministic" | "legacy"` to `Digest` in `web/src/pages/TodayPage.tsx` without changing rendering. Run:
`pytest tests/test_digest.py tests/test_services_digest.py -q`
`lens_diagnostics source=lsp scope=paths paths=["sync/digest.py","api/services.py","web/src/pages/TodayPage.tsx"] severity=all`
Expected: PASS, no diagnostics.

- [ ] **Step 8: Commit**

```bash
git add sync/digest.py api/services.py web/src/pages/TodayPage.tsx tests/test_digest.py tests/test_services_digest.py
git commit -m "feat: generate AI-assisted digest with safe links"
```

### Task 5: Trigger plumbing, scheduler, lifespan, and status

**Files:**
- Create: `api/scheduler.py`
- Modify: `sync/config.py` (state path helper only if needed)
- Modify: `api/services.py`
- Modify: `api/routers/sync.py`
- Modify: `sync/sync.py`
- Modify: `api/main.py`
- Modify: `web/src/pages/SyncPage.tsx`
- Test: `tests/test_scheduler.py` (new)
- Test: `tests/test_trigger.py` (new)

**Interfaces:**
- Consumes: `services.trigger_sync(course_id=None, trigger="manual")` from Task 4 code; `Config.load()`; `settings_path()`.
- Produces: `parse_clock`, `due_date`, `ScheduleState(last_date: str | None, last_timezone: str | None)`, `read_state`, `write_state`, `state_path`, `AutoSyncScheduler.tick()`; `latest_sync_status()["auto_sync"]`.

- [ ] **Step 1: Write failing scheduler tests**

Create `tests/test_scheduler.py`:
- `test_parse_clock`: valid/invalid values.
- `test_before_time_not_due`.
- `test_catch_up_runs_once_after_missed_days`: now 3 days after slot, catch-up on → due; state same date → not due.
- `test_catch_up_off_window`: 5 minutes after → due; 30 minutes after → not due.
- `test_timezone_boundary`: `03:00` in `America/Toronto` is not due at 06:30 UTC in winter but is due at 08:30 UTC.
- `test_corrupt_state_file`: garbage path reads as empty state.
- `test_in_progress_does_not_mark_date`: monkeypatch `services.trigger_sync` to return `in_progress`; `tick()` result and state file unchanged.
- `test_settings_change_observed`: rewrite settings layer time; next tick uses new value without restart.

- [ ] **Step 2: Run them**

Run: `pytest tests/test_scheduler.py -q`
Expected: FAIL on missing module.

- [ ] **Step 3: Implement `api/scheduler.py`**

Use `zoneinfo.ZoneInfo(cfg.timezone)` when set, otherwise `datetime.now().astimezone().tzinfo`. `due_date(now, cfg, state, window=timedelta(minutes=15)) -> date | None` implements the design rule. State path: `settings_path(cfg).parent / "auto_sync_state.json"`; store `{"last_date": iso_date, "last_timezone": effective timezone name}`. Write atomically via `write_secret(..., chmod_parent=False)`. `AutoSyncScheduler.tick(now=None)` reads fresh `Config.load()`, logs state transitions, calls `services.trigger_sync(trigger="cron")` only when due, writes state only when result status is `started`, and catches/logs all exceptions. `start()`/`stop()` own one daemon thread and stop event.

- [ ] **Step 4: Write failing trigger tests**

Create `tests/test_trigger.py`:
- `test_scheduled_trigger_label`: monkeypatch the sync engine class in `api.services` so `engine.run` records its kwargs; call `trigger_sync(trigger="cron")`; assert `run_kwargs["trigger"] == "cron"`.
- `test_manual_trigger_default`: same with no argument; assert `"manual"`.
- `test_overlap_guard`: set `_sync_in_progress=True`, assert result `in_progress` and no engine constructed.

- [ ] **Step 5: Run them**

Run: `pytest tests/test_trigger.py -q`
Expected: FAIL because `trigger_sync` has no parameter.

- [ ] **Step 6: Plumb trigger through**

- `api/services.py::trigger_sync(course_id=None, trigger="manual")` passes `trigger` into both initial and D2L-auth-retry `engine.run()` calls.
- `sync/sync.py::SyncEngine.run(..., trigger="manual")` calls `self.db.start_sync(trigger)`.
- `api/routers/sync.py` keeps manual default unchanged.

- [ ] **Step 7: Add lifespan**

In `api/main.py`, add an `asynccontextmanager` lifespan that starts `AutoSyncScheduler()` before yield and stops it after. Pass `lifespan=lifespan` to `FastAPI(...)`. Do not start at import time.

- [ ] **Step 8: Extend status API**

In `api/services.py::latest_sync_status()`, add an `auto_sync` dict with `enabled`, `time`, `catch_up`, `timezone` (effective name or `"local"`), and `last_attempt_date` from `read_state(state_path(Config.load()))`. Never raise from this optional status block.

- [ ] **Step 9: Update SyncPage display**

In `web/src/pages/SyncPage.tsx`, render a compact line from the status response when enabled: `Auto sync: daily at {time} · catch-up on/off`. Add optional `auto_sync` typing; do not add a countdown.

- [ ] **Step 10: Run tests and diagnostics**

Run: `pytest tests/test_scheduler.py tests/test_trigger.py tests/test_settings.py -q`
Run: `lens_diagnostics source=lsp scope=paths paths=["api/scheduler.py","api/main.py","api/services.py","sync/sync.py","web/src/pages/SyncPage.tsx"] severity=all`
Expected: PASS, no diagnostics.

- [ ] **Step 11: Commit**

```bash
git add api/scheduler.py api/main.py api/services.py api/routers/sync.py sync/sync.py web/src/pages/SyncPage.tsx tests/test_scheduler.py tests/test_trigger.py
git commit -m "feat: add in-process daily sync scheduler"
```

### Task 6: Frontend log rendering, internal links, and announcement anchors

**Files:**
- Modify: `web/src/pages/SyncPage.tsx`
- Modify: `web/src/lib/ZenMarkdown.tsx`
- Modify: `web/src/pages/CourseHubPage.tsx`
- Test: frontend tests if the existing runner supports them; otherwise add a small helper test for internal-link detection in `web/src/lib/refs.ts` and note manual verification in the task summary.

**Interfaces:**
- Consumes: `ZenMarkdown`, existing router setup, digest/log markdown with `/courses/...` links.
- Produces: same-origin router navigation for markdown links; `announcement-{id}` anchors.

- [ ] **Step 1: Write a failing link detection test**

In `web/src/lib/refs.ts`, add and export `isInternalHref(href: string): boolean` returning true only for `/...` or same-origin absolute URLs. Add `web/src/lib/refs.test.ts` (or the project's existing test naming convention) asserting `/courses/1` true, `https://example.com/x` false, `mailto:` false.

- [ ] **Step 2: Run it**

Run: `npm --prefix web test -- src/lib/refs.test.ts`
Expected: FAIL on missing export.

- [ ] **Step 3: Implement router-aware markdown links**

In `web/src/lib/ZenMarkdown.tsx`, wrap rendered markdown in a click handler: for anchors whose href passes `isInternalHref`, call `preventDefault()` and `navigate(pathname + search + hash)` from `react-router-dom`. Leave external links and modifier-clicks to the browser.

- [ ] **Step 4: Render logs as markdown**

In `web/src/pages/SyncPage.tsx`, replace the plain log `<pre>`/text block with `<ZenMarkdown markdown={...} />` inside the existing `.log-view` container. Keep truncation/empty state.

- [ ] **Step 5: Add announcement anchors**

In `web/src/pages/CourseHubPage.tsx`, add `id={`announcement-${a.id}`}` to the announcement row element and scroll it into view on mount when `location.hash` matches. Keep existing styles/behavior otherwise.

- [ ] **Step 6: Run frontend checks**

Run: `npm --prefix web run build`
Run: `lens_diagnostics source=lsp scope=paths paths=["web/src/lib/refs.ts","web/src/lib/ZenMarkdown.tsx","web/src/pages/SyncPage.tsx","web/src/pages/CourseHubPage.tsx"] severity=all`
Expected: build passes, no diagnostics.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/refs.ts web/src/lib/ZenMarkdown.tsx web/src/pages/SyncPage.tsx web/src/pages/CourseHubPage.tsx
git commit -m "feat: make digest and log links work in-app"
```

### Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DESIGN.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `config.example.yaml`
- Modify: `docs/WEB_UI.md`

**Interfaces:**
- Consumes: final implemented field names/defaults.
- Produces: docs matching shipped behavior.

- [ ] **Step 1: Replace stale manual-only claims**

In `README.md` and `docs/DESIGN.md`, replace “sync you trigger, not a background scrape” / “Background LMS sync” framing with the opt-in once-daily checker, catch-up default, 60s check, and one guarded run. Keep the MFA explanation but say the saved session normally avoids prompts.

- [ ] **Step 2: Document settings and storage**

In `docs/CONFIGURATION.md` and `config.example.yaml`, document the three settings with defaults, env names, timezone interaction, and `auto_sync_state.json` location. In `docs/WEB_UI.md`, mention the Settings fields and the separate log/digest views.

- [ ] **Step 3: Verify doc claims**

Run: `rg -n "no background|manual only|sync you trigger|Background LMS" README.md docs/ config.example.yaml`
Expected: no stale claims remain.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DESIGN.md docs/CONFIGURATION.md config.example.yaml docs/WEB_UI.md
git commit -m "docs: describe daily auto-sync and digest"
```

### Task 8: Full verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: all tasks.

- [ ] **Step 1: Run full backend suite**

Run: `pytest -q`
Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 3: Run diagnostics on all touched files**

Use `lens_diagnostics source=lsp scope=paths` with the union of files from Tasks 1–6. Expected: no errors.

- [ ] **Step 4: Manual smoke checklist**

- Enable auto-sync in Settings at a time two minutes ahead; confirm status line appears.
- Confirm one run appears in Sync history with trigger `cron` after the selected time.
- Disable catch-up, stop the API past the slot, restart; confirm no immediate run.
- Re-enable catch-up, stop/restart past the slot; confirm exactly one immediate run.
- Press Sync while a run is active; confirm both paths report `in_progress` and no duplicate row.
- Open a digest link; confirm it navigates inside the SPA to the file/announcement.

- [ ] **Step 5: Report results and ask before git commit**

Do not commit without explicit user approval.
