from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from api import services

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/announcements")
def announcements(course_id: int | None = None, limit: int = Query(20, le=100)):
    return services.list_announcements(course_id=course_id, limit=limit)


@router.get("/events")
def events(
    course_id: int | None = None,
    from_dt: str | None = None,
    to_dt: str | None = None,
):
    return services.list_events(course_id=course_id, from_dt=from_dt, to_dt=to_dt)


@router.get("/events/next-7-days")
def events_next_7(course_id: int | None = None):
    return services.events_next_days(7, course_id=course_id)


@router.get("/files/{file_id}")
def get_file(file_id: int):
    f = services.get_file(file_id)
    if not f:
        raise HTTPException(404, "File not found")
    return f


@router.get("/files/{file_id}/content")
def file_content(file_id: int):
    content = services.get_file_content(file_id)
    if content is None:
        raise HTTPException(404, "File not found")
    return content


@router.get("/files/{file_id}/raw")
def file_raw(file_id: int):
    """Raw bytes (PDFs for pdf.js). Path-guarded to SCHOOL_ROOT."""
    from fastapi.responses import FileResponse
    p = services.get_file_raw_path(file_id)
    if not p:
        raise HTTPException(404, "File not found")
    if p.resolve().is_relative_to(services.SCHOOL_ROOT.resolve()):
        return FileResponse(p)
    raise HTTPException(403, "Forbidden")


@router.get("/assets/{rel_path:path}")
def asset(rel_path: str):
    """Serve locally-cached content assets (images downloaded by
    tools/cache_images.py). Path-guarded to SCHOOL_ROOT."""
    from fastapi.responses import FileResponse
    p = (services.SCHOOL_ROOT / rel_path).resolve()
    if not p.is_relative_to(services.SCHOOL_ROOT.resolve()) or not p.exists() or not p.is_file():
        raise HTTPException(404, "Asset not found")
    return FileResponse(p)


# Brightspace-hosted images inside html content need an authenticated fetch —
# the browser has no Brightspace session, so we proxy through the API token.
# The allowlist is config-driven (cfg.brightspace_hosts); empty = proxy disabled.
from api.config import cfg as _cfg
_ALLOWED_PROXY_HOSTS = tuple(_cfg.brightspace_hosts)


@router.get("/config")
def app_config():
    """Frontend bootstrap config: Brightspace hosts/base URL for the content
    proxy + link rebasing. Empty lists = features disabled (portable default)."""
    return {
        "brightspace_hosts": list(_cfg.brightspace_hosts),
        "brightspace_base_url": _cfg.brightspace_base_url,
        "llm_model": _cfg.llm_model,
    }


@router.get("/proxy")
def proxy(url: str):
    from urllib.parse import urlparse
    from fastapi.responses import Response
    from api.config import cfg
    u = urlparse(url)
    if u.hostname not in _ALLOWED_PROXY_HOSTS:
        raise HTTPException(403, "Host not allowed")
    if u.scheme not in ("http", "https"):
        raise HTTPException(403, "Scheme not allowed")
    try:
        import httpx
        headers = {"User-Agent": "Campus/0.1"}
        # enforced-content URLs need the browser session — use the cookies
        # captured at auth time when available
        cookie_file = Path(cfg.token_dir) / "cookies.json"
        if cookie_file.exists():
            try:
                data = json.loads(cookie_file.read_text())
                host = u.hostname or ""
                parts = [f"{c['name']}={c['value']}" for c in data.get("cookies", [])
                         if host.endswith(c.get("domain", "").lstrip("."))]
                if parts:
                    headers["Cookie"] = "; ".join(parts)
            except Exception:
                pass
        if "Cookie" not in headers:
            from sync.token_store import TokenStore
            store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)
            token = store.load()
            if not token:
                raise HTTPException(502, "No valid Brightspace session — run auth")
            from sync.d2l import D2LClient
            client = D2LClient(cfg.base_url, store.load)
            headers.update(client._auth_headers(token))
            client.close()
        r = httpx.get(url, headers=headers, timeout=30, follow_redirects=False)
        if r.status_code in (301, 302, 303, 307, 308):
            loc = r.headers.get("location", "")
            if "login" in loc:
                raise HTTPException(502, "Brightspace session expired — run auth")
            raise HTTPException(502, f"Upstream redirect to {loc[:120]}")
        if r.status_code != 200:
            raise HTTPException(r.status_code, "Upstream error")
        ctype = r.headers.get("content-type", "application/octet-stream")
        return Response(content=r.content, media_type=ctype)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Proxy failed: {e}")
