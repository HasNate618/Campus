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
        path = path or DEFAULT_CONFIG_PATH
        if path.exists():
            with open(path) as f:
                data = yaml.safe_load(f) or {}
            for k, v in data.items():
                if hasattr(cfg, k) and v is not None:
                    setattr(cfg, k, v)
        # env overrides. Two naming conventions are supported so the project
        # is portable: the conventional OpenAI-compatible names (OPENAI_*) any
        # outsider already knows, and the Campus-specific CAMPUS_* names used by
        # the homelab deployment for non-LLM services. For the LLM, only the
        # standard OPENAI_* names are accepted (no CAMPUS_LLM_* aliases) so the
        # interface stays clean. Single + plural (comma-separated) forms both work.
        overrides = [
            ("OPENAI_ENDPOINT", "llm_url"),
            ("OPENAI_ENDPOINTS", "llm_urls_csv"),
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
            ("CAMPUS_MCP_URLS", "mcp_urls_csv"),
            ("CAMPUS_EMBED_MODEL", "embed_model"),
            ("CAMPUS_RERANK_MODEL", "rerank_model"),
            ("CAMPUS_BRIGHTSPACE_BASE_URL", "brightspace_base_url"),
            ("CAMPUS_WEB_PASSWORD", "web_password"),
        ]
        for env_key, attr in overrides:
            val = os.environ.get(env_key)
            if not val:
                continue
            if attr.endswith("_csv"):  # comma-separated list -> list field
                setattr(cfg, attr[:-4], [u.strip() for u in val.split(",") if u.strip()])
            else:
                setattr(cfg, attr, val)
        cfg.username = os.environ.get("CAMPUS_USERNAME", cfg.username)
        cfg.password = os.environ.get("CAMPUS_BRIGHTSPACE_PASSWORD", cfg.password)
        if os.environ.get("CAMPUS_BRIGHTSPACE_HOSTS"):
            cfg.brightspace_hosts = [
                h.strip() for h in os.environ["CAMPUS_BRIGHTSPACE_HOSTS"].split(",") if h.strip()
            ]
        if os.environ.get("CAMPUS_MCP_URLS"):
            cfg.mcp_urls = [
                u.strip() for u in os.environ["CAMPUS_MCP_URLS"].split(",") if u.strip()
            ]
        # expand ~ and coerce to Path (YAML strings don't auto-coerce)
        for field in ("data_root", "db_path", "token_dir", "browser_profile_dir"):
            val = getattr(cfg, field)
            if isinstance(val, str):
                val = Path(val)
            if isinstance(val, Path):
                val = Path(os.path.expanduser(str(val)))
            setattr(cfg, field, val)
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
