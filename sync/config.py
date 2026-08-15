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

    # services (docker network names; host-mapped ports when run on host)
    bifrost_url: str = "http://127.0.0.1:18081/v1"
    bifrost_model: str = "opencode-go/deepseek-v4-flash"  # any model from bifrost /v1/models
    pdf_extractor_url: str = "http://127.0.0.1:8001"
    ntfy_url: str = "http://127.0.0.1:8085"  # topic set per-run
    trawl_url: str = "http://127.0.0.1:11236/mcp"  # trawl MCP (web_search/web_read)

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
        # env overrides
        cfg.username = os.environ.get("CAMPUS_USERNAME", cfg.username)
        cfg.password = os.environ.get("CAMPUS_BRIGHTSPACE_PASSWORD", cfg.password)
        for env_key, attr in [
            ("CAMPUS_BASE_URL", "base_url"),
            ("CAMPUS_DATA_ROOT", "data_root"),
            ("CAMPUS_DB_PATH", "db_path"),
            ("CAMPUS_TOKEN_DIR", "token_dir"),
            ("CAMPUS_BIFROST_URL", "bifrost_url"),
            ("CAMPUS_MODEL", "bifrost_model"),
            ("CAMPUS_PDF_EXTRACTOR_URL", "pdf_extractor_url"),
            ("CAMPUS_NTFY_URL", "ntfy_url"),
            ("CAMPUS_TRAWL_URL", "trawl_url"),
            ("CAMPUS_BRIGHTSPACE_BASE_URL", "brightspace_base_url"),
        ]:
            if os.environ.get(env_key):
                setattr(cfg, attr, os.environ[env_key])
        if os.environ.get("CAMPUS_BRIGHTSPACE_HOSTS"):
            cfg.brightspace_hosts = [
                h.strip() for h in os.environ["CAMPUS_BRIGHTSPACE_HOSTS"].split(",") if h.strip()
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
