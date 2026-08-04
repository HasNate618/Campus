# Brightspace sync — data shape & operations (proven 2026-08-04)

NOTE: backend-scoped lessons parked under this frontend skill because the
`campus` / `campus-school-harness` skills are cross-profile read-only here.
Curator may relocate.

## Descriptions are {Text, Html} — prefer Html
Brightspace content items (modules AND topics) send `Description` as
`{Text, Html}`. Storing `.Text` only FLATTENS: the Course Overview's
schedule table, module banner images, and embedded hyperlinks (e.g. the
Git and Unity tutorial link) only survive in `.Html`. Fix in the content
walk (sync/sync.py): `desc_obj.get("Html") or desc_obj.get("Text") or None`.

## Content image URLs are RELATIVE enforced paths
Module/topic HTML references images as `/content/enforced/155130-.../img.png`
— NO host. `tools/cache_images.py` originally only matched
`brightspace.com` / `s.brightspace.com` and skipped every enforced image
(the Project banner was never cached or rewritten). Fix:
- accept `src.startswith("/content/enforced/")` in the rewrite predicate
- resolve relative srcs against `cfg.base_url` for the download
  (`fetch_url = cfg.base_url + url if url.startswith("/") else url`)
- `_safe_name` must run on the RESOLVED url so the asset name matches.
Re-run `cache_course_images(cfg, db, course_id)` after every re-sync (new
descriptions bring new images). A "failed" count > 0 after a re-run =
dead images inside topic HTML files — benign.

## Assignment descriptions — the data ceiling
The dropbox folder endpoint does NOT ship descriptions; Western's folders
sometimes carry `CustomInstructions` ({Text, Html}). The sync reads
`Instructions` then `CustomInstructions` (Html preferred). Reality on
SE 2250B: **8/20 folders have them** (check-ins / team-formation tasks);
Labs 1–4, the main project tasks, and the self-assessment genuinely do NOT
(their instructions live in the content PDFs). 0 descriptions in the DB =
the sync predates the code, re-sync fixes it — NOT a bug. The
AssignmentsPage renders descriptions (ZenMarkdown) when present.

## Assignments: what the D2L API will NEVER give you (verified live)
Western's `le/1.24/{orgUnit}/dropbox/folders/` returns per folder: Id,
Name, CategoryId, CustomInstructions, DueDate, IsHidden, DisplayInCalendar,
Availability, TotalFiles/TotalUsers/TotalUsersWithSubmissions/
TotalUsersWithFeedback/UnreadFiles — and **no Weight, no Status, no
GradeItemId, no IsOpen** (checked field-by-field on the live response; the
`lp/` dropbox route 404s at Western). Consequences:
- weights are unobtainable without a gradebook fetch AND a grade-item
  linkage that doesn't exist in the folder payload → don't chase it;
- per-user submission status needs a per-folder submissions fetch
  (`/dropbox/folders/{id}/submissions/`) — heavy, only if asked;
- the frontend computes overdue locally (`isPast(due_at)`); the DB
  `status` column is just the D2L folder state and may say "open" for
  long-past items — the rendered chip is the source of truth.
- DueDate arrives as real UTC ISO (`...T04:59:59.000Z` — a 11:59 PM ET
  professor deadline); `new Date()` conversion is CORRECT — probes run in
  the UTC container and render the UTC wall-clock, which looks wrong but
  isn't.

