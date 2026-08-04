# D2L Brightspace REST API — Western U quirks (learned 2026-07-31)

All verified against `westernu.brightspace.com` with a Bearer token from the
Playwright auth flow. The brightspace-mcp (TS) source at
`/var/lib/brightspace-mcp/src/api/` is the pattern reference.

## Version discovery (NO auth needed)

```
GET /d2l/api/versions/
```
Response is `[{ProductCode: "lp", LatestVersion: "1.62"}, {ProductCode: "le", ...}]`
— NOT `{id, versions}` as the MCP's own TS types suggest. Current Western:
LP 1.62, LE 1.96. Build paths:
- `/d2l/api/lp/{lp}/…` (users, enrollments, grades)
- `/d2l/api/le/{le}/{orgUnitId}/…` (content, news, dropbox, syllabus)
- `/d2l/api/le/{le}/…` (global, e.g. enrollments)

## Enrollments — the code trap

```
GET /d2l/api/lp/1.62/enrollments/myenrollments/?orgUnitTypeId=3
```
- **Western FW25+ courses use internal codes** like `UGRD_1259_3178` in
  `OrgUnit.Code`. The human course code ("SE 2250B") appears only in
  `OrgUnit.Name` (e.g. "SE 2250B 001 LEC FW25: SOFTWARE CONSTRUCTION").
  Match with regex on Name: `^([A-Z]+\s*\d{4}[A-Z]?)` before the colon.
- **Past-term courses are `isActive=false`** — default filter excludes them.
  Omit `isActive` to see all enrollments (pilot courses from last year).
- Pagination: `PagingInfo.Bookmark` + `HasMoreItems`; pass `&bookmark=`.
- D2L treats each section as a separate OrgUnit (LEC/TUT/LAB all enrolled).

## Content tree

```
GET /d2l/api/le/1.96/{ou}/content/root/                    → modules
GET /d2l/api/le/1.96/{ou}/content/modules/{id}/structure/  → children
```
Node fields: `Type` 0=module 1=topic; `TopicType` 1=file 2/3=link;
`Title`, `Description.Text`, `ModuleDueDate`/`DueDate`, `IsHidden`, `IsLocked`.
File download: `GET /d2l/api/le/1.96/{ou}/content/topics/{topicId}/file`
(binary). **Content-Disposition filenames can be URL-encoded**
(`SE2250%202025-2026%20outline.pdf`) — `urllib.parse.unquote` before saving.

## News (announcements)

```
GET /d2l/api/le/1.96/{ou}/news/
```
- **`CreatedBy` is an int (user id), NOT an object** — the MCP's TS interface
  assumed `{Identifier, DisplayName}`; Western returns a bare int. Guard with
  isinstance dict check. Same likely for LastModifiedBy.
- Body at `Body.Text` (markdown-ish), `StartDate` = posted time, `IsPinned`.

## Dropbox (assignments)

```
GET /d2l/api/le/1.96/{ou}/dropbox/folders/
```
Array of folders; skip `IsCategory` entries. `Name`, `DueDate`,
`Id` (= brightspace_folder_id for dedupe). 20 folders for SE 2250B.

- **NO `/assignments/` endpoints on Western (verified 2026-08-03).** Both
  `/d2l/api/le/{le}/{ou}/assignments/` and `/d2l/api/lp/{lp}/{ou}/assignments/`
  (list AND per-id) 404. The dropbox folders list is the ONLY assignment
  source; grab everything from the list response, there is no per-assignment
  fetch to make.
- **The description is NOT in `Instructions`** — Western's folder objects
  have NO `Instructions` key at all. It lives in
  `CustomInstructions.{Text,Html}` (per-folder custom instructions; often
  empty — e.g. 8/20 folders for SE 2250B). The brightspace-mcp reads
  `CustomInstructions.Html`. Robust extraction: loop keys
  `("Instructions", "CustomInstructions")`, guard `isinstance(obj, dict)`,
  prefer `Html` → fall back `Text`. Storing HTML is safe: the frontend
  renders descriptions via `sanitizeHtml` (same as module landing pages).
- Folder list objects also carry `CustomInstructions`, `Assessment` (full
  rubric), `Availability`, `Attachments`, `IsHidden` — but NOT `Instructions`.

## Syllabus

```
GET /d2l/api/le/1.96/{ou}/syllabus/
```
Shape varies: list of `{Title, Html}` sections, or `{Sections: [...]}`.
Defensive: handle both.

## Auth token details

- Bearer token lives in localStorage under key `D2L.Fetch.Tokens` →
  `tokens["*:*:*"].access_token`. Validate via
  `GET /d2l/api/lp/{v}/users/whoami` with `Authorization: Bearer`.
- Cookie fallback: collect cookies named `d2l*` → send as `Cookie:` header,
  prefix token with `cookie:`.
- Tokens last ~1h; treat as expired with a 5-min refresh buffer.
- 403 = past-semester course without access (handle gracefully).

## Rate limiting

Token bucket (10 burst / 3 per sec) keeps Western happy. 429s come back with
Retry-After.
