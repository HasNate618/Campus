"""Campus sync engine — deterministic Brightspace sync (H1).

Custom sync: Playwright + Duo auth, own token store (survives restarts),
D2L REST API pulls. Chat/AI never calls Brightspace live — only this
synced data. No auto-scrape: sync runs manually or on nudge.
"""
from .config import Config
from .token_store import TokenStore, TokenData
from .d2l import D2LClient

__all__ = ["load_config", "Config", "TokenStore", "TokenData", "D2LClient"]
