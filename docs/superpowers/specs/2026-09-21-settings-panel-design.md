# In-app Settings panel — design

**Date:** 2026-09-21
**Status:** approved design, post-review revision
**Review:** findings from an independent reviewer pass are incorporated; see
*Appendix A* for the disposition of each one.

## Problem

Every knob in Campus today lives in `config.yaml` (gitignored) or an env var:
LLM endpoint, API key, model, PDF extraction behaviour, semantic search,
sync scope, notifications. Changing them means editing a file on the host and
knowing which of ~20 keys exists. The 150 lines of comments in
`config.example.yaml` are the only documentation of what the keys do, and the
app itself offers no way to change them — `/more` even links to a
"Settings — coming soon" row that goes nowhere.

Friction, precisely (not overstated): there is no way to *discover* the
settings, and no in-app way to change them. Only `mcp_urls` requires a restart
to apply; everything else is already re-read per request. The win is
discoverability plus not needing host access, not "edit + restart".

The app also already has an auth button in two places (desktop sidebar footer
`Log out`, mobile Home-header icon) — the natural entry point.

## Goals

- Change the settings a *user* would plausibly flip, from inside the app.
- Changes apply to the running server (sync engine, chat, CLI) — not just the
  browser tab.
- Never destroy `config.yaml` or its documentation comments.
- Never silently do nothing: when a setting is shadowed by something else,
  say so in the UI.

## Non-goals

- Deployment/infra settings (paths, `web_password`) — see *Out of scope*.
- A general YAML editor.
- Restarting the server from the web UI.
- Multi-user settings (single-user by design — `chat_prefs` is pinned to
  `id = 1` for the same reason).

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Layout | Desktop = slide-over panel from the sidebar footer; mobile = a `/settings` page | Desktop keeps in-place context (existing split-pane conventions); mobile gets a real page since a drawer over a 4-tab layout has nowhere to live |
| Persistence | Web-written `settings.yaml`, the **top** layer of the precedence stack | `config.yaml` keeps its comments; the CLI and sync worker honour the same overrides with no extra plumbing; the app's explicit setting is the user's most recent intent |
| Save semantics | Explicit Save with dirty state | A mistyped endpoint or key auto-saving would kill chat mid-session with no confirmation step |
| Secrets | `llm_api_key` writable as a masked write-only field; LMS password and `web_password` stay env-only | Consistent with the existing token trust model (`token.json` is already plaintext 0600); those two are not in the registry at all, so env keeps absolute authority over them |
| Write auth | Writes are unauthenticated in open mode; the trust model is documented in-app and in the deploy skill | See *Trust model* |

## Architecture

```text
                    ┌──────────────────────────────────────────┐
   browser ────────▶│ GET  /api/settings   (values + sources)  │
                    │ PUT  /api/settings   (partial, validated)│
                    │ POST /api/search/rebuild                 │
                    └────────────────┬─────────────────────────┘
                                     │ field registry = allowlist + validators
                                     ▼
                    ┌──────────────────────────────────────────┐
                    │  <db dir>/settings.yaml  (0600, atomic)  │
                    └────────────────┬─────────────────────────┘
                                     │
  defaults ─▶ config.yaml ─▶ env vars ─▶ settings.yaml         │
                    │                                          │
                    └──────────▶ sync.config.Config.load() ◀───┘
                                     │
             api/routers/*.py (per request) · sync/ · agent/ · tools/ (CLI)
```

## Config layer — `sync/config.py`

### Precedence

`defaults < config.yaml < env vars < settings.yaml`

The new layer goes **on top**. Rationale, because this inverts the documented
convention and must be defensible:

- **The user is the deployer.** Single-user personal app: `chat_prefs` is
  pinned to `id = 1` and auth is a single shared password. There is no
  operator whose pins need protecting from the person using the app.
- **Every setting a deployment must control is one the panel cannot write.**
  `web_password`, `CAMPUS_BRIGHTSPACE_PASSWORD` and `CAMPUS_USERNAME` are not
  in the field registry. Env keeps total authority over credentials.
- **Env-under-panel makes the panel silently do nothing on the deployments
  that followed the docs.** `skills/campus-deploy/SKILL.md:50` and
  `docker-compose.yml` both tell users to set `OPENAI_*` env vars. That is the
  exact failure this feature exists to remove.
- **The cost is bounded and visible.** A deployer who later changes
  `OPENAI_ENDPOINT` does not take effect while an in-app value exists — so
  every field reports the value it is shadowing (see *Source reporting*), and
  *Reset to inherited* restores the env value.

Documentation consequence: `skills/campus-deploy/SKILL.md:67` states
`defaults < config.yaml < env vars`. That line, `docs/HANDOFF.md:25`,
`docs/DESIGN.md:116`, `config.example.yaml` and `README.md:151,211` all need
updating.

### Where `settings.yaml` lives

Anchored to the **database directory**, resolved to an absolute path:

