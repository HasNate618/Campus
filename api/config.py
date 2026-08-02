"""Runtime configuration for the HippoCampus API."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("HIPPO_DB", ROOT / "data" / "harness.db"))
SCHOOL_ROOT = Path(os.environ.get("HIPPO_SCHOOL_ROOT", ROOT / "school"))
USE_MOCK = os.environ.get("HIPPO_USE_MOCK", "").lower() in ("1", "true", "yes")
TIMEZONE = "America/Toronto"
