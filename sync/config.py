"""Configuration for HippoCampus sync engine.

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
    base_url: str = "https://westernu.brightspace.com"
    username: str = ""
    password: str = ""  # from env HIPPO_BRIGHTSPACE_PASSWORD, never config file

    # paths
    data_root: Path = field(default_factory=lambda: Path("/srv/homelab/school"))
    db_path: Path = field(default_factory=lambda: Path(REPO_ROOT / "data" / "harness.db"))
    token_dir: Path = field(default_factory=lambda: Path.home() / ".hippocampus")
    browser_profile_dir: Path = field(default_factory=lambda: Path.home() / ".hippocampus" / "browser-data")

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
    term_dates: dict = field(default_factory=dict)  # {"2026F": "2026-09-01"} — anchors class events

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
        cfg.username = os.environ.get("HIPPO_USERNAME", cfg.username)
        cfg.password = os.environ.get("HIPPO_BRIGHTSPACE_PASSWORD", cfg.password)
        if os.environ.get("HIPPO_BASE_URL"):
            cfg.base_url = os.environ["HIPPO_BASE_URL"]
        if os.environ.get("HIPPO_DATA_ROOT"):
            cfg.data_root = Path(os.environ["HIPPO_DATA_ROOT"])
        # expand ~ and coerce to Path (YAML strings don't auto-coerce)
        for field in ("data_root", "db_path", "token_dir", "browser_profile_dir"):
            val = getattr(cfg, field)
            if isinstance(val, str):
                val = Path(val)
            if isinstance(val, Path):
                val = Path(os.path.expanduser(str(val)))
            setattr(cfg, field, val)
        return cfg
