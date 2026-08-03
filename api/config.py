"""Runtime configuration for the Campus API (real harness config)."""

from __future__ import annotations

import os
from pathlib import Path

from sync.config import Config as HarnessConfig

# the harness config: db_path, data_root, service URLs, model — YAML + env
cfg = HarnessConfig.load()

DB_PATH = Path(os.environ.get("CAMPUS_DB", cfg.db_path))
SCHOOL_ROOT = Path(os.environ.get("CAMPUS_SCHOOL_ROOT", cfg.data_root))
USE_MOCK = False  # the mock scaffold is gone — everything is real now
TIMEZONE = "America/Toronto"
