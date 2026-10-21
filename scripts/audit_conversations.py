"""Audit recent conversations for harness problems. Run inside the app container:

    docker cp scripts/audit_conversations.py campus:/tmp/ && docker exec campus python /tmp/audit_conversations.py

Reports failure notices by kind, turns with runaway tool calls, duplicated
tool calls, empty assistant nodes, tree-integrity breaks, attachment usage and
markdown hazards. Read it as a to-do list, not a grade.
"""
import sqlite3, json, re, collections, datetime, sys

DB = "/app/data/harness.db"
c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
def ts(v):
    """created_at is an ISO string from some writers and epoch ms from others."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    try:
        return float(s)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(s.replace("Z", "")[:26], fmt).timestamp() * 1000
        except ValueError:
            continue
    return 0.0


now = datetime.datetime.now().timestamp() * 1000
WINDOW_DAYS = 21
cutoff = now - WINDOW_DAYS * 86400 * 1000


def load(v, default=None):
    if not v:
        return default
    try:
        return json.loads(v)
    except Exception:
        return default


sessions = [dict(r) for r in c.execute("SELECT * FROM chat_sessions")]
print(f"sessions total: {len(sessions)}")

# ---- node-level scan -------------------------------------------------------
nodes = []
for n in c.execute("SELECT session_id, id, parent_id, role, content, position, data_json, created_at, updated_at FROM chat_nodes"):
    d = load(n["data_json"], {}) or {}
    nodes.append({
        "sid": n["session_id"], "id": n["id"], "parent": n["parent_id"],
        "role": n["role"], "content": n["content"] or "",
        "pos": n["position"], "data": d, "created": ts(n["created_at"]),
    })
print(f"chat_nodes rows: {len(nodes)}")

recent = [n for n in nodes if (n["created"] or 0) >= cutoff]
print(f"nodes created in last {WINDOW_DAYS}d: {len(recent)}")
by_sid = collections.Counter(n["sid"] for n in recent)

sess_by_id = {s["id"]: s for s in sessions}
print()
print("=== recent sessions, largest first ===")
for sid, cnt in by_sid.most_common(12):
    s = sess_by_id.get(sid, {})
    title = (s.get("title") or "(untitled)")[:52]
    newest = max((n["created"] or 0) for n in recent if n["sid"] == sid)
    when = datetime.datetime.fromtimestamp(newest / 1000).strftime("%m-%d %H:%M")
    print(f"  {sid:>4} {cnt:>4} nodes  {when}  {title}")

# ---- problem signals in assistant output ----------------------------------
PATTERNS = {
    "cannot_see_file": r"(?:don't|do not|can't|cannot) (?:see|access|find|read) (?:the|that|any) (?:pdf|file|attachment|document|image)",
    "no_records": r"no attachment|not in my (?:records|harness)|nothing attached",
    "tool_error": r"(?:tool|file|command) (?:failed|error)|Error:|Traceback|exit code [1-9]",
    "stream_failed": r"⚠|Stream failed|input stream",
    "truncated": r"(?:response|answer) (?:was|got) (?:cut|truncated)|output limit",
    "stale_path": r"(?:no longer|does not) exist",
}
hits = collections.Counter()
examples = collections.defaultdict(list)
for n in recent:
    if n["role"] != "assistant":
        continue
    for name, pat in PATTERNS.items():
        if re.search(pat, n["content"], re.I):
            hits[name] += 1
            if len(examples[name]) < 3:
                m = re.search(pat, n["content"], re.I)
                st = max(0, m.start() - 60)
                examples[name].append(f"sid={n['sid']} ...{n['content'][st:m.end()+60].replace(chr(10),' ')}...")

print()
print("=== assistant-side problem signals (last %dd) ===" % WINDOW_DAYS)
for name in PATTERNS:
    print(f"  {name:<18} {hits[name]}")
    for e in examples[name]:
        print(f"      {e[:150]}")

# ---- turn shape: steps, tokens, tool explosion, loops --------------------
steps_hist = collections.Counter()
token_tot = 0
token_n = 0
heavy = []
tool_counter = collections.Counter()
for n in recent:
    if n["role"] != "assistant":
        continue
    d = n["data"] or {}
    steps = d.get("steps")
    nsteps = len(steps) if isinstance(steps, list) else 0
    bucket = "0" if nsteps == 0 else ("1-5" if nsteps <= 5 else "6-10" if nsteps <= 10 else "11-20" if nsteps <= 20 else "21+")
    steps_hist[bucket] += 1
    t = d.get("tokens")
    if isinstance(t, (int, float)):
        token_tot += t
        token_n += 1
    if isinstance(steps, list):
        names = [str(s.get("name") or s.get("tool") or "") for s in steps if isinstance(s, dict)]
        names = [x for x in names if x]
        for x in names:
            tool_counter[x] += 1
        dupes = [k for k, v in collections.Counter(names).items() if v >= 3]
        if nsteps >= 21 or dupes:
            heavy.append((n["sid"], n["id"], nsteps, dupes[:4],
                          max((t or 0) if isinstance(t, (int, float)) else 0, 0),
                          len(n["content"])))

if token_n:
    print()
    print(f"=== tokens recorded on {token_n} assistant nodes: mean {token_tot/token_n:.0f}, total {token_tot} ===")
print()
print("=== assistant turns by tool-call count ===")
for k in ("0", "1-5", "6-10", "11-20", "21+"):
    print(f"  {k:<6} {steps_hist[k]}")
print()
print("=== turns with 21+ steps or a tool repeated 3+ times ===")
for row in sorted(heavy, key=lambda r: -r[2])[:10]:
    sid, nid, nsteps, dupes, tok, clen = row
    print(f"  sid={sid} node={nid[:8]} steps={nsteps:>3} repeat={dupes} chars={clen}")
print()
print("=== tool call frequency ===")
for name, cnt in tool_counter.most_common(12):
    print(f"  {name:<28} {cnt}")

# ---- user-side frustration ------------------------------------------------
FRU = r"\b(still|again|not working|why (?:is|does|did)|wtf|broken|wrong|it says|keeps|every time)\b"
frus = [(n["sid"], n["content"][:160].replace("\n", " ")) for n in recent
        if n["role"] == "user" and re.search(FRU, n["content"], re.I)]
print()
print(f"=== user messages suggesting trouble: {len(frus)} ===")
for sid, txt in frus[:8]:
    print(f"  sid={sid}: {txt[:130]}")

# ---- tree integrity -------------------------------------------------------
ids_by_sid = collections.defaultdict(set)
for n in nodes:
    ids_by_sid[n["sid"]].add(n["id"])
orphans = [n for n in recent if n["parent"] and n["parent"] not in ids_by_sid[n["sid"]]]
print()
print(f"=== tree integrity: orphaned nodes (parent id missing) = {len(orphans)} ===")
for n in orphans[:5]:
    print(f"  sid={n['sid']} node={n['id'][:8]} parent={n['parent'][:8]} role={n['role']}")

# ---- empty / no-answer turns ---------------------------------------------
empty = [n for n in recent if n["role"] == "assistant" and len(n["content"].strip()) < 12]
print(f"=== assistant nodes with essentially no content: {len(empty)} ===")
for n in empty[:6]:
    print(f"  sid={n['sid']} node={n['id'][:8]} len={len(n['content'])} repr={n['content'][:60]!r}")

# ---- attachments ----------------------------------------------------------
att = [n for n in recent if n["role"] == "user" and (n["data"] or {}).get("attachments")]
print()
print(f"=== recent user turns carrying attachments: {len(att)} ===")
for n in att[:8]:
    names = [a.get("name") or a.get("original_name") for a in n["data"]["attachments"] if isinstance(a, dict)]
    print(f"  sid={n['sid']} {names}")

# ---- markdown hazards -----------------------------------------------------
fence = sum(1 for n in recent if n["role"] == "assistant" and n["content"].count("```") % 2)
mermaid = sum(1 for n in recent if n["role"] == "assistant" and "```mermaid" in n["content"])
dot = sum(1 for n in recent if n["role"] == "assistant" and "```dot" in n["content"])
imgs = sum(1 for n in recent if n["role"] == "assistant" and "![" in n["content"])
print()
print("=== markdown hazards in assistant output ===")
print(f"  unbalanced code fences : {fence}")
print(f"  mermaid blocks         : {mermaid}")
print(f"  graphviz blocks        : {dot}")
print(f"  messages with images   : {imgs}")
