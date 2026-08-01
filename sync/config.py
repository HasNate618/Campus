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
    data_root: Path = field(default_factory=lambda: Path("{data_root}"))
    db_path: Path = field(default_factory=lambda: Path(REPO_ROOT / "data" / "harness.db"))
    token_dir: Path = field(default_factory=lambda: Path.home() / ".hippocampus")
    browser_profile_dir: Path = field(default_factory=lambda: Path.home() / ".hippocampus" / "browser-data")

    # auth
    token_ttl: int = 3600  # seconds; Brightspace Bearer tokens last ~1h
    refresh_buffer: int = 300  # seconds before expiry = invalid

    # services (docker network names)
    bifrost_url: str = "http://bifrost:8080/v1"
    bifrost_model: str = "cohere/command-a-vision-07-2025"
    pdf_extractor_url: str = "http://pdf-extractor:8000"
    ntfy_url: str = "http://ntfy:8080"  # topic set per-run

    # sync scope
    pilot_only: bool = True  # H1: only sync is_pilot courses
    max_file_size: int = 200 * 1024 * 1024  # skip downloads above this

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
        return cfg
