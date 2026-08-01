#!/usr/bin/env python3
"""Debug: reproduce the SSO flow and dump what Microsoft renders."""
import sys
from sync.config import Config
from sync.auth import _log, _handle_campus_selector

cfg = Config.load()
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=str(cfg.browser_profile_dir),
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    page = ctx.new_page()
    page.goto(f"{cfg.base_url}/d2l/home", wait_until="domcontentloaded", timeout=30_000)
    _log(f"after home: {page.url}")
    if "/d2l/home" not in page.url:
        _handle_campus_selector(page)
        _log(f"after campus: {page.url}")
        page.wait_for_timeout(8000)
        _log(f"after 8s: {page.url}")
        text = page.inner_text("body")[:1500]
        print("=== BODY TEXT ===")
        print(text)
        print("=== INPUTS ===")
        inputs = page.eval_on_selector_all("input", "els => els.map(e => e.type + '|' + (e.name||'') + '|' + (e.id||''))")
        print(inputs)
        print("=== BUTTONS ===")
        btns = page.eval_on_selector_all("button, [role=button], input[type=submit]", "els => els.slice(0,15).map(e => (e.innerText||e.value||'').trim().slice(0,60))")
        print(btns)
        page.screenshot(path="/tmp/ms-debug.png")
    ctx.close()