```python
def settings_path() -> Path:
    """CAMPUS_SETTINGS_PATH, else <db_path>.parent/settings.yaml, absolute."""
    env = os.environ.get("CAMPUS_SETTINGS_PATH")
    if env:
        return Path(env).expanduser().resolve()
    p = Path(Config.load_base().db_path).expanduser()
    if not p.is_absolute():
        p = REPO_ROOT / p          # explicit anchor, never the process CWD
    return p.parent.resolve() / "settings.yaml"
```

Why the DB directory and not the repo root: the homelab deployment mounts the
repo **read-only** (`Dockerfile:40-41`, "code mounts from the repo (ro) in the
homelab deployment"; `skills/campus-deploy/SKILL.md` §B). `data/` is the
writable volume (`docker-compose.yml` `campus-data:/app/data`), already
gitignored (`.gitignore:2`) and already `.dockerignore`d (`.dockerignore:5`),
so it can never be baked into an image.

Three things this deliberately fixes:

- **Never CWD-relative.** `config.example.yaml:34` ships
  `db_path: "data/harness.db"` — relative — and `Config.load()` only
  `expanduser`s (`sync/config.py:147-153`), so `Path(...).parent` would
  resolve against whatever directory uvicorn happened to start in. The app
  relies on `WORKDIR /app` today (`Dockerfile:38`); the settings file will not
  add another such reliance.
- **Report the resolved path.** `GET` returns
  `settings_file` as an absolute path so "where did my setting go?" is
  answerable from the UI.
- **Name the real DB knob.** The API reads `CAMPUS_DB` (`api/config.py:13`)
  while the harness reads `CAMPUS_DB_PATH` (`sync/config.py:129`) — two
  different variables for the same concept, both documented that way in
  `skills/campus-deploy/SKILL.md:58`. The settings anchor follows the
  **harness** `db_path`, so a host-side `python -m sync` and the container
  agree whenever they share a data root.

`settings_path` deliberately does **not** become a `Config` field: `load()`
copies any YAML key where `hasattr(cfg, k)` (`sync/config.py:112-114`), so a
dataclass field would let `config.yaml` — or `settings.yaml` itself — choose
the location of the settings file. It stays a module function.

**Known operational caveat (document, don't code around):** if a host CLI runs
against a *different* data root than the container (host `<repo>/data` vs the
container's named volume `campus-data`), they read different settings files.
Anchoring makes the location deterministic and reportable; it cannot unify two
different data roots. `CAMPUS_SETTINGS_PATH` is the escape hatch, and the
deploy skill should say so.

### Module surface

```python
DEFAULT_CONFIG_PATH = REPO_ROOT / "config.yaml"

# The env-override table, factored out of load() into a module constant with
# the *_csv pseudo-suffixes normalised away, so the UI can name the env var
# behind a field's inherited value.
ENV_OVERRIDES: list[tuple[str, str]] = [
    ("OPENAI_ENDPOINT", "llm_url"), ("OPENAI_ENDPOINTS", "llm_urls"), ...
]

# Extra env names load() handles outside ENV_OVERRIDES (CSV lists, secrets)
# plus CAMPUS_SETTINGS_PATH, added by this feature.
ENV_EXTRA: dict[str, str] = {
    "CAMPUS_USERNAME": "username",
    "CAMPUS_BRIGHTSPACE_PASSWORD": "password",
    "CAMPUS_BRIGHTSPACE_HOSTS": "brightspace_hosts",
}

def env_set_attrs() -> set[str]:
    """Attr names env currently supplies a value for. Pure — reads os.environ."""

def settings_path() -> Path: ...
def load_settings_layer() -> dict: ...   # {} when absent/unreadable

@classmethod
def load(cls, path=None) -> Config: ...
```

Two bugs this factoring must not inherit:

- **`*_csv` pseudo-attrs.** `ENV_OVERRIDES` currently stores
  `("OPENAI_ENDPOINTS", "llm_urls_csv")` and `("CAMPUS_MCP_URLS",
  "mcp_urls_csv")`, expanded by `attr[:-4]` (`sync/config.py:124,135,143-145`).
  A naive "key off the attr" returns `llm_urls_csv`, which matches no registry
  key — so `OPENAI_ENDPOINTS` and `CAMPUS_MCP_URLS` would report no source and
  render as if unset. Normalise with `.removesuffix("_csv")` when building the
  table, and add a test asserting `"mcp_urls" in env_set_attrs()` when
  `CAMPUS_MCP_URLS` is set.
- **`CAMPUS_MCP_URLS` is handled twice** (table + special-case block at
  `sync/config.py:151-154`). Drop the special case while factoring.

### Reading the settings layer safely

`Config.load()` is called **per request** (`api/routers/chat.py:423` and ~10
other sites), so a bad settings file must not be able to 500 every request:

- Unreadable (`PermissionError` — plausible when a host CLI runs as a
  different uid than the container) or invalid YAML → treat as **absent**, log
  once, and surface it in `GET` as `settings_file_error`. Mirror the reasoning
  already documented in `write_secret` (`sync/token_store.py:22-27`), which
  swallows chmod failures for the same class of reason.
- The file is merged with the same `hasattr` guard as `config.yaml`, so an
  unknown or hand-edited key is ignored rather than fatal.

### Alias coupling

`llm_endpoints()` returns `llm_urls` when truthy and only falls back to
`llm_url` (`sync/config.py:157-164`); `mcp_endpoints()` mirrors it
(`:166-172`). The panel exposes **one field per alias group and writes the
plural**, blanking the singular in the same layer.

The failure this actually prevents is the **clear** case, not the write case:
once `settings.yaml` holds `llm_url: A`, a user emptying the endpoint list
writes `llm_urls: []`, which is falsy, so `llm_endpoints()` falls back to the
stale `llm_url: A`. Because the settings layer is on top, blanking the
singular within the layer is what makes "I cleared the field" mean cleared.

`brightspace_hosts` is plural-only and `pdf_extractor_url`/`ntfy_url` are
singular-only, so there are no other pairs.

## Field registry — `api/settings_fields.py` (new)

One table is both the allowlist and the validator. A key not in it is
rejected — the API can never write an arbitrary key into the file.

```python
Field = namedtuple("Field", "key kind secret restart couples validate")

REGISTRY: dict[str, Field] = {
    "llm_urls":  Field("llm_urls", "list", False, False, ("llm_url",), url_list),
    "llm_model": Field("llm_model", "text", False, False, (), nonempty_str),
    ...
}
```

Kinds: `text`, `secret`, `bool`, `int`, `json`, `url`, `list` (of URLs).

**Empty vs unset.**

- `pdf_extractor_url`, `ntfy_url`, `timezone` — the empty string is the
  documented "disabled / system local" value (`config.example.yaml:87-88`),
  so the UI stores `""`.
- `llm_api_key`, `llm_tool_choice`, `institution` — empty means **delete the
  key** (inherit), never `""`. For `llm_api_key` this is what *Clear* does;
  for `llm_tool_choice` it is mandatory, because `agent/chat.py:108-109` gates
  on `is not None`, so a stored `""` would send `tool_choice: ""` and 400
  every turn.
- `llm_model`, `embed_model`, `rerank_model` — an empty model is not a valid
  state for a feature that is switched on, so `""` is **rejected**; clearing
  sends `null` (delete the override).

**Non-obvious validation rules that exist because of real code:**

- `int` fields must reject `bool`. `isinstance(True, int)` is `True` in
  Python, so `{"long_scan_skip_pages": true}` would otherwise persist as YAML
  `true` and then be compared at `sync/sync.py:1015` (`pages >= True`),
  stubbing every scan instead of OCRing it.
- `llm_tool_choice` is validated with `json.loads()` and **persisted parsed**
  (a `str` or `dict`), because the documented object form
  (`sync/config.py:63`) must round-trip as an object, not as a string.

| Group | Key | Kind | Validation | Restart |
| --- | --- | --- | --- | --- |
| ai | `llm_urls` | list | each http(s) URL with a host; empty list allowed | no |
| ai | `llm_api_key` | secret | any string; empty = delete | no |
| ai | `llm_model` | text | non-empty string | no |
| advanced | `llm_tool_choice` | json | parsed JSON (str or object); empty = delete | no |
| search | `embed_model` | text | non-empty string | no¹ |
| search | `rerank_model` | text | non-empty string | no¹ |
| content | `auto_extract_pdfs` | bool | real bool (not int) | no |
| content | `office_to_pdf` | bool | real bool (not int) | no |
| content | `pdf_extractor_url` | url | http(s) URL or empty | no |
| content | `long_scan_skip_pages` | int | `0 <= n <= 100000`, not bool | no |
| content | `digest_pdf_excerpt_chars` | int | `0 <= n <= 1000000`, not bool | no |
| sync | `pilot_only` | bool | real bool (not int) | no |
| sync | `institution` | text | any string; empty = delete | no |
| sync | `timezone` | text | empty, or a name `zoneinfo.ZoneInfo` accepts | no |
| notifications | `ntfy_url` | url | http(s) URL or empty | no |
| advanced | `mcp_urls` | list | each http(s) URL; empty allowed | **yes** |
| advanced | `max_file_size` | int | `> 0`, not bool | no |
| advanced | `max_extract_size` | int | `> 0`, not bool | no |
| advanced | `office_convert_timeout_s` | int | `> 0`, not bool | no |
| advanced | `digest_announcement_days` | int | `>= 0`, not bool | no |

¹ Needs a search-index rebuild to take effect, not a restart — see below.

Group ids are also the API's grouping hint; the frontend owns labels, help
text and order (UI copy belongs in TSX, not Python).

## API — `api/routers/settings.py` (new)

Registered with `dependencies=[Depends(require_auth)]` like the other data
routers. **Deliberately not added to `api/auth.py::_PUBLIC_PATHS`** —
`/api/config` is public because the login screen needs it; settings must not
be. `/api/config` must not be extended with settings values either.

### `GET /api/settings`

```json
{
  "fields": [
    {
      "key": "llm_urls",
      "group": "ai",
      "kind": "list",
      "value": ["http://localhost:11434/v1"],
      "source": "settings",
      "inherited_value": ["https://prod/v1"],
      "inherited_from": "OPENAI_ENDPOINTS",
      "secret": false,
      "restart": false
    },
    {
      "key": "llm_api_key",
      "group": "ai",
      "kind": "secret",
      "value": "••••4f2a",
      "source": "env",
      "inherited_from": "OPENAI_API_KEY",
      "secret": true,
      "restart": false
    }
  ],
  "settings_file": "/app/data/settings.yaml",
  "settings_writable": true,
  "settings_file_error": null,
  "auth_enabled": false,
  "version": "0.3.0",
  "search_index": { "chunks": 6412, "embed_model": "none", "stale": true },
  "readonly": {
    "db_path": { "value": "/app/data/harness.db", "from": "CAMPUS_DB" },
    "data_root": { "value": "/app/data/school", "from": "CAMPUS_DATA_ROOT" },
    "token_dir": { "value": "/home/nate/.campus", "from": "default" }
  }
}
```

**Source reporting** replaces the locking design (see *Precedence*):
`source` is `default | config | env | settings`; `inherited_value` and
`inherited_from` carry what the field would resolve to without the in-app
override. That is what lets the UI say "your in-app value is shadowing
`OPENAI_ENDPOINT=https://prod/v1`" and what makes *Reset to inherited*
meaningful. There is no "env-locked, write refused" rule — env values are
overridable by design, and shadowing is displayed instead of prevented.

- A secret is never returned: `value` is a mask (last 4) when set, `null` when
  unset. Last-4 is not a meaningful leak at this threat model (single user,
  plaintext `token.json` already on disk, see *Trust model*).
- `settings_writable` is an `os.access` check on the settings file's parent so
  a read-only deployment disables Save up front. **Note for tests:**
  `os.access(W_OK)` returns True for root regardless of mode, so the negative
  test needs `skipif(os.geteuid() == 0)` or an `st_mode` check.
- `settings_file_error` reports an unreadable/corrupt settings file — the
  panel shows a warning instead of the app 500ing.
- `search_index` reuses the values already tracked in `chunk_meta`
  (`sync/search.py:222`, key `embed_model`) and *stale* is
  `cfg.embed_model != chunk_meta.embed_model`. This is what tells the user a
  rebuild is needed.
- `readonly` labels the source of each value, and both `db_path` here and
  `settings_file` above come from the same resolved config rather than two
  different `db_path`s.
- `version` must come from a leaf module (`api/version.py`), not
  `api.main` — `api/main.py:15` imports the routers, so importing `app` from a
  router is a cycle.

### `PUT /api/settings`

```json
{ "values": { "llm_model": "qwen2.5:14b", "long_scan_skip_pages": null } }
```

- Partial update. Unknown key → `400`.
- `null` **deletes** the key from `settings.yaml` — the "inherit again" action
  behind *Reset to inherited*.
- Every value is validated **before** anything is written, so a rejected
  payload leaves the file byte-identical.
- Coupled keys are written in the same operation, under a lock.
- Response is a fresh `GET` payload, so the UI re-renders values and sources
  without a second round trip.

Error body:

```json
{ "detail": { "errors": [ { "key": "llm_urls", "message": "not an http(s) URL: ftp://x" } ] } }
```

**The error body must actually reach the UI.** Every helper in
`web/src/api/client.ts` throws `new Error(\`${res.status} ${res.statusText}\`)`
and never reads the response body (`:18,28,34,221`; only `chatUpload` at
`:163-166` parses it). So `useSettings.ts` either calls `fetch` directly or
`client.ts` gains a helper that surfaces the parsed error — otherwise the most
useful part of this design is dropped at the seam and every failure shows as
"400 Bad Request".

### Concurrency

`PUT` is a read-modify-write over the whole file. Two overlapping requests
(two tabs, a double-click, a retry) would each merge their partial dict into
their own snapshot and the later write would discard the earlier field. The
repo already uses the right idiom: `_sync_lock` in `api/services.py:547` with
the comment "the bare flag raced in the threadpool". Mirror it — a module-level
`threading.Lock` around read → validate → merge → write, with a test that fires
two concurrent PUTs and asserts both fields survive.

This is an in-process lock, which is correct because the deployment runs a
single uvicorn process. State that assumption in the code comment.

### Write path

Reuse `sync/token_store.write_secret()`: temp file created at `0600`, then
`os.replace()`, so a concurrent read never sees a half-written file and the
secret is never briefly world-readable. One change: add a
`chmod_parent: bool = True` parameter so the settings writer does **not**
`chmod 0700` the shared `data/` directory (which holds the DB and the corpus
tree). The token-dir caller keeps today's behaviour.

### `POST /api/search/rebuild` + `GET /api/search/rebuild/status`

Enabling semantic search writes `embed_model`, but the vectors do not exist
until the index is rebuilt (`sync/search.py:202` `rebuild(cfg, db)`, invoked
only from `sync/sync.py:1286` and `sync/extract.py:85`). Without an action
here, the Search group's one click produces a silently empty index — see
*Semantic search*.

Mirror `trigger_sync` (`api/services.py:547-600`): module-level
`threading.Lock` + flag, check-and-set atomic, daemon thread, and
`logging.exception` on failure. `status` reports
`idle | running | done | error` plus the rebuild's own result dict and the
observed `embed_model` written into `chunk_meta`.

- Refuse to start when a sync is already running — both write `chunks`. Add a
  small public `sync_in_progress() -> bool` accessor in `api/services.py`
  rather than reading the private flag across modules.
- Status is in-process and lost on restart, exactly like the sync trigger.
- `rebuild` is incremental ("(re)embed only items whose (ref, hash) changed"),
  so a second run is cheap.
- If `rebuild` runs in lexical mode it deliberately wipes stale vectors, so it
  is also the correct action after *disabling* semantic search.

### Why a user write is not in `audit_log`

Precedent for auditing user writes exists — `workspace_audit`
(`api/services.py:416-425`) records `actor='user'` — so this is not a missing
convention. Settings are excluded because `audit_log` is the knowledge-base
mutation log ("AI reads freely; writes only through audited APIs",
`docs/DESIGN.md`), and app configuration is not course data. `config.yaml`
edits were never audited either. Revisit if config changes ever need history.

## Semantic search — the apply problem

`sync/search.py` has a pre-existing HIGH bug, documented in this repo's own
audit as finding **I2** (`.pi-investigations/findings.data.md:95`):

- In semantic mode, `scored` drops every row whose embedding is empty
  (`:385-388`). If the corpus was indexed in lexical mode (`b""` +
  `chunk_meta = 'none'`, `:265-285`) and `embed_model` is now set, then
  `scored`/`docs`/`scores`/`ranked` are all `[]`, and the term-overlap rescue
  requires `ranked` truthy (`:441`). Result: **`[]` for every query that is
  not a verbatim phrase**, reported to the user as "no matches".
- The audit's own recommended fix (`findings.data.md:125`) is the guard.

A Settings panel makes this reachable in one click, so v1 ships both halves:

1. **Guard** — in `sync/search.py`, immediately before
   `docs = [r["text"] for _, r in scored]` (line 399):
   `if not scored: return _lexical_rank(db, q, query, course_id, top_k)`.
   Degrades to lexical instead of returning nothing. `_lexical_rank` is
   already the exact signature needed (`:449`).
2. **Rebuild action** — the button above, so the toggle actually takes effect
   rather than only ceasing to fail.

The Search group shows `search_index.stale` as "needs rebuild" and the button
reports the outcome (embedded N chunks, or "endpoint has no /embeddings — kept
lexical"), because `rebuild` in lexical mode is a legitimate result, not an
error.

## Frontend

One body, two shells. All settings logic lives in `SettingsBody`, so the
desktop/mobile split is chrome only and cannot drift.

```text
web/src/settings/
  useSettings.ts      GET + PUT + rebuild, dirty tracking, error-body parsing
  fieldMeta.tsx       key -> {label, help, group, order, advanced}
  SettingsBody.tsx    100% of the logic; renders groups
  SettingsDrawer.tsx  desktop chrome: slide-over + its own Log out
  SettingsPage.tsx    mobile chrome: /settings route, back button
```

### Entry points

- **Desktop** — `Sidebar.tsx` footer: the `Log out` button becomes a
  `Settings` gear that toggles drawer state owned by `AppShell`. **Placement
  invariant:** the drawer renders as a sibling of `<main>`, outside the keyed
  `motion.div` in `AppShell` (`:38-50`) — the same reason `CourseKeeper` sits
  outside it (`:52-57`). Opening settings must never remount live course
  iframes/PDFs. The drawer is `position: fixed`; a sibling in `div.shell`
  otherwise participates in that flex/grid layout.
- **Mobile** — `TodayPage.tsx`: the `mobile-only page-logout` icon becomes a
  gear `Link` to `/settings`. New route in `App.tsx`.
- **`MorePage.tsx`** — the "Settings — coming soon" row currently links to
  `/more` (itself). Point it at `/settings`.
- Log out moves into the Account section of `SettingsBody`. **`App.tsx` must
  pass `onLogout` to the settings route element explicitly** —
  `<Route path="settings" element={<SettingsPage onLogout={logout} />} />`.
  Props do not flow from `AppShell` to route elements (routes are children of
  the `AppShell` route, `App.tsx:41-56`). `Sidebar` and `TodayPage` lose their
  `onLogout` prop as a result.
- The mobile tabbar stays at 4 tabs.

### Save semantics

Explicit Save. `SettingsBody` tracks a dirty map; the action bar appears only
when dirty and shows Save / Discard. *Reset to inherited* appears only where
`source === "settings"`. Fields whose in-app value shadows an env value show
"inherited: `<value>` from `OPENAI_ENDPOINT`" as the placeholder plus a
one-line note.

The AI group gets a **Test connection** button reusing the existing
`GET /api/chat/models` probe, so a wrong endpoint/key is caught before save.

### Keyboard and focus

The drawer must not fight the global vim keynav (`web/src/lib/keynav.tsx`).
While a field is focused, `keynav.tsx:228-234` blurs it on Escape and returns
— but it does **not** stop propagation, so a drawer-level Escape listener
would fire on the same keypress and close a dirty drawer. Specify: first
Escape blurs a focused field, a second Escape closes (and a dirty close asks
for confirmation). The open drawer also registers `data-kbd-zone="settings"`
so sidebar j/k navigation cannot scroll the list behind it.

### Tolerating registry drift

`fieldMeta` is `Record<string, FieldMeta>`. A server field with no meta entry
renders using the raw key as its label instead of crashing or vanishing. A
field the frontend knows but the server no longer sends is simply absent.
Drift degrades; it never breaks.

## Trust model

Writes are unauthenticated whenever `web_password` is empty, which is the
default (`config.example.yaml:41`; neither `Dockerfile` nor
`docker-compose.yml` sets `CAMPUS_WEB_PASSWORD`). `require_auth` is a no-op in
that state (`api/auth.py:57-58`), so this is pre-existing behaviour, extended
to a new writable surface.

Documented exposure, accepted deliberately:

- **Demo deployment** binds loopback only (`docker-compose.yml:15`
  `127.0.0.1:8087:8000`).
- **Production** is plain HTTP on a Tailscale tailnet with no public ingress
  (`api/auth.py` session comment).
- **Residual risk:** any client that can reach the port can repoint
  `llm_urls` (or `pdf_extractor_url`, or `ntfy_url`) and harvest
  `OPENAI_API_KEY` from the next chat turn's `Authorization` header
  (`agent/chat.py:68-75`), or use the endpoint fields as SSRF into the LAN.
  Masking the key on read does not mitigate this, because the secret leaves as
  an outbound header rather than as a response body.

Mitigations that do not gate the feature: the key is never returned in plain
(nor logged), writes go only through the key allowlist, and **the panel shows
an in-app notice when `auth_enabled` is false** so the owner sees the exposure
on the same screen as the setting. The deploy skill should state the same.

If this trade-off is ever revisited, the cheapest tightening is to require
`web_password` for writes to the URL and secret fields only, keeping the
boolean toggles usable in open mode.

## Apply and restart semantics

| Change | Applies |
| --- | --- |
| LLM endpoint / key / model / `llm_tool_choice` | **Next request** — `api/routers/chat.py:423` loads per request and passes `cfg` into `run_turn(cfg, ...)` (`:437-441`) |
| `institution`, `timezone` | Next chat turn — `agent/context.py:157`, called from `agent/chat.py:463` with the per-request cfg |
| `embed_model`, `rerank_model` | **After a rebuild** — the chat path passes a per-request cfg into `search()`, but `rebuild(cfg, db)` takes cfg as a parameter and the sync path passes `self.cfg` (`sync/sync.py:1287`), so a *running* sync keeps the old value |
| `auto_extract_pdfs`, `office_to_pdf`, `long_scan_skip_pages`, `digest_pdf_excerpt_chars`, `pdf_extractor_url` | Next sync / next on-demand extract |
| `pilot_only`, `ntfy_url` | Next sync run |
| `mcp_urls` | **API restart** — `agent/tools.py:1314` calls `load_mcp_tools(Config.load())` at *import*, and `TOOL_SCHEMAS` is built from it (`:1318`) |

Fields carry `restart: true`; a saved group containing one shows "Restart the
API to apply" with the deploy hint. There is no restart button.

## Out of scope

Read-only in About, with a "set in `config.yaml` or env" hint:

- **Paths** — `data_root`, `db_path`, `token_dir`, `browser_profile_dir`.
  `api/services.py:16` and `api/db.py:9` freeze `SCHOOL_ROOT` / `DB_PATH` at
  *import* while the CLI and sync worker re-read them per run
  (`sync/sync.py:1379,1420`, `sync/search.py:491`, `sync/extract.py:48`), so a
  web edit would half-apply: the API serving and writing under the old root
  while sync populates the new one. The sharper reason is that
  **`files.path` is stored relative to `data_root`** — written as
  `relative_to(cfg.data_root)` (`sync/sync.py:275-276`) and read back as
  `data_root / row["path"]` (`:1004`). Changing `data_root` silently
  re-points every stored corpus path at a different tree. `restart: true`
  would not rescue that; it would just switch roots mid-life.
- **`web_password`** — env-only, and `api/auth.py:22` caches `cfg` at import,
  so a change would not take effect without a reload the panel cannot perform.
- **LMS wiring** — `base_url`, `username`, `password`, `brightspace_hosts`,
  `brightspace_base_url`. First-run setup for D2L users, not tuning; the
  password is env-only by existing policy.
- **`term_dates`** — nested `{term: {start, end}}`; needs a date-row editor and
  is set once per term. `pilot_only` covers the toggle people actually flip.
- **`token_ttl`, `refresh_buffer`** — internal token handling.

Cheap to add later, because a field is one registry row plus one meta entry:
LMS wiring (the list editor and restart-hint path already exist for
`mcp_urls`).

## Documentation updates required

- `skills/campus-deploy/SKILL.md:67` — precedence is now
  `defaults < config.yaml < env vars < settings.yaml`; also note
  `CAMPUS_SETTINGS_PATH` and the host-CLI/volume caveat.
- `docs/HANDOFF.md:25` and `docs/DESIGN.md:116` — "everything
  environment-specific lives in `config.yaml` / env" is no longer complete.
- `agent/chat.py:452-461` — both preflight errors tell the user to edit
  `config.yaml` or set `OPENAI_*`; they should also point at Settings in the
  app.
- `config.example.yaml` — header mentions the in-app panel and the
  `settings.yaml` override; and either add `institution` (currently documented
  only at `README.md:151,211`, not in the example file) or drop the claim that
  the example documents it.
- `README.md:151,211` — config table gains the precedence change.
- `.gitignore` — `data/` already covers `data/settings.yaml`, but add a
  defensive `settings.yaml` entry next to `config.yaml` in case
  `CAMPUS_SETTINGS_PATH` is pointed at the repo root.
- New `api/version.py` (or `api/config.py`) — one version constant read by
  `api/main.py:16` and the settings router.

## Testing

`tests/test_settings.py`:

- Precedence: `settings.yaml` beats `env`; `env` beats `config.yaml`; absent
  settings file behaves exactly as today.
- **Shadow reporting** (replaces the old lock test): with
  `OPENAI_ENDPOINT` set and `llm_urls` in settings, `source == "settings"`,
  `inherited_from == "OPENAI_ENDPOINT"`, and
  `llm_endpoints() == [in-app value]`.
- Secrets: the full key never appears in any GET/PUT response body; mask shows
  the last 4; unset secret is `null`.
- Allowlist: unknown key → 400, file untouched.
- Validation: bad URL / bad timezone / non-bool / **`true` for an int field**
  → 400 with the file **byte-identical** (assert bytes, not just the status).
- Empty semantics per field class: `""` stored for `pdf_extractor_url` /
  `ntfy_url` / `timezone`; `""` **deletes** for `llm_api_key` /
  `llm_tool_choice` / `institution`; `""` **rejected** for the three model
  fields.
- `llm_tool_choice` round-trips a JSON *object* as an object (not a string),
  and clearing it removes the key.
- `null` deletes → value falls back to `config.yaml`/env.
- Alias coupling, **clear case**: `settings.yaml: llm_url: A`; PUT
  `llm_urls: []`; assert `llm_endpoints() == []`. Plus a reset case asserting
  the singular is restored. (The previously-planned "saving `llm_urls` is
  reflected" test is vacuous — the plural already wins by
  `sync/config.py:158-159` — so it is replaced.)
- `env_set_attrs()` contains `mcp_urls` when `CAMPUS_MCP_URLS` is set, and
  `llm_urls` when `OPENAI_ENDPOINTS` is set (the `*_csv` regression).
- File: written `0600`, written atomically, parent created on first write,
  `data/` parent mode **unchanged**, `settings_path().is_absolute()`.
- Unreadable/corrupt settings file → requests still succeed, `Config.load()`
  behaves as if absent, `GET` reports `settings_file_error`.
- `settings_writable: false` when the parent is not writable
  (`skipif(os.geteuid() == 0)`).
- Concurrency: two concurrent PUTs → both fields survive.
- Restart flag present on `mcp_urls`, absent on `llm_model`.
- `readonly` block labels the source of each value.

`tests/test_search.py` (**currently has no end-to-end coverage of `search()`**
per `findings.data.md:153`, so this is new ground):

- I2 regression: corpus indexed lexically + `embed_model` set → a
  non-verbatim query returns the lexical results, not `[]`.

Isolation — the previous plan was wrong about this:

- `tests/test_config.py:80` asserts `cfg.llm_endpoints() == []`, and
  `_clean_env` (`:16-21`) deletes **every** `CAMPUS_*` var. So a developer's
  real `data/settings.yaml` would turn the suite red, and a pin installed by a
  `conftest.py` autouse fixture would be deleted afterwards by `_clean_env`.
- `tests/test_web_auth.py:26-42` sets `CAMPUS_DB` and imports `api.main`
  **at module import time, before any fixture runs** — so `api.config.cfg`
  loads before a fixture-based pin can apply. Same for every module importing
  `api.*` later.
- Fix: set `CAMPUS_SETTINGS_PATH` in `tests/conftest.py` at **module scope**
  (mirroring the existing `CAMPUS_DB` pattern) *and* inside `_clean_env` after
  its deletion loop. Add a guard test that `Config.load()` does not read a
  repo-local `data/settings.yaml` when unpinned.

Frontend: `npx tsc -b`, `npx oxlint`, `make build-web` (the deployment serves
`web/dist`, so the UI change is not live until the bundle is rebuilt).

## Risks

| Risk | Mitigation |
| --- | --- |
| Read-only repo mount makes the settings file unwritable | `data/` volume by default; `CAMPUS_SETTINGS_PATH` override; `settings_writable` surfaces it before a failed save |
| Host CLI and container read different settings files | Deterministic absolute anchor + absolute `settings_file` in GET; caveat documented in the deploy skill |
| An in-app value silently shadows a deploy-time env var | `source` + `inherited_value`/`inherited_from` per field; Reset to inherited |
| Endpoint/key typo kills chat | Explicit Save + Test connection probe |
| Drawer remounts live course tabs | Sibling of `<main>`, outside the keyed `motion.div`; `position: fixed` |
| Enabling semantic search yields an empty index | I2 guard + rebuild action + `search_index.stale` badge |
| Corrupt/unreadable settings file 500s every request | Treated as absent, logged, reported as `settings_file_error` |
| Concurrent PUTs lose a field | Module `threading.Lock` mirroring `_sync_lock`; single-process assumption documented |
| Registry drift between Python and TSX | Unknown fields render by raw key; frontend never crashes |
| Secret in plaintext on disk | Same trust model as the existing `token.json` (0600, single-user host); masked on read; never logged |
| Open-mode writes can harvest the API key / SSRF (accepted) | *Trust model*: documented exposure, in-app notice when no password is set, key allowlist; cheapest future tightening recorded |
| Developer's real `settings.yaml` leaks into tests | Module-scope pin in `conftest.py` + inside `_clean_env` + guard test |
| `settings.yaml` missing from config backups | Operational note: it is deployment state alongside the DB |

## Open questions

None blocking. The three that were open were resolved during review:
env-override precedence (in-app wins, shadowing displayed), write auth
(writes stay open, trust model documented), and the semantic-search apply path
(guard + rebuild action).

## Appendix A — review findings and disposition

An independent reviewer pass verified every factual claim against source. All
citations below were re-verified before changing the spec.

#### Corrected in this revision

| Finding | Disposition |
| --- | --- |
| Env pin defeated by the plural write; `env_locked` computed on the wrong attr | Folded into the precedence inversion — `settings.yaml` is now the top layer, so the class of bug cannot occur. `env_locked` is replaced by `source` + `inherited_from` |
| `llm_tool_choice: ""` is sent as `tool_choice: ""` (`agent/chat.py:108-109` gates on `is not None`) | Empty now deletes the key; value persisted parsed |
| Enabling semantic search returns `[]` until a rebuild (repo audit **I2**, HIGH) | Guard at `sync/search.py:399` + rebuild endpoint + staleness badge |
| `onLogout` cannot reach a route element | `<Route element={<SettingsPage onLogout={logout} />} />` |
| `settings_path` derived from a possibly-relative `db_path`; `CAMPUS_DB` vs `CAMPUS_DB_PATH` | Absolute anchor + reported absolute path + `is_absolute()` test; `DEFAULT_SETTINGS_PATH`/derivation contradiction removed; kept out of the `Config` dataclass (the `hasattr` self-reference trap) |
| `*_csv` pseudo-attrs make `env_override_keys()` return non-registry names | `.removesuffix("_csv")` at table build; duplicated `CAMPUS_MCP_URLS` block dropped |
| PUT is an unlocked read-modify-write | Module `threading.Lock`, mirroring `_sync_lock` |
| `isinstance(True, int)` lets `true` through int validation | Int validator rejects bool |
| Per-request `load()` means a corrupt settings file 500s requests | Treated as absent, logged, reported via `settings_file_error` |
| Error body never reaches the UI (`client.ts:18,28,34,221`) | `useSettings.ts` owns error-body parsing |
| Escape double-fires with keynav; no kbd zone | Two-press Escape + dirty-close confirm + `data-kbd-zone="settings"` |
| `version` from `api.main` is an import cycle | Leaf constant module |
| Test isolation: `_clean_env` ordering, `test_config.py:80`, import-time `cfg` | Module-scope pin + in-fixture pin + guard test |
| Alias test was vacuous | Replaced with the clear-to-empty and reset cases |
| `Dockerfile:48` citation | Corrected to `Dockerfile:40-41` |
| `institution` is not in `config.example.yaml` (README only) | Doc list updated |
| `readonly` block mixed two `db_path` sources | Labelled per value |
| Drawer as a flex sibling of `<main>` | `position: fixed` specified |
| Commit-time `CAMPUS_DB` note | Recorded in the anchor rationale |

#### Pushed back or narrowed

| Finding | Disposition |
| --- | --- |
| "Settings path is broken; anchor to `REPO_ROOT`" | Conclusion accepted, severity narrowed. `api/config.py:13` `DB_PATH` is *equally* unresolved and `api/routers/chat.py:73` already uses `db_path.parent`, so this is existing behaviour, not a new defect. Anchoring makes it deterministic; it cannot unify a host CLI with a container's named volume — that is a documented caveat, not code |
| "Paths exclusion rests on data corruption" | Exclusion kept, argument replaced. `files.path` is relative to `data_root` (`sync/sync.py:275-276`, `:1004`), so a change orphans the corpus index; but nothing overwrites data, and `restart: true` does not make it safe |
| "No audit precedent exists" | Precedent does exist (`api/services.py:416-425`, `actor='user'`). Exclusion kept on corrected reasoning (app config ≠ course data) |
| "`sync/search.py` loads per call" | Wording fixed: cfg is a parameter; the chat path passes a per-request cfg, the sync path passes the run's cfg |
| "Problem section overstates friction" | Rewritten — only `mcp_urls` needs a restart |
| "Require `web_password` for all writes" | Rejected as a default (it would make the shipped demo unable to change anything). Writes stay open per the trust-model decision, with the in-app notice and the cheapest-tightening option recorded |
