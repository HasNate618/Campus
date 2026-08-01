"""D2L REST API client — deterministic pulls for the sync engine.

Port of the brightspace-mcp api/client.ts patterns (MIT, Rohan Muppa):
- version discovery from /d2l/api/versions/
- lp / le / leGlobal path builders
- Bearer or cookie auth ("cookie:" prefix)
- token bucket rate limiting, 401 retry-once, JSON + raw (binary) GETs
"""
from __future__ import annotations

import time

import httpx

UA = "HippoCampus/0.1 (personal sync; user@example.com)"


class D2LError(Exception):
    pass


class D2LAuthError(D2LError):
    pass


class D2LRateLimitError(D2LError):
    pass


class TokenBucket:
    def __init__(self, capacity: int = 10, refill_per_sec: float = 3.0):
        self.capacity = capacity
        self.refill = refill_per_sec
        self.tokens = float(capacity)
        self.last = time.monotonic()

    def consume(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.refill)
        self.last = now
        if self.tokens < 1:
            time.sleep((1 - self.tokens) / self.refill)
            self.tokens = 0.0
        else:
            self.tokens -= 1


class D2LClient:
    def __init__(self, base_url: str, token_provider, timeout: float = 30.0):
        """token_provider: callable() -> TokenData | None (from TokenStore)."""
        self.base_url = base_url.rstrip("/")
        self.token_provider = token_provider
        self.timeout = timeout
        self._versions: dict | None = None
        self._bucket = TokenBucket()
        self._client = httpx.Client(
            timeout=timeout,
            headers={"User-Agent": UA},
            follow_redirects=True,
        )

    # ── version discovery ────────────────────────────────────────────────
    def initialize(self) -> None:
        r = self._client.get(f"{self.base_url}/d2l/api/versions/")
        r.raise_for_status()
        data = r.json()
        # data: [{"ProductCode": "lp", "LatestVersion": "1.62"}, ...]
        by_code = {item.get("ProductCode", "").lower(): item for item in data}
        lp = by_code.get("lp", {}).get("LatestVersion")
        le = by_code.get("le", {}).get("LatestVersion")
        if not lp or not le:
            raise D2LError("LP/LE versions not found in /d2l/api/versions/")
        self._versions = {"lp": lp, "le": le}

    @property
    def versions(self) -> dict:
        if not self._versions:
            self.initialize()
        return self._versions

    def lp(self, path: str) -> str:
        return f"/d2l/api/lp/{self.versions['lp']}{path}"

    def le(self, org_unit_id: int, path: str) -> str:
        return f"/d2l/api/le/{self.versions['le']}/{org_unit_id}{path}"

    def le_global(self, path: str) -> str:
        return f"/d2l/api/le/{self.versions['le']}{path}"

    # ── requests ─────────────────────────────────────────────────────────
    def _auth_headers(self, token) -> dict:
        if token.is_cookie:
            return {"Cookie": token.cookie_header()}
        return {"Authorization": f"Bearer {token.access_token}"}

    def get(self, path: str) -> dict | list:
        """GET + parse JSON, with one retry on 401 (fresh token)."""
        token = self.token_provider()
        if not token:
            raise D2LAuthError("No valid token — run `python -m sync.auth`")
        return self._request("GET", path, token)

    def get_raw(self, path: str) -> httpx.Response:
        token = self.token_provider()
        if not token:
            raise D2LAuthError("No valid token — run `python -m sync.auth`")
        return self._request("GET", path, token, raw=True)

    def _request(self, method: str, path: str, token, raw: bool = False, is_retry: bool = False):
        self._bucket.consume()
        url = f"{self.base_url}{path}"
        try:
            r = self._client.request(method, url, headers=self._auth_headers(token))
        except httpx.HTTPError as e:
            raise D2LError(f"Network error on {path}: {e}") from e

        if r.status_code == 401:
            if is_retry:
                raise D2LAuthError(f"Second 401 on {path} — session expired; re-auth via `python -m sync.auth`")
            fresh = self.token_provider()
            if fresh and fresh.access_token != token.access_token:
                return self._request(method, path, fresh, raw=raw, is_retry=True)
            raise D2LAuthError(f"401 on {path} and no fresh token — re-auth")
        if r.status_code == 429:
            raise D2LRateLimitError(f"Rate limited on {path}")
        if r.status_code == 403:
            raise D2LError(f"403 on {path} (past-semester course or no access)")
        if r.status_code == 404:
            raise D2LError(f"404 on {path}")
        r.raise_for_status()
        if raw:
            return r
        return r.json()

    def close(self) -> None:
        self._client.close()
