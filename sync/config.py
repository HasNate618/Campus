"""Configuration for Campus sync engine.

Config precedence: defaults < config.yaml (local, gitignored) < env vars.
Secrets (password, API keys) come from env or sops — never from git.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = REPO_ROOT / "config.yaml"

# ── environment overrides ────────────────────────────────────────────────
# Env name -> Config attribute. Two naming conventions are supported so the
# project is portable: the conventional OpenAI-compatible names (OPENAI_*) any
# outsider already knows, and the Campus-specific CAMPUS_* names used by the
# homelab deployment for non-LLM services. For the LLM, only the standard
# OPENAI_* names are accepted (no CAMPUS_LLM_* aliases) so the interface stays
# clean. Single + plural (comma-separated) forms both work.
#
# The attribute here is the REAL field name, never a "_csv" pseudo-name: these
# values are also what env_set_attrs() reports, and a name like "llm_urls_csv"
# matches no Config field, so a failover deployment would look unconfigured.
ENV_OVERRIDES: list[tuple[str, str]] = [
    ("OPENAI_ENDPOINT", "llm_url"),
    ("OPENAI_ENDPOINTS", "llm_urls"),
    ("OPENAI_API_KEY", "llm_api_key"),
    ("OPENAI_MODEL", "llm_model"),
    ("CAMPUS_BASE_URL", "base_url"),
    ("CAMPUS_DATA_ROOT", "data_root"),
    ("CAMPUS_DB_PATH", "db_path"),
    ("CAMPUS_TOKEN_DIR", "token_dir"),
    ("CAMPUS_TIMEZONE", "timezone"),
    ("CAMPUS_PDF_EXTRACTOR_URL", "pdf_extractor_url"),
    ("CAMPUS_NTFY_URL", "ntfy_url"),
    ("CAMPUS_MCP_URL", "mcp_url"),
    ("CAMPUS_MCP_URLS", "mcp_urls"),
    ("CAMPUS_EMBED_MODEL", "embed_model"),
    ("CAMPUS_RERANK_MODEL", "rerank_model"),
    ("CAMPUS_BRIGHTSPACE_BASE_URL", "brightspace_base_url"),
    ("CAMPUS_WEB_PASSWORD", "web_password"),
]

# Comma-separated in the environment, lists on Config.
_ENV_CSV_ATTRS = frozenset({"llm_urls", "mcp_urls"})

# Handled outside ENV_OVERRIDES: secrets and the host allowlist. Unlike the
# table above these keep their original semantics (see _apply_env): an
# explicitly-empty credential clears the value from config.yaml, because that
# is what `os.environ.get(name, current)` has always done here.
ENV_EXTRA: dict[str, str] = {
    "CAMPUS_USERNAME": "username",
    "CAMPUS_BRIGHTSPACE_PASSWORD": "password",
    "CAMPUS_BRIGHTSPACE_HOSTS": "brightspace_hosts",
}


def env_set_attrs() -> set[str]:
    """Config attributes the environment currently supplies a value for.

    Pure: reads os.environ only. An exported-but-empty value counts as unset,
    matching _apply_env's `if not val: continue` for the table. The two
    credential extras are the exception — _apply_env lets an explicitly-empty
    CAMPUS_USERNAME / CAMPUS_BRIGHTSPACE_PASSWORD clear a file value — but
    neither is a settings field, so this can never mislabel a field the
    Settings panel displays.
    """
    return {
        attr
        for env_key, attr in {**dict(ENV_OVERRIDES), **ENV_EXTRA}.items()
        if os.environ.get(env_key)
    }


def settings_path(base: "Config | None" = None) -> Path:
    """Absolute path of the web-written overrides layer.

    Anchored to the DB directory, never the process CWD: config.example.yaml
    ships a *relative* db_path ("data/harness.db") and load() only expanduser()s
    it, so Path(db_path).parent would otherwise resolve against wherever uvicorn
    was started. CAMPUS_SETTINGS_PATH overrides the whole computation (used by
    a host-side CLI whose data root differs from the container's volume).
    """
    env = os.environ.get("CAMPUS_SETTINGS_PATH")
    if env:
        return Path(env).expanduser().resolve()
    db = Path(base.db_path if base is not None else Config().db_path).expanduser()
    if not db.is_absolute():
        db = REPO_ROOT / db
    return db.parent.resolve() / "settings.yaml"


def read_settings_layer(path: Path) -> tuple[dict, str | None]:
    """(settings dict, error-or-None). NEVER raises.

    Called on every Config.load(), i.e. once per request. An unreadable file
    (a host CLI running as a different uid than the container) or invalid YAML
    must behave as "absent" rather than take the API down. Mirrors the reasoning
    in sync/token_store.write_secret, which swallows chmod failures for the
    same class of reason.

    Resolution is left to open(): Path.exists() swallows the PermissionError
    and reports False, so an exists() pre-check would make an unreadable file
    indistinguishable from a missing one — empty settings with no explanation.
    Only "no file yet" is silent; everything else carries an error.
    """
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        return {}, None
    except Exception as e:  # PermissionError, IsADirectoryError, yaml.YAMLError, ...
        return {}, f"{path}: {e}"
    if not isinstance(data, dict):
        return {}, f"{path}: top level must be a mapping"
    return data, None


@dataclass
class Config:
    base_url: str = ""  # LMS base URL, e.g. https://your-university.brightspace.com
    username: str = ""
    password: str = ""  # from env CAMPUS_BRIGHTSPACE_PASSWORD, never config file

    # institution label for the system prompt — config-driven, e.g.
    # institution: "Your University". Default: generic.
    institution: str = ""

    # Brightspace-specific hosts used by the content proxy + sanitizer.
    # Empty = proxy disabled (portable default); set per deployment, e.g.
    # ["your-university.brightspace.com", "s.brightspace.com"]. Env: CAMPUS_BRIGHTSPACE_HOSTS (comma-separated).
    brightspace_hosts: list = field(default_factory=list)
    # Base URL the frontend rebases relative /d2l/ links onto (tool-link
    # topics open in the real LMS). Empty = no rebase.
    brightspace_base_url: str = ""

    # paths
    data_root: Path = field(default_factory=lambda: Path("./school"))
    db_path: Path = field(default_factory=lambda: Path(REPO_ROOT / "data" / "harness.db"))
    token_dir: Path = field(default_factory=lambda: Path.home() / ".campus")
    browser_profile_dir: Path = field(default_factory=lambda: Path.home() / ".campus" / "browser-data")

    # auth
    token_ttl: int = 3600  # seconds; Brightspace Bearer tokens last ~1h
    refresh_buffer: int = 300  # seconds before expiry = invalid

    # optional single-password web auth; empty = open (demo)
    web_password: str = ""

    # services (docker network names; host-mapped ports when run on host)
    # LLM endpoint(s): ANY OpenAI-compatible /v1 base URL (OpenAI, OpenRouter,
    # Together, a local gateway like Ollama, ...). `llm_api_key` is sent as a
    # Bearer token when set; empty = the endpoint needs no auth. Empty by
    # default — the harness runs without an LLM (sync, browse, search still
    # work); set this to enable chat + AI digest. Multiple endpoints may be
    # given (llm_urls / OPENAI_ENDPOINTS, comma-separated) for failover if one
    # is down; llm_url / OPENAI_ENDPOINT is a single-entry alias.
    llm_url: str = ""  # e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1"
    llm_urls: list = field(default_factory=list)  # failover list; empty => [llm_url]
    llm_model: str = ""  # pick from: python -m sync models  (required for chat/digest)
    llm_api_key: str = ""  # env OPENAI_API_KEY; Bearer auth when set
    # Optional OpenAI-style `tool_choice` sent to the model. `None` (default) =
    # omit it, so the provider defaults to "auto" (model may call tools). Some
    # endpoints REQUIRE it (set "auto" or {"type":"function",...}); Cohere
    # Command REJECTS it ("tool_choice is not supported for this model") — so
    # leave this empty for Cohere.
    llm_tool_choice: str | None | dict = None
    pdf_extractor_url: str = ""  # empty = PyMuPDF only; set to a parser endpoint (e.g. Cohere Parse) to route all PDFs through it
    # ntfy publish URL for sync notifications; empty = notifications disabled.
    ntfy_url: str = ""
    # Optional MCP server(s) exposing HTTP tools (web search/read, ...). When
    # set, their tools are discovered at startup and exposed to the agent
    # alongside the built-in harness tools. Any streamable-HTTP MCP server
    # works (SearXNG+crawl4ai, Firecrawl, ...). Empty = no external MCP tools.
    # Give several (mcp_urls / CAMPUS_MCP_URLS, comma-separated) to merge tools
    # from multiple servers; mcp_url / CAMPUS_MCP_URL is a single-entry alias.
    mcp_url: str = ""
    mcp_urls: list = field(default_factory=list)  # merged; empty => [mcp_url]
    # Semantic search (corpus embeddings + rerank) is OPT-IN. Most
    # OpenAI-compatible endpoints don't serve /embeddings or /rerank, so these
    # default empty: search_corpus falls back to a lexical (substring + term
    # overlap) ranker that needs no extra model. Set both to enable semantic
    # search. If the endpoint 404s on either, search degrades to lexical only.
    embed_model: str = ""  # e.g. "cohere/embed-english-v3.0" or "text-embedding-3-small"
    rerank_model: str = ""  # e.g. "cohere/rerank-english-v3.0"

    # timezone for user-facing datetimes + the system prompt clock.
    # Empty = the host's local time (portable default). Set e.g. "America/Toronto"
    # if you want a fixed zone regardless of where the server runs.
    timezone: str = ""

    # sync scope
    pilot_only: bool = True  # H1: only sync is_pilot courses
    max_file_size: int = 200 * 1024 * 1024  # skip downloads above this
    max_extract_size: int = 20 * 1024 * 1024  # PDFs above this are never extracted
    auto_extract_pdfs: bool = True  # extract after sync (cloud engine by default)
    office_to_pdf: bool = True  # convert .pptx/.docx → sibling .pdf via soffice at sync time
    office_convert_timeout_s: int = 120  # per-file soffice timeout
    digest_pdf_excerpt_chars: int = 2000  # PDF markdown excerpt fed to the digest
    long_scan_skip_pages: int = 30  # scanned PDFs (no text layer) at/above this many
    # pages are skipped instead of OCR'd — local OCR runs ~2 min/page, so a
    # 30-page scan is ~an hour of work for noisy math text; re-run any file
    # on demand with `python -m sync extract --file <path>`
    term_dates: dict = field(default_factory=dict)  # {"2026F": "2026-09-01"} — anchors class events
    digest_announcement_days: int = 365  # digest backfills undigested announcements this far back (self-limiting: each is digested once)

    @classmethod
    def load(cls, path: Path | None = None) -> "Config":
        cfg = cls()
        _merge_layer(cfg, _read_config_file(path or DEFAULT_CONFIG_PATH))
        _apply_env(cfg)
        # The in-app layer sits ABOVE env: the user is the deployer, and the
        # settings a deployment must control (passwords, paths) are not
        # writable from the panel at all. Resolved after env so a
        # CAMPUS_DB_PATH from the environment anchors the same directory.
        data, _err = read_settings_layer(settings_path(cfg))
        _merge_layer(cfg, data)
        _coerce_paths(cfg)
        return cfg

    @classmethod
    def load_base(cls, path: Path | None = None) -> "Config":
        """Layers 1-3 only (defaults, config.yaml, env) — what a field would
        resolve to with no in-app override. Used for `inherited_value`."""
        cfg = cls()
        _merge_layer(cfg, _read_config_file(path or DEFAULT_CONFIG_PATH))
        _apply_env(cfg)
        _coerce_paths(cfg)
        return cfg

    # ── resolved endpoint lists ──────────────────────────────────────────
    def llm_endpoints(self) -> list[str]:
        """Ordered LLM base URLs for failover. llm_urls wins; otherwise the
        single llm_url (or an empty list when neither is set)."""
        if self.llm_urls:
            return [u for u in self.llm_urls if u]
        if self.llm_url:
            return [self.llm_url]
        return []

    def mcp_endpoints(self) -> list[str]:
        """Ordered MCP server URLs. mcp_urls wins; otherwise the single
        mcp_url (or an empty list when neither is set)."""
        if self.mcp_urls:
            return [u for u in self.mcp_urls if u]
        if self.mcp_url:
            return [self.mcp_url]
        return []


# ── load() layers (defaults < config.yaml < env < settings.yaml) ──────────
def _read_config_file(path: Path) -> dict:
    """config.yaml as a mapping; {} when absent.

    Deliberately keeps today's failure modes — read_settings_layer is the layer
    that must never raise.
    """
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def _merge_layer(cfg: "Config", data: dict) -> None:
    """Copy known keys from a YAML mapping onto cfg. Unknown keys are ignored;
    None values do not clobber a real value.

    The guard is __dataclass_fields__ rather than hasattr, so a YAML key named
    `load` or `llm_endpoints` cannot shadow a method on the instance.
    """
    fields = type(cfg).__dataclass_fields__
    for k, v in data.items():
        if k in fields and v is not None:
            setattr(cfg, k, v)


def _apply_env(cfg: "Config") -> None:
    for env_key, attr in ENV_OVERRIDES:
        val = os.environ.get(env_key)
        if not val:
            continue
        if attr in _ENV_CSV_ATTRS:  # comma-separated list -> list field
            setattr(cfg, attr, [u.strip() for u in val.split(",") if u.strip()])
        else:
            setattr(cfg, attr, val)
    for env_key, attr in ENV_EXTRA.items():
        if attr == "brightspace_hosts":
            # falsy check: an empty allowlist means "proxy stays disabled",
            # not "clear the hosts from config.yaml"
            if os.environ.get(env_key):
                cfg.brightspace_hosts = [
                    h.strip() for h in os.environ[env_key].split(",") if h.strip()
                ]
        else:
            # os.environ.get(name, current): an explicitly-empty credential
            # clears the file's value. Preserved verbatim from the pre-refactor
            # code — this task normalises the table, it does not change
            # credential semantics.
            setattr(cfg, attr, os.environ.get(env_key, getattr(cfg, attr)))


def _coerce_paths(cfg: "Config") -> None:
    """expand ~ and coerce to Path (YAML strings don't auto-coerce)."""
    for field in ("data_root", "db_path", "token_dir", "browser_profile_dir"):
        val = getattr(cfg, field)
        if isinstance(val, str):
            val = Path(val)
        if isinstance(val, Path):
            val = Path(os.path.expanduser(str(val)))
        setattr(cfg, field, val)
