"""Brightspace auth CLI — Playwright + Duo, own token store.

Usage:  python -m sync.auth            # full browser login (Duo push)
        python -m sync.auth --status   # is the stored token valid?

Port of the brightspace-mcp auth flow (MIT, Rohan Muppa): campus selector
(data-onclick), Microsoft Entra credentials, MFA wait, token extraction
from localStorage (D2L.Fetch.Tokens) with cookie fallback.

Browser profile is persisted (storage-state) so re-auth within cookie
lifetime is silent — Duo only when cookies expire.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from sync.config import Config


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _click_data_onclick(page) -> None:
    """D2L campus-selector buttons use data-onclick, not standard handlers."""
    page.evaluate(
        """() => {
            const btn = document.querySelector("button[data-onclick], a[data-onclick]");
            if (btn) {
                const handler = btn.getAttribute("data-onclick");
                if (handler) { eval(handler); } else { btn.click(); }
            }
        }"""
    )


def _handle_campus_selector(page) -> None:
    if "/d2l/login" not in page.url:
        return
    _log("Campus selector detected")
    buttons = page.locator('button:has-text("Log in with"), a:has-text("Log in with")')
    if buttons.count() > 0:
        _log(f"Found {buttons.count()} login button(s) — clicking the first")
        _click_data_onclick(page)
        page.wait_for_timeout(3000)
        return
    raise RuntimeError("No login buttons found on campus selector")


def _enter_microsoft_credentials(page, username: str, password: str) -> None:
    if not username or not password:
        raise RuntimeError("HIPPO_USERNAME / HIPPO_BRIGHTSPACE_PASSWORD not set")
    _log("Entering Microsoft email")
    email = page.locator("input[type='email']")
    email.wait_for(state="visible", timeout=30_000)
    email.fill(username)
    page.locator('input[type="submit"][value="Next"], button:has-text("Next")').first.click()
    _log("Entering Microsoft password")
    pwd = page.locator("input[type='password']")
    pwd.wait_for(state="visible", timeout=30_000)
    pwd.fill(password)
    page.locator('input[type="submit"][value="Sign in"], button:has-text("Sign in")').first.click()


def _handle_credentials(page, cfg: Config) -> None:
    for _ in range(20):  # wait for redirect to Microsoft or Shibboleth
        url = page.url
        if "microsoftonline.com" in url or "login.microsoft.com" in url:
            _enter_microsoft_credentials(page, cfg.username, cfg.password)
            return
        if "login." in url or "/d2l/login" in url:
            # still on D2L or generic login — wait for redirect
            pass
        page.wait_for_timeout(1000)
    raise RuntimeError(f"Did not reach Microsoft login (stuck at {page.url})")


def _handle_mfa(page) -> None:
    _log("Waiting for MFA approval on your device (Duo push)...")
    try:
        page.wait_for_url("**/d2l/home", timeout=300_000)
    except Exception:
        raise RuntimeError("MFA/login timed out after 5 minutes")
    _log("Login successful — reached Brightspace home")


def _handle_stay_signed_in(page) -> None:
    try:
        yes = page.locator(
            'input[type="submit"][value="Yes"], button:has-text("Yes")'
        ).first
        yes.wait_for(state="visible", timeout=5_000)
        yes.click()
        _log("Clicked 'Yes' on 'Stay signed in?'")
    except Exception:
        pass  # prompt didn't appear — fine


def _extract_local_storage_token(page) -> str | None:
    try:
        return page.evaluate(
            """() => {
                try {
                    const raw = localStorage.getItem("D2L.Fetch.Tokens");
                    if (!raw) return null;
                    const tokens = JSON.parse(raw);
                    const t = tokens["*:*:*"];
                    return t && t.access_token ? t.access_token : null;
                } catch { return null; }
            }"""
        )
    except Exception:
        return None


def _extract_cookie_token(context, base_url: str) -> str | None:
    cookies = context.cookies(base_url)
    relevant = [c for c in cookies if c["name"].startswith("d2l")]
    if not relevant:
        return None
    return "cookie:" + "; ".join(f"{c['name']}={c['value']}" for c in relevant)


def _validate_token(token: str, cfg: Config, versions) -> bool:
    """Validate via /d2l/api/lp/{v}/users/whoami."""
    import httpx

    headers = {"User-Agent": "HippoCampus/0.1"}
    if token.startswith("cookie:"):
        headers["Cookie"] = token[len("cookie:"):]
    else:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = httpx.get(
            f"{cfg.base_url}/d2l/api/lp/{versions['lp']}/users/whoami",
            headers=headers, timeout=15,
        )
        return r.status_code == 200
    except Exception:
        return False


def auth(cfg: Config, store) -> bool:
    from playwright.sync_api import sync_playwright

    cfg.browser_profile_dir.mkdir(parents=True, exist_ok=True)
    storage_path = cfg.browser_profile_dir / "storage-state.json"
    if not storage_path.exists():
        storage_path.write_text("{}")  # fresh profile

    # versions for validation
    from sync.d2l import D2LClient
    probe = D2LClient(cfg.base_url, lambda: None)
    probe.initialize()
    versions = probe.versions
    probe.close()

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(cfg.browser_profile_dir),
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        page = context.new_page()
        try:
            _log(f"Navigating to {cfg.base_url}/d2l/home")
            page.goto(f"{cfg.base_url}/d2l/home", wait_until="domcontentloaded", timeout=30_000)

            if "/d2l/home" not in page.url:
                _log("Login required — starting SSO flow")
                _handle_campus_selector(page)
                _handle_credentials(page, cfg)
                _handle_mfa(page)
                _handle_stay_signed_in(page)
            else:
                _log("Already logged in via stored session")

            # ── token extraction ────────────────────────────────────────
            token = _extract_local_storage_token(page)
            if token and _validate_token(token, cfg, versions):
                _log("Extracted valid Bearer token from localStorage")
                store.save(store.build(token, source="browser"))
                context.storage_state(path=str(storage_path))
                return True

            # nudge: hit API endpoint, re-check localStorage
            try:
                page.goto(f"{cfg.base_url}/d2l/api/lp/{versions['lp']}/users/whoami",
                          wait_until="load", timeout=15_000)
                token = _extract_local_storage_token(page)
                if token and _validate_token(token, cfg, versions):
                    _log("Extracted valid Bearer token after API nudge")
                    store.save(store.build(token, source="browser"))
                    context.storage_state(path=str(storage_path))
                    return True
            except Exception:
                pass

            # cookie fallback
            cookie_token = _extract_cookie_token(context, cfg.base_url)
            if cookie_token and _validate_token(cookie_token, cfg, versions):
                _log("Extracted valid session cookie for API auth")
                store.save(store.build(cookie_token, source="cookie"))
                return True

            _log("All token extraction strategies failed")
            return False
        finally:
            context.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="HippoCampus Brightspace auth")
    ap.add_argument("--status", action="store_true", help="check stored token validity")
    args = ap.parse_args()

    cfg = Config.load()
    from sync.token_store import TokenStore
    store = TokenStore(cfg.token_dir, ttl=cfg.token_ttl, refresh_buffer=cfg.refresh_buffer)

    if args.status:
        tok = store.load()
        if tok:
            left = (tok.expires_at - int(time.time() * 1000)) / 1000
            _log(f"Token valid — expires in {int(left)}s (source: {tok.source})")
        else:
            _log("No valid token stored")
            return 1
        return 0

    if not cfg.username:
        print("Set HIPPO_USERNAME and HIPPO_BRIGHTSPACE_PASSWORD (env or config.yaml)")
        return 1

    _log(f"Authenticating as {cfg.username}")
    _log("Approve the Duo MFA request on your phone when prompted.")
    ok = auth(cfg, store)
    if ok:
        _log("Auth complete — token saved to " + str(store.token_file))
        return 0
    _log("Auth FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
