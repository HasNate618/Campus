# AI Study / Knowledge Tools — Comparison vs. Campus

**Date:** 2026-08-05 · **Author:** research pass (grounded in live web research — see Sources)
**Audience:** Nate (Western SE student), for deciding what campus should borrow.

> Philosophy reminder this report is judged against: *I own my technology* — self-hosted,
> zero ongoing management burden, deterministic, minimal UI. No synthetic/flashy UX, no
> feature sprawl. **One feature at a time.**

---

## 1. Scope & tool selection

Six tools compared against campus:

| Tool | Why it's here |
|---|---|
| **Google NotebookLM** (now "Gemini Notebook") | The reference AI-study product — source-grounded chat, flashcards, quizzes, audio overviews. The mainstream bar. |
| **engram** (github.com/nagisanzenin/engram) | Learning engine for AI agents (Claude Code + 6 other platforms incl. Hermes): free recall, blind grading, FSRS spaced repetition. Most philosophically aligned with campus. |
| **Open NotebookLM** (github.com/gabrielchua/open-notebooklm) | The famous "open-source NotebookLM" — tests whether a self-hosted clone is viable. |
| **khoj** (github.com/khoj-ai/khoj) | The leading self-hostable "AI second brain" — the closest mature thing to campus's ethos. |
| **Obsidian** | Local-first markdown + graph + plugin AI (Smart Connections, Copilot, Spaced Repetition). |
| **RemNote** | The student-workflow tool: notes + flashcards + spaced repetition + PDF annotation fused. |

