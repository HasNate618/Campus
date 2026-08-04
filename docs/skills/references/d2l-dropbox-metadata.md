# D2L dropbox (assignments) metadata map — SE 2250B findings (2026-08-04)

## The audit lesson (user-corrected workflow — do not repeat)

When checking what an external API exposes, DUMP COMPLETE OBJECTS field-by-field.
Never audit against a filtered projection of guessed fields. The first audit
filtered folder objects to (Id/Name/Weight/Status/IsCategory/...) — fields that
don't exist at Western — and concluded "no metadata available". The user pushed
back twice ("why havent you discovered these? is there more metadata to be
discovered?") and a full-field dump found 6+ metadata types that were there the
whole time. Guessed-field checks produce false "data ceiling" conclusions;
only a complete-object dump can prove a ceiling.

## What the LE dropbox folder objects actually carry

Endpoint: `/d2l/api/le/{ver}/{orgUnit}/dropbox/folders/` (student-scoped)

- `Assessment.Rubrics` — FULL rubric objects, not just names:
  RubricId, Name, CriteriaGroups[{Name, Levels[{Id, Name, Points}],
  Criteria[{Id, Name, Cells[...]}]}] where each cell has {Feedback, Description}
  and the per-level description text lives in `Cells[i].Description.Text`
  (cells align with Levels by index). 15/20 folders at Western ship one.
- `Assessment.ScoreDenominator` — the max points (matches gradebook MaxPoints).
- `CategoryId` → dropbox category name via `/dropbox/categories/`
  (SE 2250B: 4943=Project, 4944=Labs; most folders have none — API under-reports
  vs the Brightspace UI grouping).
- `GroupTypeId` → group category via LP API
  `/d2l/api/lp/{ver}/{orgUnit}/groupcategories/` (37023="Project" = the team
  structure). Per-user team name comes from
  `/groupcategories/{catId}/groups/` (each group lists member userIds in
  `Enrollments`).
- `Attachments` [{FileId, FileName, Size}] — download with
  `/dropbox/folders/{folderId}/attachments/{fileId}` (200; filename in
  content-disposition). Store under course `Assignments/<folder name>/` and
  register in the files table (kind='assignment') so extraction + the AI's
  file tools see it like content.
- `Availability` {StartDate, EndDate, types} — EndDate passed = folder CLOSED
  (Brightspace grayed out / not clickable). Empty availability = open forever
  (e.g. Lab 2 was the only open lab because it had no window; all others had
  ended windows). The closed state is computed from this, NOT the DB status
  column (the folder API reports every folder status as "open").
- `CustomInstructions` (the description HTML — 8/20 have it), `DueDate`
  (UTC with Z — browsers convert; container-TZ probes show UTC wall-clock and
  look wrong), `IsHidden`, `IsCategory` (category rows to skip).

## Endpoint facts & pitfalls

- Use the client's `lp()` helper (negotiated version), never absolute URLs —
  an absolute URL silently fails → D2LError → empty map, no error raised.
- `whoami` `Identifier` comes back as a STRING ("93954"); group `Enrollments`
  are INTs — compare `str(x) == str(me)`, not `me in enrollments` (silent
  no-match bug, course_groups stayed empty until fixed).
- NOT exposed to students: submissions endpoints
  (`dropbox/folders/{id}/submissions/...` → 403/404) and grade values
  (`grades/values/{id}` → 403 instructor-only). Folder `TotalUsers*` counts
  come back -1. Completion status / score / evaluation = genuine platform
  ceiling — only the Brightspace web UI has it. Say so honestly instead of
  inventing a sync gap.

## Operational

- Token 1h TTL: mid-day syncs die with "No valid token". Re-auth
  (`python -m sync auth`) is SILENT — the persistent browser profile reuses
  the remembered Duo session, no push (that's a feature: unattended syncs work
  without the user).
- `/api/sync/trigger` returns immediately; check the `sync_runs` table
  (status/error) for the real outcome. The digest log line "Nothing new in any
  course" is the DIGEST summary, not the sync status.
- After adding a new extractor (e.g. antiword for .doc), already-skipped files
  need `UPDATE files SET processed=0` to re-queue — the queue only visits
  processed=0 rows.
