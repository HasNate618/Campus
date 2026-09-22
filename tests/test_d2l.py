"""D2L client guards — built around the download path that silently wrote
login pages to disk as course files.

`_request(..., raw=True)` is only used by file-download endpoints, whose callers
write `resp.content` straight to disk. An expired session redirects such a
download to the login page, which answers HTTP 200 with an HTML body, so the
login page landed on disk as the course's `.pdf`/`.pptx` — silently, and it was
never re-downloaded because the file then existed.
"""

from __future__ import annotations

import httpx
import pytest


def _client(response):
    """A real D2LClient with its HTTP transport stubbed out."""
    from sync.d2l import D2LClient

    client = D2LClient("https://example.brightspace.com", lambda: None)

    class StubClient:
        def request(self, method, url, headers=None):
            return response

    client._client = StubClient()
    token = type("Tok", (), {"is_cookie": False, "access_token": "tok"})()
    return client, token


def _resp(status=200, url="https://cdn.example.com/file.pdf",
          content=b"%PDF-1.4 body"):
    return httpx.Response(
        status, content=content,
        headers={"content-type": "application/pdf"},
        request=httpx.Request("GET", url))


def test_get_raw_refuses_a_download_that_landed_on_a_login_page():
    from sync.d2l import D2LAuthError

    client, token = _client(_resp(
        200, "https://example.brightspace.com/d2l/login?target=%2Ffile",
        b"<!DOCTYPE html><html><body>Sign in</body></html>"))
    with pytest.raises(D2LAuthError) as e:
        client._request("GET", "/d2l/api/le/1.0/123/file", token, raw=True)
    assert "login" in str(e.value).lower()


def test_get_raw_allows_a_legitimate_download():
    """Redirects stay enabled on purpose: D2L legitimately sends file downloads
    to a CDN, so a non-login 200 must still return the body."""
    client, token = _client(_resp())
    r = client._request("GET", "/d2l/api/le/1.0/123/file", token, raw=True)
    assert r.content.startswith(b"%PDF")


def test_get_raw_guard_does_not_affect_json_requests():
    """Only `raw` downloads are guarded — a JSON call returning a login URL
    must not be turned into an auth error by this check."""
    client, token = _client(httpx.Response(
        200, json={"ok": True},
        request=httpx.Request("GET", "https://example.brightspace.com/d2l/login")))
    assert client._request("GET", "/d2l/api/lp/1.0/courses/", token) == {"ok": True}


def test_retry_after_http_date_does_not_crash(monkeypatch):
    """Retry-After is RFC-permitted to be an HTTP-date (some CDNs emit one).
    float() on it raised ValueError instead of raising D2LRateLimitError."""
    from sync import d2l
    from sync.d2l import D2LRateLimitError

    monkeypatch.setattr(d2l.time, "sleep", lambda _s: None)  # don't wait for real
    response = _resp(429, content=b"")
    response.headers["retry-after"] = "Wed, 21 Oct 2026 07:28:00 GMT"
    client, token = _client(response)

    # falls back to 5.0 (< 30) so it retries once; the stub returns 429 again
    # and the retry must raise the library's own error, not ValueError.
    with pytest.raises(D2LRateLimitError) as e:
        client._request("GET", "/d2l/api/le/1.0/123/file", token, raw=True)
    assert "429" in str(e.value) or "Rate limited" in str(e.value)
