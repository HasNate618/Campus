"""Token store — plaintext JSON, chmod 600.

Deliberately NOT the MCP's scheme (AES key derived from container hostname —
breaks on restart). Ours survives restarts by design. Support both Bearer
tokens and cookie-based auth ("cookie:" prefix), mirroring the MCP client.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path


def write_secret(path: Path, text: str, chmod_parent: bool = True) -> None:
    """Write `text` to `path` with mode 0600, atomically, creating the parent
    0700.

    A plain write_text() + chmod() leaves the secret briefly world-readable,
    and leaves it that way permanently if the process dies between the two
    calls. Writing to a 0600 temp file and os.replace()-ing it means the
    secret is never readable by anyone else, even momentarily.

    chmod failures are deliberately swallowed: on a deployment where the file
    or its directory was created by another uid (e.g. a root-owned container
    volume) being unable to *tighten* permissions must not break
    authentication. Being unable to write at all still raises.

    `chmod_parent=False` skips tightening the parent directory. The settings
    writer shares data/ with the DB and the corpus tree, so it must not change
    their mode; the token dir (the original caller) keeps the 0700 default.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if chmod_parent:
        try:
            path.parent.chmod(0o700)
        except OSError:
            pass
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    try:
        path.chmod(0o600)
    except OSError:
        pass


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
        write_secret(self.token_file, json.dumps(token.__dict__))

    def clear(self) -> None:
        try:
            self.token_file.unlink()
        except FileNotFoundError:
            pass

    def is_valid(self, token: TokenData) -> bool:
        # pi-lens-ignore: ast-grep:unchecked-throwing-call-python
        now_ms = int(time.time() * 1000)
        return token.expires_at - now_ms > self.refresh_buffer * 1000

    def needs_refresh(self) -> bool:
        return self.load() is None

    def build(self, access_token: str, source: str = "browser") -> TokenData:
        # pi-lens-ignore: ast-grep:unchecked-throwing-call-python
        now = int(time.time() * 1000)
        return TokenData(
            access_token=access_token,
            captured_at=now,
            expires_at=now + self.ttl * 1000,
            source=source,
        )
