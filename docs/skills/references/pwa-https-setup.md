# PWA installability + HTTPS for the campus web app (2026-08-03)

## Why Android refused to install

"Nate: is pwa properly set up? chrome and firefox arent creating the app
properly on android" — root cause: three missing pieces, one hard blocker:

1. **NO service worker** — Chrome's installability criteria require a SW with
   a fetch handler (plus manifest + icons + HTTPS).
2. **SVG-only manifest icons** — Android needs real PNGs (192 + 512,
   ideally a maskable one).
3. **Plain HTTP — the hard blocker.** Browsers only install PWAs over a
   secure context (HTTPS/localhost). `http://school.home.lab` can NEVER
   produce an installable app, no matter what else is fixed.

## The fix: Tailscale HTTPS (no public domain needed)

The homelab has no public domain, but the tailnet issues real Let's Encrypt
certs via `tailscale cert` (HTTPS must be enabled on the tailnet — it is for
this one; the error "Access denied: cert access denied" without sudo, and
"500 invalid domain" with the bare hostname, are both normal:

```bash
sudo tailscale cert home.tail3b22c4.ts.net   # FULL domain — bare 'home' fails
# writes <dns>.crt + .key to the CWD → copy to /var/lib/tailscale/certs/
```

Host `getent hosts <name>.ts.net` may fail (AdGuard doesn't resolve ts.net) —
doesn't matter; USER devices resolve it via the Tailscale app's MagicDNS.
Verify from the host with `curl --resolve home.tail3b22c4.ts.net:443:100.103.1.61 https://…`.

## Caddy changes (modules/server/access/proxy.nix)

- Site block:
  ```
  home.tail3b22c4.ts.net {
    crowdsec
    tls /etc/tailscale-certs/home.tail3b22c4.ts.net.crt /etc/tailscale-certs/home.tail3b22c4.ts.net.key
    reverse_proxy 127.0.0.1:8087 { flush_interval -1 }
  }
  ```
- docker run gains `-v /var/lib/tailscale/certs:/etc/tailscale-certs:ro`
  (the caddy container is `--read-only`).
- tmpfiles rule must be MERGED into the module's existing
  `systemd.tmpfiles.rules` array — defining a second one fails the flake
  check ("attribute already defined").
- Renewal: oneshot `systemd.services.tailscale-cert-renew`
  (WorkingDirectory=/var/lib/tailscale/certs, ExecStart = `tailscale cert
  home.tail3b22c4.ts.net`, ExecStartPost = `docker exec caddy caddy reload
  --config /etc/caddy/Caddyfile`) + weekly `systemd.timers` entry. Certs are
  90-day.

## Frontend pieces (web/)

- **Service worker** `web/public/sw.js` (copied to dist by Vite):
  precache the app shell; **never** touch `/api/*` (SSE chat + live data);
  cache-first for hashed `/assets/*` + `/zen-pdf/`; network-first for
  navigations with a shell fallback. Bump `VERSION` to invalidate.
- **Registration** in `src/main.tsx`: `navigator.serviceWorker.register('/sw.js')`
  in a load handler with `.catch(() => {})` — fails silently on plain-HTTP
  LAN hosts (secure-context requirement), which is fine.
- **PNG icons**: generate from favicon.svg (the violet-gradient square, the
  real app mark — NOT public/icons.svg, which is an icon-lib sprite sheet
  with no dimensions):
  `nix-shell -p librsvg --run 'rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png && … -w 512 … && rsvg-convert -w 512 -h 512 -b "#09090c" favicon.svg -o icon-512-maskable.png'`
- **manifest.json**: add `id` + `scope`, PNG icon entries (192/512/maskable),
  keep `display: standalone`, `start_url: /today`.
- index.html: `mobile-web-app-capable`, `apple-mobile-web-app-*` meta tags +
  apple-touch-icon.

## User-facing install recipe

Phone (Tailscale app connected) → Chrome → **https://home.tail3b22c4.ts.net**
→ menu → "Add to Home screen". The installed app only works while the phone
is on the tailnet (it's a homelab app — expected). Chrome is the reliable
installer; Firefox Android supports A2HS but Chrome-first for full behavior.

## Gotchas

- `tailscale cert` writes to the CWD — running it from the repo dir drops
  `.crt/.key` into the working tree (root-owned → `git add -A` dies with
  "Permission denied"); copy to /var/lib/tailscale/certs and `rm` the
  repo copies.
- The build-hash marker in the chat UI (`<meta name="build" content=<sha>>`,
  injected by vite.config.ts) reflects the sha at BUILD time — it lags the
  latest commit until the next build; not a bug.
- After the Caddy change: `nix flake check` on the /tmp copy first; the
  tmpfiles duplicate is the usual failure.