Rejected candidates (justified): **Mem** (chat-native, cloud, no study structure), **Rewind/Recall**
(screen-recording memory, heavy local infra, weak study value), **Elicit** (research-paper search,
not coursework), **Anki** (no note/AI layer; its algorithm is already absorbed via engram's FSRS).

---

## 2. Campus baseline (what we're comparing against)

What campus already has (from `docs/DESIGN.md`, `schema.sql`, the web UI):

- **Deterministic Brightspace sync** (1–2x/day) → SQLite spine: `courses`, `course_sessions`,
  `assignments` (rubrics_json, group_category, attachments, availability, weight, status),
  `exams`, `content_nodes` (tree), `announcements`, `lectures` (summary/key_points/transcript),
  `files`, `notes`, `events`, `work_links`, `sync_runs`, `audit_log`.
- **AI digest pass** on sync deltas → `memory_facts` (course_id, fact, category, confidence, source)
  → per-course **memory card** injected into every AI turn.
- **Agent harness**: tools for reading course content, listing assignments, sync-delta stats,
  scoped file_edit, **audited** file writes (before/after hashes). Per-course scoped chat with true streaming.
- **Web dashboard (PWA)**: course tabs — Overview (announcements + upcoming), Content (tree + PDF
  viewer), Assignments (list → detail w/ rubrics, groups, attachments), Workspace (file tree +
  audited markdown editor + Ask-AI + auto-refresh), docked chat rail, Today, Calendar, Sync.
- Workspace: per-course `notes/` + `work/` dirs, AI + user both write (audited).
- Parked: OneDrive sync, MCP server, lecture recordings (schema already has `recording_status`).

**Campus's structural differentiators** (no tool below has all three): a synced **LMS spine with
deadlines/rubrics**, **audited AI writes**, and a **memory card** that keeps the AI course-aware
without any RAG/vector infra.

---

## 3. Feature matrix

Legend: ● built-in / first-class · ◐ partial / plugin / via add-on · ○ absent / manual workaround

| Feature | Campus | NotebookLM | engram | Open NotebookLM | khoj | Obsidian | RemNote |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Self-hosted / data you own | ● | ○ | ● | ● | ● | ● | ○ |
| LMS sync (deadlines, rubrics, groups) | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Source-grounded chat w/ citations | ◐ (grounded, no inline cites yet) | ● | ○ | ○ | ● | ◐ (plugins) | ◐ (tutor chat) |
| Structured notes / editor | ● | ◐ | ○ | ○ | ◐ | ● | ● |
| PDF viewer + annotation | ◐ (viewer, no annotation) | ○ | ○ | ○ | ◐ | ○ | ● |
| Flashcards / quizzes generated from sources | ○ | ● | ◐ (probes are generated) | ○ | ○ | ◐ (plugins) | ● |
| Spaced repetition scheduler | ○ | ○ | ● (FSRS-4.5, personal fit) | ○ | ○ | ◐ (plugin) | ● |
| Free-recall / "explain it back" verification | ○ | ○ | ● | ○ | ○ | ○ | ◐ |
| Blind/external grading of your answers | ○ | ○ | ● (assessor, audited) | ○ | ○ | ○ | ○ |
| Audio overview / podcast from sources | ○ | ● | ○ | ● (PDF→MP3 only) | ◐ (TTS) | ○ | ○ |
| Mind maps / concept graph | ◐ (content tree) | ● | ● (concept DAG) | ○ | ○ | ● (graph view) | ◐ (portals) |
| Semantic search / RAG | ◐ (H3 planned) | ● | ○ | ○ | ● | ◐ (Smart Connections) | ◐ |
| Web search integration | ● (trawl) | ○ | ◐ (curriculum build) | ○ | ● | ○ | ○ |
| Automation / API hooks | ● | ○ | ◐ (hooks, CLI) | ○ | ● (automations) | ◐ (plugins) | ○ |
| Audit trail of AI writes | ● | ○ | ◐ (receipts, append-only) | ○ | ○ | ○ | ○ |
| Mobile / PWA | ● (PWA) | ● (app) | ○ | ○ | ● | ● | ● |
| Cost | self-hosted | free / Plus paid | MIT, free | Apache-2.0, needs LLM API | AGPL, self-host free | free / paid sync | freemium / paid AI |

---

## 4. Tool-by-tool: strengths & gaps (student lens)

### 4.1 Google NotebookLM ("Gemini Notebook")

**Strengths**
- **Source-grounded chat with numbered citations** — every answer links back to the exact passage;
  click-through to the source. This is its core and it's excellent for verifying AI claims.
- One-click **study aids from your own documents**: flashcards, quizzes (choose topic + difficulty),
  study guides, briefing docs, reports — each with an "explain" button that cites the source.
- **Audio Overviews** (Deep Dive + Brief/Critique/Debate formats) and **Video Overviews** — study on
  the go; the Debate format is genuinely good for exam prep.
- **Learning Guide** — a Socratic mode that asks you probing questions instead of just answering.
- **Mind Maps** generated from sources; public notebook sharing; OpenStax textbooks as ready-made
  notebooks; ingests PDFs, YouTube URLs, web pages, audio, Google Docs.
- Free tier is generous for one course's materials; Plus (paid) raises limits.

**Weaknesses / gaps**
- **Cloud-only, Google account required** — your course materials live on Google's servers; no
  export-to-self-host story. Directly violates "I own my technology."
- **No LMS integration and no deadlines**: you manually upload every PDF/slide per notebook;
  nothing about assignments, rubrics, groups, or the course calendar. It's a Q&A box, not an organizer.
- **Source caps bite**: ~50 sources/notebook free, 100 Plus, 300 Pro, 600 Ultra (per XDA/elephas,
  Jan–Jun 2026); 500k words/source. A full SE term of slides + readings exceeds 50 sources fast,
  and review write-ups note accuracy degrades as notebooks grow.
- **No spaced repetition** — generated flashcards are static; no scheduler, no review queue.
- **No automation/API** — nothing like campus's sync → digest → memory card pipeline; no audit of AI actions.
- **"Too much stuff"** — the media studio (audio/video/mind maps/slides/infographics) is exactly the
  synthetic, flashy surface campus deliberately rejects.

### 4.2 engram (nagisanzenin/engram)

MIT, ~1.3k stars, v1.11.1 (Aug 4, 2026). A Claude Code plugin (also Hermes, Codex, OpenCode,
Antigravity, OpenClaw, pi) that is explicitly **not agent memory** — it's a learning system *for the
human*: `/learn` → `/review` → `/coach`.

**Strengths**
- **Free-recall verification with receipts**: a tutor makes you predict/struggle/explain-back, then a
  **blind assessor** (fresh context, rubric only, never saw the lesson) grades your words; every
  grade is a receipt on disk. Separation of powers, audited (0/258 "graded up" on its gold set).
- **FSRS-4.5 spaced repetition fitted to your own review history** — deterministic `engram.py`
  (stdlib-only, no network code) computes every date/stability; a fit that doesn't beat your current
  one is refused. Due-nudge hook is silent when nothing is due.
- **First-principles curriculum DAG**: topics decomposed into *chains of necessity* with flagged
  **threshold concepts** — not chapter order. Procedure nodes use a worked-example ladder +
  solve-a-fresh-variant reviews with execution-checked arithmetic (perfect for SE/math).
- **Honest failure modes**: adherence/retention metrics report their *unmeasured* denominators;
  `decay` shows what's dying and what N minutes would save; refuses gamification (no streaks/XP);
  opt-in Focus profile for ADHD.
- Plain JSON state at `~/.claude/learning/` (or `ENGRAM_HOME`) — human-readable, yours, portable
  across all 7 platforms.
- **Installs on Hermes** (INSTALL-HERMES.md, verified v0.18.2) — the user already runs Hermes.

**Weaknesses / gaps**
- **No course integration whatsoever**: it teaches whatever you name in `/learn`; no Brightspace,
  no deadlines, no rubrics, no calendar. You must hand-feed it material.
- Lives in a coding-agent CLI — no PDF viewer, no dashboard for a phone, no assignment tracking.
- Topic-based, not course-based; no notion of "due tomorrow," "group project," or rubric alignment.
- The interactive "explorables" (threshold-concept HTML artifacts) are great but content-triggered
  and labor-intensive to produce.

### 4.3 Open NotebookLM (gabrielchua/open-notebooklm)

Apache-2.0, 2.6k stars — but **last commit Dec 7, 2024**, and it is *not* a NotebookLM clone.

**Strengths**
- Self-hostable, simple Gradio UI, ~13 languages, Apache-2.0 — the ownership ethos.
- One clean, working idea: **PDF → podcast dialogue MP3** (Llama 3.3 70B via Fireworks + TTS).

**Weaknesses / gaps**
- **It is a PDF-to-podcast one-trick.** No grounded chat, no citations, no mind maps, no
  flashcards/quizzes, no notes, no calendar, no sync. Even its own README says so.
- Stale (nearly 2 years at time of writing); needs a paid Fireworks API key; single-user demo-grade.
- Honest takeaway: the *open-source NotebookLM* meme is mostly a podcast generator. The only
  borrowable idea is the two-voice dialogue format, and that's a parked/low-priority item.

### 4.4 khoj (khoj-ai/khoj)

AGPL-3.0, ~36k stars, actively maintained. "Your AI second brain. Self-hostable."

**Strengths**
- **Self-hostable RAG over your docs** (PDF, markdown, org-mode, Word, Notion, images) + web search;
  chat with any local or cloud LLM; semantic search with real retrieval work behind it.
- Broad client surface: web, desktop, Obsidian plugin, Emacs, phone, WhatsApp.
- Custom agents (knowledge + persona + tools), scheduled automations (newsletters, notifications),
  deep research, image gen, TTS.
- Scales from on-device to cloud — same codebase.

**Weaknesses / gaps**
- **Heavy ops**: Postgres + pgvector + server + web app + multiple clients — the opposite of
  campus's single SQLite container. Violates the zero-management-burden rule.
- **Feature sprawl**: agents, automations, image gen, WhatsApp, newsletters — exactly the
  "too much stuff" the user rejects.
- **No course structure**: no deadlines, rubrics, groups, LMS sync. It's a generic second brain —
  you'd still need campus for the spine, so adopting khoj means running *two* systems.
- AGPL licensing if it ever gets vendored.

### 4.5 Obsidian

Free, local-first markdown with a huge plugin ecosystem.

**Strengths**
- **Local-first, plain markdown files you own**; works offline; no account. Closest to campus's
  file philosophy (and campus's Workspace already copies the markdown-editor idea).
- **Graph view / backlinks** for manual knowledge linking; **Smart Connections** plugin adds
  *local-embedding* semantic related-notes (runs on-device, no API key, data never leaves the vault).
- Flexible editor: wikilinks, canvases, daily notes; thousands of plugins (incl. Spaced Repetition).

**Weaknesses / gaps**
- **It's a note editor, not a course system**: no LMS sync, no deadlines, no rubrics, no group
  metadata — everything is hand-organized.
- **Plugin sprawl = management burden**: choosing, updating, and reconciling plugins is exactly the
  ongoing upkeep campus exists to avoid. AI features are third-party and inconsistent (Copilot
  plugin ships your vault to OpenAI; Smart Connections is local but narrow).
- **No structured spine**: all files, no audit log, no before/after hashes on AI edits.
- No built-in spaced repetition; the SRS plugin requires you to hand-write cards.

### 4.6 RemNote

Freemium, student-targeted: networked notes + flashcards + spaced repetition + PDF annotation fused.

**Strengths**
- **The student workflow in one app**: take notes, make flashcards *in the notes*, annotate PDFs,
  and the built-in Anki-style spaced-repetition queue reviews them. PDF-to-flashcards, quizzes,
  summaries, lecture transcription, and document-grounded tutor chat on paid AI tiers.
- Free plan covers the core note+flashcard+SRS loop; desktop works offline.
- Portals/backlinks give a lightweight knowledge graph.

**Weaknesses / gaps**
- **Cloud service**: account, sync, subscription for AI; notes live on RemNote's servers. Ownership
  problem, and a proprietary note format you can't grep from your homelab.
- **Feature creep**: portals, aliases, many AI modes — a heavy UI for a user who wants minimal.
- No LMS/deadline/rubric integration; no API/automation hooks; PDF annotation only inside their viewer.

---

## 5. STEAL LIST — prioritized

Ordered by value-per-effort. **Pick one; don't stack these.** All effort estimates assume one
developer (you + an agent) on the existing FastAPI + SQLite + React codebase.

### S1. Quiz-me / free-recall mode in the chat, blind-graded
*(from engram + NotebookLM)*

- **(a) What:** A "quiz me" mode in the per-course chat (or a `review` chat tab): the AI samples the
  course's memory facts + recent digests + key_points, asks the user to recall/explain (generation
  before explanation), grades the answer **blind** (fresh context that sees only the rubric and the
  user's words — engram's separation of powers), and writes a receipt row (fact, grade, date).
- **(b) Why it fits:** Zero new infra — it's a prompt contract + one small table
  (`quiz_attempts`), deterministic, and it directly serves the #1 design goal ("explain content").
  It converts campus's passive chat into retrieval practice, which is the single best-replicated
  learning intervention (engram's whole evidence base: Roediger & Karpicke 2006 et al.).
- **(c) Effort: small.** Chat-mode routing + one schema table + one AI tool / prompt variant. No UI
  needed beyond the existing chat rail; the blind-grading pass is a second (cheap) bifrost call.
- **(d) Replaces/improves:** Replaces "Ask-AI" as the default way to study; improves the memory
  card's value by closing the loop (facts you can't recall get re-digested).

### S2. FSRS spaced-repetition schedule on memory facts
*(from engram)*

- **(a) What:** A `review_schedule` (fact_id, due_at, stability, interval) maintained by a small
  deterministic Python module implementing **FSRS-4.5** (the open algorithm Anki now uses — engram
  ships a MIT reference; the math is public). Every graded quiz attempt (S1) updates the fact's
  schedule. Today page gains a "Due reviews" list; a tiny cron sends the ntfy nudge.
- **(b) Why it fits:** Deterministic, stdlib-Python, one table, no LLM in the hot path — the model
  never does calendar math (engram's own rule). Fits "deterministic" and "zero management."
- **(c) Effort: medium.** FSRS port (~100–200 lines) + table + Today-list UI + nudge cron. Build
  only after S1 has produced a couple of weeks of receipts (it needs data to be useful).
- **(d) Replaces/improves:** Adds what campus lacks entirely; turns the memory card from a passive
  injection into a scheduled review system; the ntfy nudge replaces "I should study more" with a
  concrete 3-minute task.

### S3. Inline source citations in chat answers
*(from NotebookLM)*

- **(a) What:** Chat answers cite their grounding: `[1]`-style markers that link to the file +
  section (or content node) the claim came from, clickable into the Content page / PDF viewer.
  NotebookLM's numbered-citation UX is the model.
- **(b) Why it fits:** Campus already grounds answers in synced data; this is a **prompt contract +
  a renderer**, not new architecture. It makes the "grounded course facts" goal visibly verifiable
  and lets the user audit AI claims — consistent with the audit-everything philosophy.
- **(c) Effort: small.** Instruct the model to emit `[src:file.md §heading]` markers; the chat
  renderer turns them into links; a fallback "sources used" block when markers are missing.
- **(d) Replaces/improves:** Improves trust in the chat rail; makes the Content tab and chat
  mutually reinforcing instead of separate.

### S4. One-click study aids: "make a study guide / flashcard set from this module"
*(from NotebookLM + RemNote)*

- **(a) What:** An AI tool (or a button on the Content page) that takes a content node subtree
  (module slides → extracted markdown) and writes a **markdown study guide** (key terms, concept
  list, practice questions) into `notes/` — audited like every other AI write. Flashcards are just a
  structured section of the same doc, which S1's quiz mode can then use as its question bank.
- **(b) Why it fits:** Reuses the existing digest + extraction pipeline; output is plain markdown in
  the user's own Workspace (no new surface); audited writes keep it deterministic-safe.
- **(c) Effort: small.** One AI tool + one button on ContentPage; no new schema (it's a note file).
- **(d) Replaces/improves:** Replaces manually summarizing slides before exams; feeds S1/S2 with
  structured review material instead of relying on digest facts alone.

### S5. Silent due-nudge via ntfy
*(from engram)*

- **(a) What:** A cron that checks `review_schedule` due items (S2) + next-48h assignment/exam
  events and sends **one** ntfy message, and sends *nothing* otherwise (engram's "silent when
  nothing is due" contract).
- **(b) Why it fits:** Tiny, deterministic, and it *reduces* cognitive load instead of adding a
  surface. Campus already has ntfy wired into sync.
- **(c) Effort: small** (hours).
- **(d) Replaces/improves:** Replaces manual "check the Today tab" habit for reviews; for deadlines
  it overlaps the existing Overview strip — keep it to reviews + day-before deadlines only, or skip
  the deadline half (already covered).

### S6. PDF highlight → note capture
*(from RemNote)*

- **(a) What:** In the Content PDF viewer, selecting text saves a highlight + optional margin note to
  the course's `notes/` (linked to the file + page). The Workspace auto-refresh already exists.
- **(b) Why it fits:** It's the missing half of campus's "browse real content" story — right now the
  viewer is read-only. Notes stay as files campus already owns.
- **(c) Effort: medium.** Viewer (pdf.js) selection plumbing + a small API endpoint + note template.
- **(d) Replaces/improves:** Replaces the copy-paste-into-Workspace workflow; makes lecture-slide
  marginalia actually usable by S1's quiz mode later.

### S7. Concept graph from digests
*(from engram's curriculum DAG)*

- **(a) What:** Extend the digest pass to also upsert `concepts` (name, one-line definition,
  course_id, source node) and `concept_links` (prerequisite edges, confidence). The AI context card
  then injects "this week's concepts + their prerequisites" and can explain *in terms of* earlier
  material.
- **(b) Why it fits:** Still fully deterministic pipeline work (digest already runs); no vector
  infra; gives the AI better context selection than a flat fact list.
- **(c) Effort: medium.**
- **(d) Replaces/improves:** Improves the memory card and answer quality; later enables
  prerequisite-aware review ordering (ask about X only after its prerequisites are due/stable).

### S8. "Related notes" via local embeddings (fold into planned H3 RAG)
*(from Obsidian Smart Connections)*

- **(a) What:** When H3 ships (Cohere embed/rerank, Chroma or sqlite-vec), surface a "related"
  panel on Workspace/Content pages (same-vault semantic neighbors), the way Smart Connections shows
  related notes while you write.
- **(b) Why it fits:** It's already on the roadmap; the steal is only the *surface*. Local embedding
  means no data leaves the homelab.
- **(c) Effort: small if done with H3** (an endpoint + a side panel).
- **(d) Replaces/improves:** Replaces manual searching across courses; makes cross-course links
  (e.g., SE 2250B vs SE 3309A concepts) visible.

---

## 6. Anti-steal list — do NOT take these

- **NotebookLM's media studio** (Audio/Video Overviews, mind maps, slides, infographics): flashy,
  token-hungry, and the exact synthetic surface the user rejects. The user explicitly dislikes
  fake-streaming/typewriter effects; audio-generation isn't worth the infra. Parked, at best.
- **NotebookLM as a tool**: cloud dependency + manual per-notebook upload + 50-source caps = the
  opposite of campus's synced spine. (It stays useful as a *reference UX* for citations.)
- **khoj wholesale**: Postgres/pgvector ops burden, agent/automation/WhatsApp sprawl, AGPL. Campus's
  single-container SQLite + trawl already covers 90% of the value.
- **Obsidian plugin marketplace sprawl**: choosing/maintaining plugins is ongoing management burden.
  If the user wants a local markdown editor, campus's Workspace already is one — and it's audited.
- **RemNote's cloud + proprietary format**: notes the user can't grep from the homelab are
  non-negotiable failures. Steal the *workflow* (notes↔flashcards↔PDF annotation), not the app.
- **Open NotebookLM as a product**: stale one-trick; nothing to adopt.
- **Gamification anywhere** (streaks, XP, badges): engram's own literature review shows it backfires
  on motivated adults; the user hates flashiness. Campus's growth signal should be *retention
  numbers with honest denominators*, not points.
- **Replacing campus's spine with any of these**: no tool here has LMS sync + audit log + memory
  card together. The spine is the moat.

---

## 7. Architectural ideas (AI context without heavy ops)

- **Hybrid retrieval, spine-first**: deadline/status questions never need embeddings — the SQLite
  spine answers them with WHERE clauses (course, date window, status). Add SQLite **FTS5** over
  extracted markdown + digests for keyword recall *before* shipping embeddings (H3). FTS5 is built
  into the SQLite campus already has. This gets "find where the rubric says X" working with zero new
  services.
- **FSRS-4.5 in stdlib Python**: the algorithm is public (open-spaced-repetition, Anki's default);
  a port is ~150 lines, deterministic, no model calls. The model schedules nothing; the code does.
- **Blind-grading pattern**: any time the user is quizzed (S1), grade from a *fresh* context holding
  only the rubric + the user's words — never the lesson. engram's 0/258-graded-up audit shows this
  is the difference between a useful grade and flattery.
- **Memory card evolution**: keep the injected card small; add (a) due-review count, (b) top-3
  concepts + prerequisites (S7), (c) next-7-day events (already there). Small card = cheaper turns
  and better adherence; the facts table stays the deep store.
- **Citations as a protocol, not a feature**: bake `[src:…]` into the chat system prompt (S3) so
  grounded answers are the default; render in the UI. Cheapest trust upgrade available.
- **Receipts as first-class data**: S1/S2 receipts (fact, grade, interval, due) double as the
  honest "what am I actually retaining" metric — no dashboards required, just a line in Today
  ("7 facts stable · 3 due today"), echoing engram's *unmeasured-denominator honesty*.

---

## 8. Sources (researched 2026-08-05)

- NotebookLM / Gemini Notebook: notebooklm.google · blog.google post "6 ways to use NotebookLM to
  master any subject" (Sep 8, 2025) — flashcards/quizzes/reports/Learning Guide/audio formats ·
  limits per XDA Developers (Jan 2026), elephas.app (Jun 2026), Medium (Dec 2025): 50/100/300/600
  sources per notebook by tier, 500k words/source.
- engram: github.com/nagisanzenin/engram (README + CHANGELOG, v1.11.1, Aug 4 2026) — FSRS-4.5,
  blind assessor + gold set audit, procedure nodes, Hermes install (INSTALL-HERMES.md, v0.18.2).
- Open NotebookLM: github.com/gabrielchua/open-notebooklm (last commit Dec 7, 2024; README scope).
- khoj: github.com/khoj-ai/khoj (README; AGPL; clients; docs.khoj.dev).
- Obsidian: obsidian.md; community.obsidian.md Smart Connections (local embeddings, no API key);
  codeculture.store Obsidian AI plugin comparison (2026).
- RemNote: remnote.com; recatools.com review (notes + PDF annotation + SRS + AI layers).
- Campus: /home/nate/campus — docs/DESIGN.md, docs/PLAN.md, schema.sql, web/ + sync/ + api/.
