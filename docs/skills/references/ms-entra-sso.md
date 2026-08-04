# Microsoft Entra SSO automation via Playwright (Western + Duo)

Port of brightspace-mcp's `auth/purdue-sso.ts` + `browser-auth.ts` to Python
(`~/campus/sync/auth.py`). All quirks below were hit LIVE on 2026-07-31.

## Flow

1. `page.goto(baseUrl + /d2l/home)` — if not already logged in, redirects to
   `/d2l/login` (campus selector).
2. Campus selector: buttons use `data-onclick` attributes, NOT standard
   handlers. `page.evaluate` with `eval(handler)` on
   `button[data-onclick], a[data-onclick]` (plain `.click()` does nothing).
3. Redirects to `login.microsoftonline.com/.../saml2?...` (SAML request).
4. Microsoft shows ONE of: account picker / email form / password-only /
   already-authed (bail to /d2l/home).
5. MFA: Duo push on phone → "Stay signed in?" prompt → /d2l/home.
6. Extract token from localStorage (`D2L.Fetch.Tokens` → `["*:*:*"]`).

## Quirks (each one cost a failed run)

- **Account picker entries are `div[role=button]`, not `<button>` tags.**
  CSS `button:has-text("user@school")` returns count 0. Use
  `page.get_by_role("button", name=re.compile(re.escape(username), re.I))`.
  Appears after the first successful login (device remembered) — repeated
  runs hit the picker, not the email form.
- **"Stay signed in?" deadlock:** the Yes prompt appears on
  login.microsoftonline.com BEFORE the redirect to /d2l/home. `wait_for_url(
  "**/d2l/home")` blocks forever → 5-min timeout while the prompt sits there.
  Fix: poll a loop watching for BOTH `/d2l/home` in URL AND the Yes button;
  click Yes when visible.
- **Password-remembered path:** after clicking the account, only
  `input[type='password']` appears (no email). Handle it.
- **MFA wait must be generous:** Duo approval can take minutes (phone in
  pocket). 10-min deadline + screenshot + body-text dump on timeout for
  self-diagnosis. He approved at ~5:01 for a 5:00 timeout once.
- **Duo push may not re-fire:** after one successful approval, Microsoft may
  skip MFA on subsequent attempts (device trusted) — don't assume every run
  needs a push.
- Repeated automated logins → Microsoft may show error/security pages;
  retry is legitimate, but don't loop blindly — dump page text.
- Token extraction is multi-strategy: localStorage → API-nudge (goto
  `/d2l/api/lp/{v}/users/whoami`, re-check localStorage) → cookie fallback
  (`d2l*` cookies → `cookie:` prefix). Validate each via whoami (200).

## Launch args that work

```python
p.chromium.launch_persistent_context(
    user_data_dir=profile_dir,          # cookies survive → silent re-login
    headless=True,
    args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
)
```
Persist `storage_state` to the profile dir after success. On NixOS the
browser MUST come from nixpkgs (see SKILL.md pitfalls — pip chromium won't run).

## Debugging

`tools/debug_sso.py` + `tools/debug_sel.py` in the repo reproduce the flow and
dump URL/body-text/inputs/buttons/selector-counts — run with
`PYTHONPATH=$PWD` (script dir goes on sys.path, not repo root).
