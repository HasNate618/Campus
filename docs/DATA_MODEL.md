# Data model

SQLite schema: `schema.sql`. On-disk course content lives under
`{data_root}/{term}/{code}/` (config `data_root`, e.g. `./school` in dev).
**AI and automation must not UPDATE/INSERT structured rows except through
audited write paths** (see Write rules).

Timezone for user-facing datetimes: configurable (`TIMEZONE`, default
`America/Toronto`). Store as ISO-8601 local or UTC consistently; document the
choice in sync code and stick to it (prefer local wall time with offset or
naive local + documented TZ).

## Tables

### `courses`

Registrar + LMS link. `code` unique (e.g. `CS 1100A`). `term` like `2026F` /
`2027W`. `brightspace_org_unit_id` set by sync. `is_pilot` marks the first
synced fixture. `is_active` filters default UI/sync sets.

### `course_sessions`

LEC/LAB/TUT weekly meetings, seeded from the registrar or imported from an
ICS feed. Not from LMS content. Used to materialize class `events`.

### `assignments`

Due work. Prefer LMS dropbox folders as source; AI/user may extend `due_at`
and edit `notes` (status `extended`). `brightspace_folder_id` for dedupe.
**No grade calculator** — `weight` is informational only if present.

### `exams`

Midterms/finals (manual, AI-from-syllabus, or quizzes mapped later). Keep
separate from dropbox assignments.

### `lectures`

One row per meeting/instance: date, topic, summary, paths to
slides/transcript/recording. Filled by schedule materialization + digests +
recordings.

### `content_nodes`

LMS content tree: modules and topics. `brightspace_id` + `course_id` unique.
`parent_id` self-FK. `node_type` `module` | `topic`. `topic_type` `file` |
`link` | `html` | `other`. Optional `due_at`, `is_hidden`, `is_locked`.
Enables browse UI and sync diffs without walking the filesystem alone.

### `files`

Content-addressed file index (`path` unique relative to course dir, `sha256`
for change detection). Optional `content_node_id` when the file came from a
topic. `processed` = markdown extracted / ready for search. Sources: lms,
recording, cloud mirror, manual.

### `announcements`

LMS news. Dedupe on `brightspace_id`. Body as markdown.

### `notes`

User or AI markdown notes. `course_id` NULL = general.

### `memory_facts`

Short durable facts. `course_id` NULL = cross-course. Supersede by setting
`is_active = 0` and inserting a new row — do not silently rewrite history.
Categories constrained in schema.

### `events`

**In-app calendar source of truth.** Kinds: class, assignment, exam,
personal. Stable `ics_uid` if export added later. Regenerated/updated when
sessions, dues, or AI notes change.

### `work_links`

Pointers to external work homes per course: `kind` `git` | `cloud` | `other`,
`url` or `path`, label. Harness does not clone/sync git as source of truth
in v1.

### `sync_runs`

One row per LMS sync attempt. Counts + `log_path` to AI markdown sync log +
`error`.

### `audit_log`

Every meaningful mutation by `system` | `ai` | `user` | `sync`. `detail` =
JSON before/after (or equivalent). Enables revert and distrust-but-verify of
AI edits.

## On-disk layout (convention)

```
{root}/{term}/{code}/
  content/          # LMS files (mirror tree or flat with nodes in DB)
  lectures/
  recordings/
  notes/
  sync_logs/        # AI sync logs (markdown)
  syllabus.md       # optional
```

Plus optional `{root}/cloud/` mirror (later phase).

## Write rules

| Actor | May write | Must |
|-------|-----------|------|
| `sync` | courses link ids, content_nodes, files, assignments (from dropbox), announcements, sync_runs, syllabus_path | Prefer upsert by LMS ids; do not clobber user `notes` on assignments without merge |
| `ai` | memory_facts, lecture digests, assignment notes/due extensions, events notes, sync log text | **Always** `audit_log`; never delete facts — supersede |
| `user` | notes, work_links, manual assignments/exams, event tweaks | audit recommended for due-date changes |
| `system` | materialized events from sessions, cron digests metadata | audit if mutating user-visible dues |

**Reads:** AI may read all tables + processed markdown freely (respect course
scope when user is in a course context).

## Search (later phase)

Index processed markdown from `files` / lecture transcripts / notes.
Structured questions (“when is X due”) should hit SQL first, not vectors.

## Pilot seeding

`seed/courses.example.json` ships sample courses (e.g. `CS 1100A`, term
`2026F`, `is_pilot = 1`). A local `seed/courses.local.json` (gitignored)
overrides with real enrollments; `brightspace_org_unit_id` is filled on the
first successful enrollment match during sync.
