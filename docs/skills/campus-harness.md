# Campus — Agent Harness (the product)

The AI agent harness in `agent/` is **the product** per Nate (corrected
2026-08-01: "what happened to the model harness and structuring the models
context properly, giving it proper tools and actions? thats much more
important than the web app"). The web app is a thin shell over the same loop.

Consolidates the harness/design-rule/pitfall content from the `campus` and
`campus-school-harness` skills; verbatim originals in [archive/](archive/).

## Architecture (agent/ Python package)

- `context.py` — system prompt builder from live state: America/Toronto
  time, active terms, course scope, next-7-days events (incl. classes
  computed from course_sessions when `term_dates` set in config), and the
  per-course memory card.
- `tools.py` — tool registry via a `_tool()` builder: `harness_*` DB reads,
  `content_*` file reads (offset/limit pagination + .md-sibling fallback +
  ripgrep with snippets), `mutate_*` audited writes, `file_write` audited,
  `web_search`/`web_read` via trawl MCP, `terminal_run` (Phase 2).
- `mcp.py` — minimal MCP streamable-HTTP client (trawl).
- `memory.py` — per-course memory-card generator (bounded ~24 bullets,
  DEADLINES from structured rows only — structured beats facts — atomic
  write, .prev kept).
- `chat.py` — tool-calling loop: NUDGE_AT=22, MAX_ITERATIONS=24; tool
  results capped 6000 chars; stateless REPL. Streaming (token emit) with
  reasoning_content passback for thinking mode.

## Division of labor (explain it like this)

- **Sync is dumb** — fetch/diff/download/store, deterministic, never
  hallucinates.
- **AI digest** (end of sync) — reads the delta → markdown sync log + durable
  facts into `memory_facts` (source+confidence). Delta carries announcement
  BODIES (800 chars) + extracted-PDF excerpts (`digest_pdf_excerpt_chars`,
  default 2000) so the model reads content, not just paths.
- **AI agent** (built) — context + tools + loop over the synced data: query
  DB, read/grep files, audited updates ("assignment extended 2 days").

## Key design rules (from HANDOFF, non-negotiable)

- No auto-scrape of Brightspace — sync is manual/on-demand (Duo).
- Chat never calls Brightspace live — only SQLite + disk.
- AI mutations go through audited paths (`audit_log`, before/after JSON).
- Secrets never in git (config.yaml gitignored); course content never in git.
- `memory_facts` supersede (is_active=0), never delete.
- **Memory card** per course (`{course}/memory-card.md`, ~2-3KB, injected
  into system prompt): REGENERATED on diff (sync deltas/facts
  changed/lecture digest), never hand-edited. Structured rows BEAT facts
  (DEADLINES section from assignments/exams only). Supersede pass:
  time-sensitive categories (scheduling/exam/assignment/logistics/prof-note)
  expire after 30 days; ALL facts from ended-term courses are history (term
  windows: YYYYF = Sep–Dec YYYY, YYYYW = Jan–Apr YYYY+1).
- **Digest TIME RULES:** resolve relative dates ("tomorrow"/"next week") to
  absolute; convert ephemeral instructions to dated facts; skip
  passed-window facts. Without this, memory fills with time-bombs.
- **Notes = files, not DB:** prose lives in `{course}/notes/*.md`;
  `file_write` tool is audited (head-sha before/after). `content/` is
  read-only.
- **Extraction:** pdf-extractor CLOUD default → **REVERSED to local
  (2026-08-03)** — see campus-operations.md (PDF engine section).
  `auto_extract_pdfs: true`, `digest_pdf_excerpt_chars: 2000` — digest sees
  PDF excerpts, not full text (deep reads via paginated content_read_file at
  chat time).
- **Class events** are COMPUTED from course_sessions (config `term_dates`,
  e.g. {2026F: "2026-09-01"}) — never materialized rows.
- **Auth:** manual (Duo push), token `~/.campus/token.json` 1h TTL,
  plaintext chmod 600. Container does auth too (playwright baked with
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` so uid 1000 can read it).
- **Service URLs:** host ports (127.0.0.1:18081 etc.) on host; docker
  hostnames (bifrost:8080/v1, trawl:8000/mcp, pdf-extractor:8000, ntfy:80)
  via HIPPO_* env in the container.

## Tool-surface bugs found by the harness AI's own 21-call audit (2026-08-04)

- `due_within_days` had no lower bound (returned every dated assignment
  ever — needs `>= datetime('now')` AND `<= now+N`).
- Fuzzy title matching on mutate is a hazard with duplicate dropbox titles
  (id-required now).
- Unknown course should raise, not silently return `[]`.
- Long raw-JSON payloads get truncated by the context window — return
  compact structured text instead (rubric_detail builds
  criteria/levels/points lines).
- A unified `state` field (open/closed/overdue/submitted/graded) resolves
  the status-vs-closed conflict.
- `harness_sync_delta` answers "what changed since last sync" (recent sync
  stats + latest digest log).

### Re-test round (2026-08-04) — proving filter tools + the stale-claim trap

- To PROVE a SQL-filtered tool's positive case when live data has no
  in-range fixture, insert a synthetic row inside a transaction and roll it
  back (INSERT → run the tool → assert found/excluded → DELETE). Settled
  `due_within_days` both directions with zero pollution.
- A consumer's "still broken" claim can be STALE — the harness AI's
  byte-scan complaint about .doc contracts was written before the antiword
  round landed; re-run the exact probe before believing it.
- Fixed this round: announcement bodies HTML-stripped in
  `harness_get_announcements` (richest corpus source; arrived as raw
  `<p>`/`&#160;`/`\r\n`); beyond-EOF paging says "offset 9000 is past the
  end — file has 2 lines" instead of "lines 9000-9000 of 2".

## Memory-card mechanics (verified 2026-08-04) — how fresh is the AI's memory?

- The card is read FRESH on EVERY turn (context.py reads
  `{course}/memory-card.md`, capped at 3000 chars, at context-build time —
  not once per session), so a sync that regenerates the card is visible on
  the very next message.
- The card only regenerates when the sync found deltas ("nothing new" syncs
  leave it untouched — correct, not a bug).
- Standing blind spots: (1) the digest's announcement window is 14 days, so
  OLD but important announcements (extensions, bonus rules, grace periods)
  never become facts — queryable via `harness_get_announcements(days=365)`
  but absent from standing memory (widening the window is a design choice).
  (2) The per-turn "upcoming events (next 7 days)" block reads assignments'
  due_at, exams, AND the events table — so "what's due this week" works from
  assignment data alone with NO term_dates. It only says "(none)" because
  the pilot's due dates are all past and events is empty; class/lab
  meetings still need `term_dates`. The AI has assignment deadline
  awareness, but not class-meeting awareness.
- With 1–2 syncs/day the pipeline is responsive; the remaining gap is the
  calendar.

## Announcement backlog backfill (b35c25f, 2026-08-04) — one-time digest pattern

Announcements carry a `digested_at` marker: new ones are marked at sync time
(they ride the delta digest), and every digest run ALSO ingests undigested
historical announcements (config `digest_announcement_days`, default 365,
max 25, HTML-stripped) so extensions/policies/bonus rules land in
memory_facts exactly once, then get marked — self-limiting, no duplicate
facts. **This is the reusable "digested_at one-time backfill" pattern: mark
each source row consumed after a successful pass so the backfill runs once
and stays quiet.** Verified: a "nothing new" sync consumed all 24 backlog
announcements and the digest stored ZERO facts (model judged every relevance
window passed for the finished pilot — its reasoning is in the sync log;
correct behavior, not a bug). The digest RUNS even with no deltas when an
undigested backlog exists. Note the 90-day default initially excluded the
pilot's Jan–Apr announcements — for finished terms the window must reach the
whole course.

## .doc attachments: antiword

Container image has antiword; sync/extract.py `_extract_doc` writes a `.md`
sibling that content_read_file auto-falls-back to (no more hand-rolled
byte-scans). After adding a new extractor, already-skipped rows need
`UPDATE files SET processed=0` to re-queue — the queue only visits
processed=0 rows. **`processed=1` means "attempted", not "text exists"** —
document that to the model.

## Harness pitfalls (hard-won)

- **DeepSeek thinking mode**: every follow-up call needs the assistant's
  `reasoning_content` passed back (400 otherwise: "The reasoning_content in
  the thinking mode must be passed back to the API"); rebuilt streamed
  messages need `"role"` too. The provider check is STATEFUL and
  intermittently 400s a perfectly-formed request — `run_turn` retries
  `_model_call` up to FOUR attempts (3 retries, 1s/2s/3s backoff — 51cabc6,
  Nate asked for "retry 3 times before giving up", log each retry, re-raise
  on the 4th); a transient upstream failure must never kill a whole turn.
  Attribution recipe: rebuild the EXACT second call from
  chat_sessions.nodes_json and send it straight to bifrost — it 400s on one
  attempt and PASSES on an identical re-send (provider-side cache state).
- **SSE is CRLF from sse-starlette** — split on `/\r?\n\r?\n/`, never
  `'\n\n'`, split lines on `/\r?\n/`, JOIN multiple `data:` lines with `\n`
  per the SSE spec. Verify raw bytes with `curl -N` once before debugging
  anything else in a no-stream UI.
- **asyncio.Queue is NOT thread-safe** — the emit-from-worker-thread burst
  (9463595): run_turn in a worker thread calling queue.put_nowait per event
  piles up corrupted events and flushes the WHOLE response at the end.
  Fix: `loop = asyncio.get_running_loop()` in the endpoint and emit via
  `loop.call_soon_threadsafe(queue.put_nowait, item)` (also for the
  terminating None). **The streaming-killer check order: parser
  frame-splitting → runner exception → queue thread-safety → reverse-proxy
  buffering.**
- **SSE chat streams hang forever if the runner task dies** — the
  sse-starlette pattern only closes the stream when the runner puts None.
  If the blocking run_turn raises, the to_thread raises, the runner never
  puts None, and the UI shows "sending…" forever (backend logged 200).
  Wrap the turn in try/except: emit an `error` event, THEN close the queue.
- **Caddy buffers SSE — `flush_interval -1` is required** on the
  school.home.lab route (proxy.nix) or Caddy holds the entire SSE body and
  flushes at the end. RULE: when a stream is dead, test the SAME URL the
  user uses (through the proxy), not just the origin port.
- **Caddy cold-start burst** — one SSE run right after a caddy restart may
  deliver ALL events in a single burst; a single burst measurement
  immediately after a proxy restart is a COLD-START ARTIFACT, not a config
  regression — re-run the timing test before touching config or frontend.
- **Model burst delivery — SUPERSEDED (156219d):** the "all at once" answer
  was the HARNESS's httpx buffering, not the model. A typewriter reveal
  (ed23cf4) built on the misdiagnosis was REMOVED (7d6e893) after Nate
  rejected it ("isn't this worse?" → "remove it"): a synthetic reveal masks
  the symptom instead of finding the buffer. RULE: probe the PROVIDER
  directly (urllib streaming, per-delta timestamps) to attribute a burst —
  browser→API measurements include the harness. See references/chat-v2.md →
  "Post-launch debug round 3/4" + scripts/stream_probe.py.
- **VERIFY STREAMING CORRECTLY:** pipe `curl -N` LIVE into a timestamping
  script (timestamps at read time, not after), and use a LONG prompt (3–4
  paragraphs) — a 5-word answer streams its 6 tokens in milliseconds and
  looks like a burst no matter what.
- **Fact staleness — created_at is NOT content date.** The backfill digest
  extracted facts from JANUARY announcements, so their created_at was
  "yesterday" — a TTL on created_at superseded nothing. Correct rule is
  TERM-based expiry (Western windows: 2026F = Sep 1–Dec 31; 2027W = Jan
  1–Apr 30 of year+1); time-sensitive categories additionally expire after
  30 days; timeless ones (grading, course-policy, general) survive term-end
  only. `supersede_stale_facts()` runs before every card regen.
- **Relative dates are time-bombs in memory** — "install Unity before
  tomorrow's class" extracted VERBATIM; "tomorrow" is false the next day.
  Digest prompt TIME RULES (above). Card also filters: past-term courses
  show NO facts; DEADLINES section only shows due_at >= now; card STATE
  reads last COMPLETED sync (status in ok/partial), not the newest row (a
  stale 'running' row reads as current).
- **The consumer said data is missing? Check the READ PATH before the data
  (2026-08-04).** The full rubric criteria lived in `assignments.rubrics_json`
  all along — the tool only surfaced names, so both the harness AI and its
  operator declared them absent; only a mutation echo leaked them. Same
  pattern with memory_facts: 23 rows existed but `is_active=0` → "empty
  store". When any consumer reports missing data, diff what the tool returns
  vs what the DB holds before concluding a data gap.
- **deepseek-v4-flash over-surveys open-ended questions** — "Explain a
  concept" cost 17 tool calls (incl. terminal_run abuse). Fixes that worked:
  (a) `course_map` tool — modules→topics→files (kind + extraction status) in
  ONE call; (b) prompt rules 9–11: course_map first, terminal_run ONLY for
  user-requested file ops (NEVER content — its description was rewritten to
  say so), "be decisive: course_map + at most 2-3 reads, 5+ calls is too
  many". Result: 17 → 9 calls, no terminal abuse. Below that, the ceiling is
  the MODEL's tool planning — the next lever is a stronger chat model
  (bifrost_model in config.yaml) or accepting the count.
- **grep must return SNIPPETS** — paths alone make the model grep forever;
  read_file needs the .md-sibling fallback; the "answer now" nudge at
  NUDGE_AT=22 matters.
- **D2L dropbox metadata map** (what the folders actually carry + the
  whoami-str-vs-int pitfall + instructor-only ceilings):
  references/d2l-dropbox-metadata.md.
- **terminal_run tool (Phase 2):** blocklist patterns (sudo/su/docker/
  podman/nixos-rebuild/systemctl/journalctl/shutdown/reboot/mkfs/dd/chmod/
  chown/kill, `rm -rf /`, `\.campus` token paths, `config\.yaml`,
  `python -m sync auth`), write-class ops (rm/mv/cp/touch/tee/truncate/sed/
  echo) denied against `/content/`, workdir bounded under data_root, timeout
  30s/120s, output cap 10KB, EVERY call audited (audit_log,
  entity=terminal, action=run/blocked/timeout). The container is the real
  security boundary; blocklist+audit are accident prevention + visibility.

## Harness validation history

- Agent harness validated live (2026-08-01): grounded assignment answers
  with stale-data honesty, outline grading Q answered from extracted PDF
  with line cites, audited note+fact mutation verified in audit_log.
- Loop fixes that mattered: grep snippets, read_file .md-sibling fallback,
  the "answer now" nudge at NUDGE_AT.
