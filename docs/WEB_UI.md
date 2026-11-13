# Rebuilding the web UI

The web UI is a separate React build served from `web/dist`. When the deployment mounts the repo at `/app`, the browser loads the host's `web/dist`. Python-side restarts do not rebuild it. After any change to `web/src`, rebuild it or the browser will silently run stale JavaScript:

```bash
make build-web          # or: bash scripts/build-web.sh
```

The running container picks up the new `web/dist` on the next request, with no restart. The image also bakes a fresh `web/dist` at build time. That is the bundle you get when the deployment does not mount the repo.

