#!/usr/bin/env python3
"""Streaming probe for the Campus chat — run INSIDE the campus container.

Why: the Hermes browser tool cannot navigate tailnet/private addresses
(school.home.lab), but the campus image ships playwright + chromium for Duo
auth. This drives the REAL app and answers the two questions that code
reading can't:

  mode=dom    (default) — sample the last assistant message's rendered
              char count every ~300ms while an answer generates. Progressive
              growth = rendering works; one jump 0 -> full = a burst (see
              the typewriter-reveal round, ed23cf4).
  mode=chunks — raw fetch('/api/chat') with res.body.getReader(),
              recording [t_ms, bytes] per read. Isolates TRANSPORT
              buffering (Caddy/proxy: many small chunks) from MODEL burst
              delivery (reasoning chunks, then ONE big final chunk = the
              whole answer — prompt-cache effect, not a bug).

Usage:
  docker cp scripts/stream_probe.py campus:/tmp/
  docker exec campus python /tmp/stream_probe.py [dom|chunks]

Gotchas baked in:
- wait_until='networkidle' NEVER settles on this app (SSE/keep-alive) —
  use 'domcontentloaded' + a fixed sleep.
- The main chat textarea has NO className — locate '.chat-input textarea'.
  ('textarea.chat-input-area' is the edit-inline one, absent until edit.)
- Fresh browser profile = no localStorage → the /chat tab auto-picks
  courses[0]. Fine for probing.
- Click button[title="New chat"] so the send goes to a CLEAN session
  (reopening the last session shows a previous answer immediately and
  contaminates the DOM timeline).
- Console + pageerror listeners prove JS exceptions aren't the cause.
- Probe sessions pollute chat_sessions — clean up afterwards:
  docker exec campus python -c "import sqlite3; c=sqlite3.connect(
  'data/harness.db'); [c.execute('DELETE FROM chat_sessions WHERE id=?',
  (r[0],)) for r in c.execute(\"SELECT id FROM chat_sessions WHERE
  nodes_json LIKE '%<prompt marker>%'\").fetchall()]; c.commit()"
"""

import asyncio
import sys

import playwright
from playwright.async_api import async_playwright

PROMPT = ("Explain TCP slow start in 200 words with an analogy. "
          "Keep it flowing like a short essay.")
MARKER = "stream-probe"  # put in the branch so DB cleanup can find it

DOM_JS = """() => {
  const md = [...document.querySelectorAll('.msg-assistant .md')];
  const last = md[md.length - 1];
  const bar = document.querySelector('.context-bar');
  const cur = document.querySelector('.stream-cursor');
  return {
    chars: last ? last.textContent.length : 0,
    status: bar ? bar.textContent.trim().slice(0, 90) : '',
    cursor: !!cur,
  };
}"""

CHUNKS_JS = """async () => {
  const t0 = Date.now();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ message: %(prompt)r, course_id: 1, history: [],
                           branch: %(marker)r }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const s = dec.decode(value, { stream: true });
    total += s.length;
    chunks.push([Date.now() - t0, s.length]);
  }
  window.__chunks = chunks;
  window.__total = total;
  return 'ok';
}""" % {"prompt": PROMPT, "marker": MARKER}


async def probe_dom(pg):
    await pg.goto('http://school.home.lab/chat', wait_until='domcontentloaded', timeout=30000)
    await pg.wait_for_timeout(5000)
    await pg.locator('button[title="New chat"]').click()
    await pg.wait_for_timeout(800)
    ta = pg.locator('.chat-input textarea')
    await ta.fill(PROMPT)
    await pg.keyboard.press('Enter')
    t0 = asyncio.get_event_loop().time()
    prev = 0
    rows = []
    while asyncio.get_event_loop().time() - t0 < 45:
        await pg.wait_for_timeout(300)
        info = await pg.evaluate(DOM_JS)
        if info['chars'] != prev or info['cursor'] or info['status']:
            rows.append((round(asyncio.get_event_loop().time() - t0, 1), info))
            prev = info['chars']
    print('=== DOM timeline (t, chars, cursor, status) ===', flush=True)
    for t, info in rows:
        print(t, '|', info.get('chars', 'ERR'), '|',
              'C' if info.get('cursor') else ' ', '|', info.get('status', ''), flush=True)
    print('rows:', len(rows), '— climbing rows = progressive render; a single full-text row = burst', flush=True)


async def probe_chunks(pg):
    await pg.goto('http://school.home.lab/chat', wait_until='domcontentloaded', timeout=30000)
    await pg.wait_for_timeout(3000)
    r = await pg.evaluate(CHUNKS_JS)
    chunks = await pg.evaluate('window.__chunks')
    total = await pg.evaluate('window.__total')
    print('evaluate:', r, flush=True)
    print('total bytes:', total, '| chunks:', len(chunks), flush=True)
    for c in chunks:
        print(f'  t={c[0]}ms bytes={c[1]}', flush=True)
    if len(chunks) > 3:
        times = [c[0] for c in chunks]
        last = chunks[-1]
        print(f'spread: first {times[0]}ms → last {times[-1]}ms', flush=True)
        if last[1] > 5000 and len(chunks) > 1:
            print('FINAL CHUNK IS HUGE → model burst delivery (prompt cache), '
                  'NOT transport buffering — the UI needs the typewriter reveal.', flush=True)


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'dom'
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=['--no-sandbox'])
        page = await browser.new_page()
        console = []
        page.on('console', lambda m: console.append(f'{m.type}: {m.text[:160]}'))
        page.on('pageerror', lambda e: console.append(f'PAGEERROR: {e}'))
        if mode == 'chunks':
            await probe_chunks(page)
        else:
            await probe_dom(page)
        print('=== console (last 15) ===', flush=True)
        for c in console[-15:]:
            print(c, flush=True)
        await browser.close()


asyncio.run(main())
