"""Token store — plaintext JSON, chmod 600.

Deliberately NOT the MCP's scheme (AES key derived from container hostname —
breaks on restart). Ours survives restarts by design. Support both Bearer
tokens and cookie-based auth ("cookie:" prefix), mirroring the MCP client.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TokenData:
    access_token: str
    captured_at: int  # epoch ms
    expires_at: int   # epoch ms
    source: str = "browser"

    @property
    def is_cookie(self) -> bool:
        return self.access_token.startswith("cookie:")

    def cookie_header(self) -> str:
        return self.access_token[len("cookie:"):]


class TokenStore:
    def __init__(self, token_dir: Path, ttl: int = 3600, refresh_buffer: int = 300):
        self.token_dir = Path(token_dir)
        self.token_file = self.token_dir / "token.json"
        self.ttl = ttl
        self.refresh_buffer = refresh_buffer

    def load(self) -> TokenData | None:
        try:
            if not self.token_file.exists():
                return None
            raw = json.loads(self.token_file.read_text())
            tok = TokenData(**raw)
            if self.is_valid(tok):
                return tok
            return None
        except (json.JSONDecodeError, TypeError, OSError):
            return None

    def save(self, token: TokenData) -> None:
        self.token_dir.mkdir(parents=True, exist_ok=True)
        self.token_file.write_text(json.dumps(token.__dict__))
        self.token_file.chmod(0o600)

    def clear(self) -> None:
        try:
            self.token_file.unlink()
        except FileNotFoundError:
            pass

    def is_valid(self, token: TokenData) -> bool:
        now_ms = int(time.time() * 1000)
        return token.expires_at - now_ms > self.refresh_buffer * 1000

    def needs_refresh(self) -> bool:
        return self.load() is None

    def build(self, access_token: str, source: str = "browser") -> TokenData:
        now = int(time.time() * 1000)
        return TokenData(
            access_token=access_token,
            captured_at=now,
            expires_at=now + self.ttl * 1000,
            source=source,
        )
