"""Optional single-password auth for the web app.

Config-driven: when `cfg.web_password` is empty the API is fully open (demo
mode, the default). When set, every `/api/*` route except the auth/health/
config allowlist requires a valid session cookie from POST /api/auth/login.

Sessions live in an in-memory dict (single user, 30-day sliding expiry).
A server restart logs everyone out — acceptable for this deployment, and it
keeps the dependency footprint at zero (stdlib secrets/hmac only).
"""

from __future__ import annotations

import hmac
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from api.config import cfg

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "campus_session"
SESSION_TTL = 30 * 24 * 60 * 60  # seconds; sliding window

# session token -> expiry timestamp. Single-user: no pruning needed beyond
# lazily dropping expired tokens on lookup.
_sessions: dict[str, float] = {}

# Routes exempt from the session gate. Keep minimal and explicit: the auth
# endpoints themselves, the health probe, and the boot-time frontend config
# (fetched before the login screen can render; non-sensitive proxy/model
# settings only).
_PUBLIC_PATHS = {"/api/health", "/api/config"}


class LoginBody(BaseModel):
    password: str


def _valid_token(token: str | None) -> bool:
    """True when the token names a live session (sliding expiry)."""
    if not token:
        return False
    try:
        expires = _sessions[token]
    except KeyError:
        return False  # plain dict lookup — nothing secret to time
    now = time.time()
    if expires < now:
        _sessions.pop(token, None)
        return False
    _sessions[token] = now + SESSION_TTL  # sliding window
    return True


def require_auth(request: Request) -> None:
    """FastAPI dependency gating every /api/* data route (see api/main.py).

    No-op when auth is disabled (open demo mode). Static SPA assets are
    never gated — they are served outside /api entirely.
    """
    if not cfg.web_password:
        return
    path = request.url.path
    if path.startswith("/api/auth/") or path in _PUBLIC_PATHS:
        return
    if _valid_token(request.cookies.get(SESSION_COOKIE)):
        return
    raise HTTPException(status_code=401, detail="unauthorized")


@router.post("/login")
def login(body: LoginBody, response: Response):
    """Exchange the password for a session cookie. 403 when auth is off."""
    if not cfg.web_password:
        raise HTTPException(status_code=403, detail="auth disabled")
    if not hmac.compare_digest(
        body.password.encode("utf-8"), cfg.web_password.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="invalid password")
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time() + SESSION_TTL
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL,
        path="/",
        httponly=True,
        samesite="lax",
        # secure=False: the deployment is plain HTTP behind Tailscale by design
    )
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    """Drop the session and clear the cookie."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _sessions.pop(token, None)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    """Auth state for the SPA boot; open mode reports authenticated=True so
    the frontend skips the login screen entirely."""
    if not cfg.web_password:
        return {"authenticated": True}
    return {"authenticated": _valid_token(request.cookies.get(SESSION_COOKIE))}
