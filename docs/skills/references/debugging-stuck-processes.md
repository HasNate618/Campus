# Debugging "stuck" processes in the campus container

Written after the 2026-08-02 sync-hang marathon — the sync looked hung for
hours and was actually four stacked bugs (inline extraction loop, buffered
logs, expired tokens, orphaned processes). This is the toolchain that got
ground truth fast.

## 1. Get a live stack dump (the decisive move)

When a python process blocks and you can't see where, make it dump its own
stack after N seconds — no gdb, no py-spy, works in the slim container:

```sh
docker exec campus sh -c 'cd /app && timeout 75 python -c "
import faulthandler, runpy, sys
faulthandler.dump_traceback_later(55, exit=True)
sys.argv = [\"sync\", \"sync\"]
runpy.run_module(\"sync\", run_name=\"__main__\")
" > /tmp/sync-dump.log 2>&1'
# then read the "Timeout (0:00:55)!" section — it lists every frame:
grep -E 'File "/app' /tmp/sync-dump.log
```

This pinpointed `extract_pdf` → `httpcore/_backends/sync.py read` (a socket
read outliving its timeout) in one shot, after log inspection had failed for
an hour.

## 2. Empty logs ≠ hung process

`docker exec campus python -m sync sync > log 2>&1` block-buffers python's
stdout — the log stays empty while the process works fine. DB progress is
ground truth, not the log:

```sh
python3 -c "import sqlite3; c=sqlite3.connect('data/harness.db');
print(c.execute('SELECT COUNT(*) FROM files WHERE content_node_id IS NOT NULL').fetchone())"
```

Use `python -u` whenever redirecting to a file.

## 3. Process inventory without `ps` (slim image)

```sh
# find python processes by comm (NOT by grepping cmdline — see pitfall below)
docker exec campus sh -c 'for p in /proc/[0-9]*; do
  [ -f $p/comm ] && [ "$(cat $p/comm)" = "python3" ] &&
  grep -q "sync sync" $p/cmdline 2>/dev/null && echo "pid ${p#/proc/}"; done'
```

`/proc/PID/wchan` shows the kernel wait channel (`anon_pipe_read` = blocked
on a pipe). Note: with cap-drop ALL, root can't readlink another uid's
`/proc/PID/fd` — use `docker exec --user 1000:100 campus sh -c ...`.

## 4. Orphaned processes are the norm, not the exception

- `process kill` on a host-side `docker exec` wrapper kills the CLIENT, not
  the container-side process — the sync/uvicorn keeps running inside.
  Kill by container pid (find via /proc scan above).
- Same on the host: killing the bash wrapper orphans uvicorn, which keeps
  serving OLD code on the port; the replacement dies with "address already
  in use" (exit 3). Always `ss -tlnp | grep <port>` and kill the real PID,
  then confirm the port is free, before restarting.

## 5. Footguns that wasted time

- `grep "sync sync" /proc/*/cmdline` matches the SHELL'S OWN cmdline — the
  pattern is literally in your script text — so `kill -9` killed the shell
  (exit 137). Always match `comm` first, then filter cmdline.
- Token TTL is 1h; long debugging sessions expire it mid-hunt and a
  "No valid token" exit looks like a new hang. Check
  `python -m sync auth --status` before concluding anything.
- The `timeout N ... | tail` pipeline exit code is tail's, not the command's
  — use PIPESTATUS or write to a file.

## 6. Post-mortem: why the sync actually "hung"

The H1-era sync had an inline extraction loop inside the course loop:
`for row in unprocessed_files: extract_pdf(row)` with a 600s PUT timeout
against the single pdf-extractor VLM worker. Any busy worker → 10 min per
file, sync never reached digest/ntfy/finish. Fixed by spawning
`python -m sync extract` as a detached subprocess
(`subprocess.Popen(..., start_new_session=True, stdout=extraction.log)`)
after the digest. A daemon thread is NOT a fix — it dies with the CLI.
Lesson: any slow external worker must be off the sync critical path AND out
of the CLI's lifetime.
