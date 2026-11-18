# Configuration

All personal values live in `config.yaml` (gitignored) or `CAMPUS_*` env vars, plus the panel-written `settings.yaml`. The repo ships with no secrets.

| Key | Env var | Purpose |
| --- | --- | --- |
| `base_url` | `CAMPUS_BASE_URL` | Your LMS (Brightspace/D2L). Leave it empty unless you want automated sync, and drop files into `data_root` instead if your school uses something else |
| `username` | `CAMPUS_USERNAME` | LMS username; the password comes from `CAMPUS_BRIGHTSPACE_PASSWORD` and is never written to a config file |
| `llm_url` / `llm_urls` / `llm_model` / `llm_api_key` | `OPENAI_ENDPOINT` / `OPENAI_ENDPOINTS` / `OPENAI_MODEL` / `OPENAI_API_KEY` | Any OpenAI-compatible `/v1` endpoint with tool calling. Bearer key optional; set `llm_api_key` or `OPENAI_API_KEY` if your endpoint needs one. `llm_urls` (or `OPENAI_ENDPOINTS`, comma-separated) is a failover list tried in order. Empty means no chat or digest; sync, browse and search still work |
| `llm_tool_choice` | n/a | Optional OpenAI-style `tool_choice`. Leave it empty for endpoints that reject it (Cohere Command does) |
| `llm_max_tokens` | n/a | Maximum model output tokens per chat call. If the provider returns `finish_reason=length`, Campus labels the answer as truncated |
| `embed_model` / `rerank_model` | `CAMPUS_EMBED_MODEL` / `CAMPUS_RERANK_MODEL` | Optional OpenAI-compatible `/embeddings` and `/rerank` models. Empty means lexical corpus search. A 404 on either degrades back to lexical |
| `pdf_extractor_url` | `CAMPUS_PDF_EXTRACTOR_URL` | Optional parser endpoint (Cohere Parse, Docling, ...) for every PDF. Empty means local PyMuPDF, and digital PDFs extract in milliseconds |
| `ntfy_url` | `CAMPUS_NTFY_URL` | Optional ntfy topic for sync pings; empty means disabled |
| `mcp_url` / `mcp_urls` | `CAMPUS_MCP_URL` / `CAMPUS_MCP_URLS` | Optional streamable-HTTP MCP server or servers (web search and read, ...). Tools are auto-discovered and namespaced by the server's own name, so trawl's `search` becomes `trawl_search`. Give a list to merge several servers; a server with no name falls back to `mcp1_*`, `mcp2_*`. Empty means no external tools |
| `terminal_enabled` | `CAMPUS_TERMINAL_ENABLED` | Turns on the agent's `terminal_run` tool. Off by default, and forced off in demo mode |
| `demo` | `CAMPUS_DEMO` | Seeds the fictional demo course and shows the demo banner. On in `docker-compose.yml`, off otherwise |
| `data_root` | `CAMPUS_DATA_ROOT` | Where course files live as `{term}/{code}/...`; if you're not syncing, drop your own materials here |
| `token_dir` | `CAMPUS_TOKEN_DIR` | MFA token and browser profile, used only for Brightspace sync |
| `institution` | n/a | Label in the system prompt, e.g. `"Your University"` |
| `brightspace_hosts` / `brightspace_base_url` | `CAMPUS_BRIGHTSPACE_HOSTS` / `CAMPUS_BRIGHTSPACE_BASE_URL` | Content proxy allowlist and link rebasing, Brightspace-only features |
| `term_dates` | n/a | Start and end dates that anchor class events |
| `timezone` | `CAMPUS_TIMEZONE` | Dates you see, the clock in the prompt, and the daily auto-sync clock; empty means host local time |
| `auto_sync_enabled` | `CAMPUS_AUTO_SYNC_ENABLED` | Enables one guarded sync per local day. Off by default |
| `auto_sync_time` | `CAMPUS_AUTO_SYNC_TIME` | 24-hour `HH:MM` for the daily run; default `03:00` |
| `auto_sync_catch_up` | `CAMPUS_AUTO_SYNC_CATCH_UP` | Run once after a missed slot instead of skipping the day. On by default |
| `web_password` | `CAMPUS_WEB_PASSWORD` | Single password for `/api/*` routes; empty means open demo |
| In-app settings | `CAMPUS_SETTINGS_PATH` | `settings.yaml` beside the DB. The Settings panel writes it, and it overrides env vars |

### In-app settings

Campus has a Settings panel in the web app. On desktop, open it from the settings button in the sidebar footer; on mobile, use the settings action on the Home screen or visit `/settings`. The panel is also the source of truth for the effective value and where that value came from (default, `config.yaml`, environment, or `settings.yaml`).

Saving changes writes an allowlisted, gitignored `settings.yaml` next to the configured database. The precedence is:

```text
defaults < config.yaml < environment variables < settings.yaml
```

The panel covers runtime values such as LLM endpoints and models, search models, PDF extraction, Office-to-PDF conversion, sync scope, institution and timezone, daily auto-sync, notifications, and MCP servers. Deployment-only values such as paths, web password, LMS credentials and term dates stay in `config.yaml` or the environment. Changing `mcp_urls` requires an API restart (`docker compose restart campus`); changing the embeddings or reranker model requires rebuilding the search index. The panel also provides an LLM connection test and a search-index rebuild action.

### Daily auto-sync

With `auto_sync_enabled: true`, the API process checks about once a minute and starts one non-overlapping full sync at `auto_sync_time` in the configured timezone. Settings changes apply without a restart. With catch-up on (the default), a stop, sleep or missed slot is covered by one sync on next start; with it off, a slot that passes is skipped. The date of the last attempt is stored in `auto_sync_state.json` beside `settings.yaml`. A failed run is recorded, not retried in a loop.

Each run writes an operational log under `sync_logs/runs/{date}/{run_id}.md`; the Home digest is generated separately as `sync_logs/digest.md`. If no LLM endpoint is configured, the digest is deterministic. Model output may only reference server-owned card markers, which are replaced with exact in-app links before rendering.

### Not using Brightspace/D2L?

Campus's automated sync targets Brightspace/D2L, but only the automated sync is LMS-specific. Browsing, corpus search, chat, MCP web tools and PDF reading are LMS-agnostic and run on whatever files are in `data_root`.

- **Your school is Brightspace/D2L:** set `base_url` and your username and password, then `python3 -m sync sync` pulls your courses.
- **Your school is Canvas/Moodle, or you're not a student:** leave `base_url` empty. Drop your course materials under `data_root` as `{term}/{code}/...` and browse, search and chat work on those files. Automated pull isn't available for other LMSes yet.
- **To enable chat and the AI digest** you need one OpenAI-compatible endpoint: set `llm_url` and `llm_model`, plus `llm_api_key` only if the endpoint requires auth. Everything else is optional, and sample data seeds in with no config at all.

Common commands once configured for a real term:

```bash
python3 -m sync auth        # MFA push, stores token with 1h TTL
python3 -m sync sync        # full sync, AI digest, notification
python3 -m sync extract --code "CS 1100A"
python3 -m sync models      # list models served by the LLM endpoint
python3 -m agent            # REPL chat
```

Your real enrollments go in `seed/courses.local.json`. Course content and secrets never get committed.

