# Chat memory for campus — should conversation history be stored for AI recall?

**Date:** 2026-08-05 · **Author:** research pass (grounded in live web research — see Sources)
**Audience:** Nate (Western SE student), for deciding whether/how campus should index chats.
**Decision needed:** one feature (or none) — no multi-item roadmap.

> Philosophy reminder this report is judged against: *I own my technology* — self-hosted,
> zero ongoing management burden, deterministic, minimal UI. No synthetic/flashy UX, no
> feature sprawl. **One feature at a time.**

**TL;DR.** Yes, but not the way it's sketched. The industry consensus (ChatGPT, Claude,
Zep, MemGPT) is *curate, then retrieve*: conversations become **durable facts** or
**summaries**, never raw transcripts mixed into a knowledge base. Campus already has the
curation machinery (digest → `memory_facts` → memory card → search corpus). The cheap,
high-value move is **option B: a conversation digest that harvests durable facts from
chats into the existing facts pipeline**. Raw-turn indexing (option A) and full-history
capture (Rewind/Recall-style) are the traps to avoid.

---

## 1. How comparable tools handle conversation memory

### ChatGPT — two layers, and a public post-mortem on what fails

ChatGPT memory has evolved in three acts, and the arc is the lesson:

1. **Saved memories (Feb 2024)** — explicit "remember X" plus auto-picked-up details,
   stored as a separate "notepad" *from* chat history, injected into every response.
   OpenAI's own later write-ups call out the failure modes: saved memories "tend to go
   stale over time and eventually become incorrect or irrelevant", they relied on strong
   cues ("felt like talking to someone who took a few notes, but forgot everything that
   wasn't written down"), and they could contradict each other ("I'm training for a
   marathon" vs "I sprained my ankle"). Also: **deleting a chat doesn't erase its
   memories** — memories are decoupled from their source conversations.
2. **Chat-history referencing (Apr 2025)** — ChatGPT started referencing *all past
   conversations* for personalization, on top of saved memories. "Memory" became a
   synthesis, not a list. A memory summary (curated, editable) + per-response "sources"
   (which past chat/memory shaped this answer) gave users inspection and correction.
3. **"Dreaming" (Jun 2026)** — a background process that periodically *synthesizes*
   memory state from many conversations, explicitly to fix staleness, correctness, and
   scale. Their example: memory auto-revises "You're going to Singapore in July" →
   "You went to Singapore in July" as time passes. This is a **conversation digest**: a
   periodic LLM pass over chat history that updates a bounded curated memory.

What ChatGPT stores: explicit memories (curated list) + a synthesized summary derived
from chat history. What it *doesn't* do: it never retrieves raw past transcripts to
answer a question — history is distilled first. Weaknesses along the way: staleness,
contradictions, memory surviving chat deletion, and opaque auto-picked-up memories.

### Claude / Claude Code — a file-based memory card, load-on-demand detail

Claude Code's memory docs describe exactly the pattern campus already uses:

- **CLAUDE.md files** — user-written, loaded at the start of every session, treated as
  context. Guidance: keep under ~200 lines; "longer files consume more context and
  reduce adherence"; periodically "remove outdated or conflicting instructions"
  (conflicts → "Claude may pick one arbitrarily").
- **Auto memory** — Claude *writes its own notes* during work (build commands,
  debugging insights, **corrections and preferences**): a `MEMORY.md` index (first 200
  lines / 25KB loaded each session) + topic files read **on demand** with the file
  tools. "Claude doesn't save something every session. It decides what's worth
  remembering based on whether the information would be useful in a future
  conversation." It explicitly exists to capture *corrections* — the thing raw chat
  history loses.

The campus mapping is almost 1:1: memory-card.md = CLAUDE.md; memory_facts = auto
memory topic files; search_corpus = on-demand file reads. The lesson: **bounded injected
context + retrieval on demand, never raw history in the prompt.**

### Mem — capture-everything, but everything becomes a *note*

Mem's model: capture anything (voice, chat, email, links), the AI organizes it into
notes, and all retrieval (Mem Chat, Deep Search, "Heads Up" related-note surfacing) runs
over **notes, not raw transcripts**. Chat with Mem produces notes; notes are the memory.
Notable for campus's philosophy: Mem is the anti-pattern on ownership — cloud SaaS,
**Google-login only**, no self-host, no public roadmap. It's also a *habit* product: it
only works if you dump everything into it, which is exactly the ongoing-management
burden campus rejects.

### Rewind / Limitless — raw full-history capture, and why it failed

Rewind recorded everything locally (screen + audio, encrypted on-device DB) and offered
search over your own history. The post-mortems are damning for the *raw capture* model:

- **Operational cost**: ~11 GB/month of storage; users quit because it "turned their
  MacBooks into a toaster" / destroyed battery; OCR is compute-heavy.
- **Weak value**: "Ask Rewind" answers "always walked the line of the accuracy needed
  for reliable use", with no visibility into how data was marshaled into answers.
- **Vendor fragility**: Rewind pivoted to Limitless (cloud, meetings, a pendant) in
  2024 — the local capture product was de-prioritized — and by 2025-26 Limitless was
  **acquired by Meta**, Rewind was sunset, several regions' data was deleted outright.
  A perfect demonstration that "record everything" products don't survive contact with
  the market, and your recall dies with them.

### Microsoft Recall — same category, same verdict

Recall (screenshots every few seconds + searchable history) was labelled a potential
"privacy nightmare", drew ICO enquiries, got delayed, relaunched opt-in with encrypted
snapshots + biometric gate + credit-card filtering. Even at Microsoft scale, continuous
full-history capture is operationally and privacy-expensive. The *useful* subset of
"things you looked at" that Recall recovers is mostly stuff that isn't already in a
text corpus — campus's corpus already has the course content, so the Recall-style
marginal value here is near zero.

### NotebookLM — chats are NOT indexed; sources are

NotebookLM is the reference study tool, and its architecture is telling: **your chat
with the assistant is a query interface, not a memory**. Everything you want remembered
must be a *source* or a *note* you add. Chats don't accumulate into the notebook; the
2M-token context window stuffs sources, answers cite them. The campus equivalent
already exists: search_corpus over extracted content = "chat with your sources".
NotebookLM's gap (no persistent memory of what *you* discussed) is exactly the gap
campus is weighing — and Google's answer is "save it as a note", i.e. **curate into the
corpus, don't index the chat**.

### RAG over chat history — the research pattern (MemGPT, Zep)

- **MemGPT / Letta (arXiv 2310.08560, "LLMs as Operating Systems")**: virtual context
  management — a memory *hierarchy* with data movement between a fast tier (always in
  context) and a slow tier (retrieved on demand), evaluated on multi-session chat where
  agents must "remember, reflect, and evolve". The paper's own design: the agent
  **self-edits its memory notes** (summarization/reflection), not raw transcript
  retrieval.
- **Zep (getzep.com)**: a **temporal knowledge graph over chat history** — facts are
  extracted from episodes, each fact traces back to the source message (provenance),
  and **when new information contradicts an old fact, Zep invalidates the old fact but
  keeps it as history** ("ask what's true now, or what was true on any past date"). The
  canonical example: "Robbie only wears Adidas" → return form says he's furious and
  switching to Nike → old fact invalidated, new fact active. That is *exactly*
  campus's `memory_facts.is_active` supersede rule. Zep's headline numbers also matter:
  **~90-95% accuracy on long-conversation benchmarks (LoCoMo, LongMemEval) with a
  retrieved context of only ~4-6K tokens** — evidence that a small curated retrieved
  slice beats stuffing raw history.

### Summary table

| Tool | What it stores | How it surfaces | Known weaknesses |
|---|---|---|---|
| ChatGPT | Saved memories (curated list) + synthesized memory summary from chat history | Injected into every response; memory summary page; per-response "sources" | Staleness, contradictions, memories outlive deleted chats, opaque auto-pickup |
| Claude Code | CLAUDE.md (user) + auto-memory notes (MEMORY.md index ≤200 lines + topic files) | Index injected each session; topic files read on demand | Context-token cost of big files; conflicting instructions picked arbitrarily |
| Mem | Everything captured → organized notes | Chat/Deep Search over notes | SaaS, Google-only, habit-dependent |
| Rewind / Limitless | Raw screen+audio history (then cloud transcripts) | Search over your history | ~11GB/mo, battery/CPU, inaccurate answers, pivoted → Meta → sunset |
| Microsoft Recall | Periodic screenshots, searchable | Timeline search UI | "Privacy nightmare", ICO scrutiny, opt-in + encryption needed |
| NotebookLM | Sources only; chats not indexed | Source-grounded answers w/ citations | No memory of your own discussions (by design) |
| MemGPT/Letta | Memory hierarchy; agent-edited memory notes | Fast tier in context, slow tier paged in | Complexity; reflection latency |
| Zep | Temporal knowledge graph: facts + provenance + invalidation from chat episodes | Token-efficient context retrieval per query | Enterprise-scale machinery; graph ops |

---

## 2. What would conversation recall ADD to campus?

**What campus already has (the Claude Code mapping):**

| Campus | Equivalent | Covers |
|---|---|---|
| memory-card.md (≤3000 chars, injected every turn) | CLAUDE.md | Deadlines, exams, policies, prof notes, logistics, recent notes, state |
| `memory_facts` (active rows, supersede via `is_active`) | auto-memory topic files | Durable facts from sync deltas + announcements |
| sync digest (`digest_and_log`) | ChatGPT "dreaming" | Background synthesis of *Brightspace* changes → facts |
| search_corpus (`chunks` + Cohere rerank) | on-demand topic file reads | Content questions, notes, assignment specs, active facts |
| per-session chat UI history | (the chat itself) | Within-session continuity, manual review |

**The actual gaps (what's lost today):**

1. **User-stated information.** Things Nate tells the assistant that are *not* in
   Brightspace: "prof said the final is cumulative", "I'm doing the project with Sam",
   "explain things with examples first", "I decided to drop the OS elective". Today
   this dies with the session — the next session's model answers "I don't have that
   info" even though the user *did* tell it. This is ChatGPT memory's core use case
   (preferences, constraints, decisions) and Claude auto memory's core use case
   (**corrections** — "no, it's Thursday" — which raw history fails to consolidate).
2. **Corrections.** The user corrects the assistant; the correction isn't remembered;
   the model repeats the mistake next session.
3. **Discussion-level recall.** "How did we break down assignment 2 last week?", "what
   was I stuck on in chapter 4?" — only reachable by manually scrolling per-session UI
   history, and only if the session is remembered by name.

**When the memory card already covers it:** any durable fact that arrives via
sync/announcements — deadlines, policies, extensions. That's the bulk of *course*
knowledge, and it's already handled.

**When chat recall matters:** user-originated facts, corrections, and cross-session
discussion threads. The first two are the high-value, low-token subset; the third is
nice-to-have. Note that much of what a chat *discusses* is course content that's
**already in the corpus** — assistant answers regurgitate indexed content — so indexing
raw turns adds mostly duplication, not new knowledge.

**Storage note:** conversations already live in SQLite — `chat_sessions.nodes_json`
(the UI's message tree, fork-aware) **and** a flat `chat_messages` table (session_id,
role, content, created_at) written per turn by the API handler. So "storing
conversation history" needs *no new storage* — only a read path. (Task context said
there is no `chat_messages` table; it exists in schema.sql and is populated by
`_do_turn` — it's the easy digest hook. The tree in `nodes_json` is the fork-faithful
source if forks matter.)

---

## 3. Design options, honestly assessed

### (a) Index raw chat turns into the existing chunks corpus — *the sketched ~15-line approach*

Walk `chat_messages` (or the nodes tree), join user+assistant turns per session, add
them as corpus items in `sync/search.py:_corpus()`, let the existing incremental
rebuild embed them.

- **What it adds:** semantic search over "what we discussed" — the discussion-level gap
  above.
- **Failure modes:**
  - **Duplication:** most chat tokens are assistant answers restating indexed course
    content. The corpus grows with near-duplicates, diluting retrieval quality.
  - **Error smuggling:** the assistant is sometimes wrong; indexing its answers puts
    model errors on par with course content in citation results — dangerous in a
    system whose rule #1 is "never invent facts".
  - **Staleness + contradictions:** a chat from week 2 saying "the exam covers ch 1-4"
    and a chat from week 6 saying "covers ch 1-8" both get retrieved; there's no
    invalidation layer (the facts table has one; raw chunks don't).
  - **Forks:** `nodes_json` trees have branches; a linear walk indexes dead branches.
  - **Noise:** hedges, "hmm", aborted thoughts — untuned signal per token.
- **Effort:** small (~15-30 lines + rebuild). **Fit:** worst quality-per-token of all
  options; cheap to build, expensive to trust.

### (b) Conversation digest → `memory_facts` — *reuse the existing digest machinery*

Extend the sync digest (or add a sibling pass) to scan the last N days of
`chat_messages` per course and extract **durable facts** — user decisions,
preferences, corrections, class insights the user reported, anything with a future
relevance window — reusing the exact JSON contract, category whitelist, `source`
tag (e.g. `chat:2026-08-05`), TTL, and supersede rules already in
`digest_and_log` / `agent/memory.py`. Facts flow into the memory card (category-gated,
as today) *and* into the search corpus (active facts are already indexed).

- **What it adds:** the AI remembers what the user told it (gap #1), corrections (gap
  #2), and anything durable that surfaces in discussion — the ChatGPT "dreaming" /
  Claude auto-memory pattern. Zero new tables, zero new services, zero new UI.
- **Failure modes:**
  - **Fact pollution** if the prompt isn't strict ("extract trivia like 'user asked
    about X'"). Mitigation: same TIME RULES + durability gate as the sync digest
    (skip ephemeral; resolve relative dates; skip passed windows); it's a prompt,
    not infrastructure.
  - **Duplicate facts** with sync-sourced ones (same fact from an announcement *and*
    from chat). Mitigation: skip if an active identical fact exists for the course
    (exact-match on text, per course).
  - **Card crowding:** the card is 3000 chars / 24 bullets. Mitigation: existing
    category gate + 30-day TTL for time-sensitive facts already keep the card
    bounded; overflow facts are still searchable (facts feed the corpus).
  - **Latency:** facts appear at next sync, not same-instant. Fine for "last week"
    recall; not for same-session (which the session history already handles).
  - **Discussion-level recall NOT covered** — a digest stores facts, not threads.
- **Effort:** small (~60-120 lines: scan + prompt + insert + wire into the sync run
  and card regen). **Fit:** excellent — reuses audited write paths, deterministic
  cadence, zero ongoing management; it *is* the pattern ChatGPT/Claude/Zep converged on.

### (c) Per-session summaries stored + surfaced in the search corpus

After a session ends (or when `updated_at` changes), write one summary item per
session (title, topic, decisions, open questions) and index it into `chunks` with a
labeled ref like `chats/<session_id>`, regenerating when the session's content hash
changes (the incremental rebuild handles it).

- **What it adds:** discussion-level recall (gap #3) — "what did we discuss about the
  ER diagram" returns the session summary with citations. Curated (no raw noise),
  bounded (one item per session), honest refs.
- **Failure modes:** summarization is lossy; a summary written once goes stale as the
  session grows (mitigate by regenerating on hash change); one more LLM pass per
  session (small); a *distilled* item still can't cite the exact turn — you'd link to
  the session, and the user scrolls.
- **Effort:** small-medium (~80-150 lines). **Fit:** good, but it's a second feature;
  per the one-feature-at-a-time rule it belongs *after* (b).

### (d) Do nothing — the memory card suffices

- **What it preserves:** today's bounded, deterministic design; zero risk.
- **What it costs:** gap #1 stays open — the recurring "I already told you this" —
  which is the single most common complaint ChatGPT memory was built to fix, and which
  campus's *own* digest pipeline can close for a prompt's worth of work. The card
  covers sync-derived knowledge, not user-derived knowledge, and chats are the one
  source of user-derived knowledge campus currently throws away.
- **Fit:** defensible this term; weak next term, when chat volume grows.

---

## 4. Recommendation

**Do (b): extend the digest pipeline to harvest durable facts from chat history.**

Reasoning, grounded in the research:

1. **It's the industry consensus.** Every system that ships conversation memory ends up
   at "distill conversations into bounded, curated, contradiction-aware facts, then
   inject or retrieve on demand": ChatGPT (saved memories → chat-history synthesis →
   "dreaming" background synthesis), Claude (auto memory notes + MEMORY.md index),
   Mem (conversations become notes), Zep (facts with provenance + invalidation —
   which is literally campus's `is_active` supersede rule), MemGPT (agent-edited
   memory notes). **Nobody ships raw-transcript retrieval as the memory layer.**
2. **It closes the real gap with the smallest surface.** The gap isn't "more corpus" —
   the corpus already covers course content. The gap is *user-stated information and
   corrections*, which is precisely the durable-facts layer. (b) reuses the existing
   `digest_and_log` JSON contract, category whitelist, TTL, supersede, audit, and card
   regen — the change is mostly a new prompt + a scan query.
3. **It honors the philosophy.** Runs on the existing sync cadence (or a sibling
   pass), zero new services/tables/UI, deterministic, audited, no management burden,
   one feature. Facts stay bounded by the existing gates; nothing raw accumulates.
4. **The evidence against the alternatives is concrete, not theoretical:** ChatGPT's
   own post-mortems on stale/contradictory memories, Claude Code's 200-line cap and
   on-demand reads, Zep's ~4-6K-token retrieved-context benchmark results, Rewind's
   11GB/month + weak "Ask" accuracy + Meta sunset, Recall's privacy-nightingale, and
   NotebookLM's deliberate choice not to index chats at all.

**Implementation sketch for (b)** (for later, not a roadmap):
- Scan: `SELECT session_id, role, content, created_at FROM chat_messages WHERE
  created_at >= datetime('now', '-N days')` (or walk `nodes_json` if fork fidelity
  matters), grouped by course (join `chat_sessions.course_id`).
- Prompt: same shape as `digest_and_log` — STRICT JSON `{"facts": [...]}`, same
  categories, TIME RULES (absolute dates, skip ephemeral/passed), plus: only extract
  things with future relevance (decisions, preferences, corrections, user-reported
  class info); skip assistant restatements of course content (already in the corpus).
- Insert: `source='chat:YYYY-MM-DD'`, skip exact-duplicate active facts per course;
  existing supersede/TTL logic then manages the lifecycle; card regen already fires
  when facts change.
- Watch items: fact pollution (prompt discipline — same risk profile as the sync
  digest, already proven), card crowding (existing gates), latency (next sync — fine).

**Later, if discussion-level recall is actually felt** (not now): option (c), session
summaries as labeled corpus items — the curated variant of (a). It's the only
defensible way to get "what did we discuss about X" without raw-transcript noise.

### Definitely don't do

1. **Raw full-history injection into every turn** — token cost + context pollution +
   stale/contradictory information. The entire MemGPT/Zep/Claude-Code design space
   exists to avoid this; Claude Code caps injected memory at 200 lines and pages the
   rest on demand.
2. **Raw chat turns in the main chunks corpus mixed with course content** — error
   smuggling (model mistakes cited as grounded fact), near-duplicate bloat, no
   invalidation, fork ambiguity. If chat content is ever indexed, only *summaries*
   with labeled `chats/...` refs, per option (c).
3. **Rewind/Recall-style full-history capture** (screen recording / capture-everything)
   — operationally heavy (11GB/mo, battery), privacy-sensitive even at Microsoft
   scale, vendor-fragile (Rewind → Limitless → Meta sunset, regional data deletion),
   and near-zero marginal value here: campus's corpus already has the content that
   Recall-style search would recover.
4. **Bidirectional conversation sync** (chat ↔ memory re-injection loops, writing
   facts back into chats) — pointless for a deterministic harness; the card is already
   injected every turn, and mutating the message tree breaks fork semantics and the
   audit model.
5. **Zep-style temporal knowledge graph / entity graph** — enterprise-scale machinery
   for one user; campus's `is_active` supersede already provides the one capability
   that matters (contradiction invalidation). Same for MemGPT-style OS paging: the
   card + search already *is* the two-tier memory.
6. **A ChatGPT-legacy "saved memories" list the user must manage** — violates
   zero-ongoing-management by construction; the whole point of (b) is that the digest
   curates, the user never does.
7. **Cloud memory services (Mem, Zep Cloud, etc.)** — violates "I own my technology";
   Mem is Google-login-only, Zep Cloud is SaaS with a trust boundary you don't
   control. The capability is ~100 lines of Python over SQLite campus already has.

---

## 5. Sources (researched 2026-08-05)

- OpenAI — "Memory and new controls for ChatGPT" (Feb 13, 2024; updates Apr 10, 2025,
  Sep 5, 2024, Jun 3, 2025): openai.com/index/memory-and-new-controls-for-chatgpt/
- OpenAI — "Memory FAQ" (Help Center, updated Aug 2026): help.openai.com/articles/8590148-memory-faq
  (memory summary, sources, deletion semantics — "deleting a chat doesn't erase its memories")
- OpenAI — "Dreaming: Better memory for a more helpful ChatGPT" (Jun 4, 2026):
  openai.com/index/chatgpt-memory-dreaming/ (staleness/correctness post-mortem on saved
  memories; background synthesis over chat history; stale-location example)
- Anthropic — "How Claude remembers your project — Claude Code Docs":
  code.claude.com/docs/en/memory (CLAUDE.md + auto memory; 200-line/25KB index;
  on-demand topic files; corrections/preferences; conflict caveats)
- Mem — Help Center (help.mem.ai): capture → notes; Mem Chat / Deep Search / Heads Up
  over notes; Google-login-only, no self-host. Also mindfulaihacks.com "How to Use Mem
  AI" (Jun 2026) for the habit/capture model.
- Rewind post-mortems — andrewschreiber.substack.com "An early adopter's thoughts on
  Rewind.ai's $350m pivot" (Apr 15, 2024: ~11GB/mo, battery "toaster", weak Ask
  accuracy, pivot to Limitless); techcrunch.com (Apr 17, 2024: pendant, confidential
  cloud); limitless.ai (2026: acquired by Meta, Rewind sunset Dec 2025, regional data
  deletion, export/delete).
- Microsoft Recall — BBC "Microsoft re-launches 'privacy nightmare' AI screenshot
  tool" (Sep 27, 2024); CNBC "Microsoft to delay launch of AI Recall tool due to
  security concerns" (Jun 14, 2024: opt-in, encrypted DB, Windows Hello).
- NotebookLM — learnprompting.org "A Complete How-To Guide to NotebookLM" (Jan 8,
  2025: sources-only grounding, citations, 50-source default, 2M-token window); Medium
  guide (May 2025). Chats are a query interface; memory = sources/notes.
- MemGPT — Packer et al., "MemGPT: Towards LLMs as Operating Systems", arXiv
  2310.08560 (Oct 2023 / Feb 2024: virtual context management, memory tiers, agent
  memory editing; evaluated on multi-session chat).
- Zep — getzep.com (temporal knowledge graph over chat history + business data; fact
  provenance traced to source episodes; contradiction invalidation with history
  retained; LoCoMo 94.7% / LongMemEval 90.2% at ~4-6K token retrieved context).
- Campus: /home/nate/campus — sync/search.py (chunks corpus), sync/sync.py
  (digest_and_log), agent/memory.py (card + supersede), agent/context.py (card
  injection), schema.sql (chat_sessions.nodes_json, chat_messages, memory_facts),
  api/routers/chat.py (_do_turn message persistence).