## Unit banner images live in the "Unit Introduction" topic
Brightspace keeps each unit's banner INSIDE the Unit Introduction topic,
not on the module landing page (module pages are text stubs). The web UI
surfaces the banner inline on module pages — **banner ONLY, never the whole
topic**: find the child matching `/intro/i`, fetch ITS file content with a
dedicated `api.fileContent` call (the module's own contentInfo is a
different file), then render just the extracted `<img>` tags
(`content.match(/<img[^>]+>/gi)`), slice(0, 3), sanitized. Rendering the
full intro HTML clones all of its text into the section page — the user
reported that exact duplication ("content of the section then a clone of
the unit introduction") and it had to be reverted to banner-only.

## Rubrics ride inside Assessment.Rubrics (no separate endpoint)
Western's folders carry the full rubric object in `Assessment.Rubrics` —
**15/20 folders on SE 2250B**. There is NO `/rubrics/` list route (404 at
Western); the folder payload IS the source. Shape (D2L LE 1.24):
`Rubrics: [{RubricId, Name, ScoringMethod, CriteriaGroups: [{Name, Levels:
[{Id, Name, Points}], Criteria: [{Id, Name, Cells: [{Description: {Text,
Html}, Feedback: {Text, Html}}]}]}]}]`.
Pipeline (proven end-to-end):
- Sync (`sync/sync.py`): `assessment = f.get("Assessment") or {}` →
  `json.dumps(assessment.get("Rubrics") or [])` → `rubrics_json` column
  (ALTER TABLE on the live DB + schema.sql; upsert_assignment insert+update).
- API (`api/services.list_assignments`): parse `rubrics_json` → `rubrics`
  array per row (drop the raw column).
- UI (AssignmentsPage): per-row "Rubric" toggle (ListChecks icon) → compact
  grid — levels as columns (`Name · Points`), criteria as rows, cell text =
  `Description.Text || Feedback.Text`; cells are matched to levels BY INDEX
  (D2L aligns the arrays — no LevelId join needed). Rubric view sits BELOW
  the row (row becomes `flex-direction: column` wrapper).
- Verified: 15 Rubric buttons; Lab 1 grid = 3 criteria groups × 4 columns
  with real level descriptions ("GitHub Repo has Content"…).
Weights/statuses remain unobtainable (see the section above). Rubrics are
NOT the only metadata — see the full folder inventory below.

## Full folder metadata — DUMP THE WHOLE OBJECT when auditing an API
Nate: "why haven't you discovered these? is there more metadata?" — the
original audit filtered folders to a handful of guessed keys (Weight,
Status, IsOpen, CompletionStatus), found them null, and wrongly concluded
"no metadata". The REAL fields were sitting in the payload the whole time.
**Rule: when auditing what an API provides, `json.dumps` the full object —
never a filtered key list.** (The user is right to challenge this.)

Verified live inventory of `le/1.24/{orgUnit}/dropbox/folders/` on
SE 2250B — the fields that EXIST and are worth syncing:
| Field | Meaning | Example (SE 2250B) |
|---|---|---|
| `CategoryId` | dropbox category | 4943=Project, 4944=Labs |
| `GroupTypeId` | group-category id for group assignments | 37023=Project (11 folders) |
| `Attachments` | `[{FileId, FileName, Size}]` | Team_Contract_Template-1.doc (4 section folders + Lab 2) |
| `Assessment.ScoreDenominator` | max points — MATCHES gradebook MaxPoints | Lab1=10, Lab2=50, PT2=100 |
| `Assessment.Rubrics` | full rubric objects | 15/20 folders |
| `Availability` | `{StartDate, EndDate}` open window | — |
| `CustomInstructions`, `DueDate`, `IsHidden`, `DisplayInCalendar` | as documented | — |

Name-mapping endpoints (both 200 at Western):
- `/dropbox/categories/` → `[{Id, Name}]` (le API).
- `lp/{ver}/{orgUnit}/groupcategories/` → `[{GroupCategoryId, Name}]`
  (lp API — the le API 404s on every group route). **Pitfall: pass the
  path through `self.client.lp(f"/{org_unit}/groupcategories/")` — handing
  the client a full absolute URL makes it double-join the base and silently
  D2LError → the name map stays empty (group_category came back NULL until
  fixed).**
- `lp/{ver}/users/whoami` → the user's own Identifier (student id) — the
  only identity endpoint that works.

## The user's team name per group category ("Group 29" prefix)
Brightspace shows group assignments as "Group 29: Project Task 1" — the
group name is the user's TEAM in the assignment's group category, discoverable
per-user:
- `lp/{ver}/{orgUnit}/groupcategories/{id}/groups/` →
  `[{GroupId, Name, Enrollments: [userId, ...]}]` (all groups; not paged on
  SE 2250B, 30 groups in the Project category).
- Find the group whose `Enrollments` contains the whoami `Identifier`.
- **PITFALL (silent failure): whoami's `Identifier` is a STRING ("93954")
  but `Enrollments` are INTEGERS — `me in enrollments` NEVER matches, the
  capture runs clean, `course_groups` stays empty, no error anywhere.**
  Compare stringified: `any(str(x) == str(me) for x in (g.get("Enrollments") or []))`.
  Verified: user = Group 29 (5 members, category 37023 "Project").
- Storage: `course_groups` table (course_id, category_name, group_name,
  UNIQUE(course_id, category_name)) + `upsert_course_group`; the API's
  `_parse_assignment` looks the name up by (course_id, group_category) →
  `group_name` on each row.
- UI: the list is sectioned by the dropbox CATEGORY TAG — untagged first
  (no header), then one section per tag (Labs, Project, alphabetical).
  Nate REJECTED the earlier group-vs-individual split: "not really what i
  was expecting. there are tags 'Labs', 'Projects', and those without
  group tag. the group name like 'Group 29' should only effect the
  prefix". The team name is ONLY the title prefix on group rows + the
  detail title. Verified: sections [Labs, Project], 10 "Group 29: " rows.

## Assignment attachments ARE downloadable (grab them)
Nate: "assignment attachments should be grabbed. we have a folder for each
assignment right?" — every dropbox folder with attachments CAN be pulled:
- Endpoint (verified 200 at BOTH le 1.24 and the client's negotiated
  le 1.96): `le/{ver}/{orgUnit}/dropbox/folders/{folderId}/attachments/{FileId}`
  → raw binary (`content-disposition` carries the real filename). No auth
  beyond the Bearer token.
- Storage (sync.py `_download_assignment_attachments`): one dir per
  assignment → `course_dir / "Assignments" / _safe_name(folder_name) /
  _safe_name(FileName)` (BOTH segments need `_safe_name` — folder names
  contain spaces/dashes). Skip when the dest already exists non-empty
  (idempotent like the content fast path).
- Serving: the existing `/api/assets/{rel_path}` route serves ANY file
  under SCHOOL_ROOT (path-guarded) — no new route needed. Stamp each
  attachment entry with `local` = `f"{course_dir.parent.name}/{course_dir.name}/{rel}"`
  (e.g. `2025W/SE2250B/Assignments/Lab 2/SE2250_Lab2_2026_final.pdf`); the
  frontend links `/api/assets/${encodeURI(local)}` — the detail-page
  attachment chips become working links (plain span when no `local`).
- Reality on SE 2250B: 5 attachments — 4 × Team_Contract_Template-1.doc
  (the section folders) + Lab 2's own lab PDF. Verified: served 200
  `application/pdf`.
- **Sync-run sharpening**: after deploying a sync-code change, the first
  trigger may return 200 while the run row says
  `error: "No valid token"` (1h TTL) — meaning your NEW code never
  executed. Always check `sync_runs` status + the actual rows/files BEFORE
  debugging the code; re-auth (`python -m sync.auth`) then re-trigger.

## Attachments act like content for the AI (files-table registration)
Nate: "does assignments act like content in that the assignment details,
attachments are saved and accessible by ai?" — they now DO (55804b0):
- `_download_assignment_attachments` ALSO calls
  `db.upsert_file(course_id, at["local"], "assignment", "brightspace",
  sha256, size)` (kind='assignment') → the files appear in
  `content_list_files`, and PDFs flow through the extraction pipeline
  (processed=0 → queued) → the AI reads them via `content_read_file` like
  any course file. `.doc` templates are binary and stay unextracted — say
  that plainly, don't chase it. Verified: 5 registered, Lab 2 PDF queued.
- `agent/tools.py harness_list_assignments` returns FULL metadata:
  description, url, category, group_category, group_name (course_groups
  lookup), points, closed (COMPUTED from availability_json — there is no
  `closed` column, SELECT availability_json), rubrics (NAMES only in the
  list), attachments (name + local path). `assignment_id` arg → single
  assignment's full detail. Verified: 20 rows, all fields present.
- Reminder: sync-code changes need `sudo systemctl restart campus` — the
  bind mount makes files live but the RUNNING process keeps the old code
  (the files-table registration silently didn't happen until the restart).

## Closed state = the clickable state (Availability.EndDate)
Brightspace greys out folders whose availability window ended; folders with
NO dates stay open forever. Derivation (API, `_parse_assignment`):
`closed = bool(Availability.EndDate) and
datetime.fromisoformat(end.replace("Z", "+00:00")) < now(utc)`.
SE 2250B truth: **Lab 2 is the ONLY open lab** (no availability window);
Lab 1/3/3P2/4 + Project Tasks 2/3/4/5 + self-assessment all have passed
EndDates (Jan 24 → Apr 12) → closed. UI: closed rows dimmed (opacity
0.55), a muted "Closed" chip BEFORE the overdue check; rows stay clickable
(detail keeps the rubric). Category linkage is API-truth: only Lab 2 is
tagged "Labs" — the other labs come back CategoryId null even if
Brightspace's UI shows them under Labs (the API under-reports; don't invent
tags).

Scores/completion — VERIFIED instructor-gated (the honest ceiling):
- `/dropbox/folders/{id}/submissions/` → 403 for students; per-user routes
  (`submissions/{userId}/`, `user/{userId}/`) → 404.
- `/grades/` lists 22 grade items (names + MaxPoints — confirms points) but
  `/grades/values/{id}` → 403; `values/my/` → 400. No student-visible
  score/submission endpoint exists at Western.

Pipeline (proven): sync adds `category`, `group_category`, `points`,
`attachments_json`, `availability_json` columns (ALTER TABLE + schema.sql +
upsert_assignment); `api/services._parse_assignment` un-jsonifies
attachments/availability alongside rubrics; the detail page renders points,
category/group chips, attachment chips. The compact list stays clean.

## Sync ops: auth FIRST, then trigger
- `/api/sync/trigger` returns 200 with a background run — check
  `sync_runs` for the real outcome. Expired token → run row with
  `error: "No valid token — run \`python -m sync.auth\`"` (the trigger
  does NOT re-auth).
- Re-auth: `docker exec campus python -m sync.auth` — silent cookie
  capture, fires the Duo push (user approves on the phone). Then trigger.
- Repeat syncs are idempotent + fast (linked-file fast path); `files_new:
  0` is normal.
- The daily log saying "Nothing new in any course" is ONLY the digest
  pass's fast-path — `sync_dropbox` (and the group/point/availability
  capture inside it) still runs every sync. Don't conclude the sync
  skipped work from that line; check `sync_runs` + the assignments rows.

## DB path pitfall
The server/API uses `/app/data/harness.db`. Standalone scripts built via
`sync.config.Config.data_root` resolve to `/srv/homelab/school/harness.db`
which does NOT exist → "unable to open database file". Pass the path
explicitly: `DB(Path('/app/data/harness.db'))`.

## Container = bind mount of the repo
`/home/nate/campus` → `/app` (plus data + token dirs). Python/tools edits
are live immediately (no rebuild, no copy); restart the campus service for
server-side (uvicorn) changes. `docker exec campus bash -lc "cd /app && …"`.
