#!/usr/bin/env python3
"""Test selector counts against the live 'Pick an account' page."""
from sync.config import Config
from sync.auth import _log, _handle_campus_selector
from playwright.sync_api import sync_playwright
import re

cfg = Config.load()
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=str(cfg.browser_profile_dir), headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    page = ctx.new_page()
    page.goto(f"{cfg.base_url}/d2l/home", wait_until="domcontentloaded", timeout=30_000)
    if "/d2l/home" not in page.url:
        _handle_campus_selector(page)
        page.wait_for_timeout(6000)
        print("url:", page.url[:80])
        sels = {
            "list-text-exact": f'[data-testid="list"] >> text="{cfg.username}"',
            "button-has-text": f'button:has-text("{cfg.username}")',
            "list-role-option": 'div[data-testid="list"] >> div[role="option"]',
            "get_by_role_btn": None,
        }
        for name, sel in sels.items():
            if sel:
                try:
                    print(f"{name}: count={page.locator(sel).count()}")
                except Exception as e:
                    print(f"{name}: ERR {e}")
        try:
            gbr = page.get_by_role("button", name=re.compile(re.escape(cfg.username), re.IGNORECASE))
            print("get_by_role button:", gbr.count())
        except Exception as e:
            print("gbr ERR", e)
    ctx.close()
