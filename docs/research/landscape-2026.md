# AI Study & Academic Tool Landscape — 2026

**Date:** 2026-08-05 · **Research:** live web research, per-tool (see Sources) · **Audience:** Nate (Western SE, 3rd year, starting Sept 2026)

**What this is:** a market map of the 2026 AI study-tool landscape, where the self-hosted
*campus* system sits in it, the categories campus is entirely missing, and which tools are
worth **using alongside** campus instead of building. This is *not* another feature-steal
list — see `comparison.md` (2026-08-05) for the earlier "what should campus borrow" pass.
This document's job is orientation: what exists, what covers what, what to install vs. what
to build vs. what to ignore.

> Verdict vocabulary: **use alongside campus** = install/use as a complement · **replace campus** = could take over the role · **skip** = don't adopt for any reason grounded in your setup.

---

## TL;DR

- The 2026 market splits into ~10 categories; campus owns **one of them outright** (course/LMS hub) and
  has no real competition there — no commercial tool starts from a synced LMS spine with deadlines,
  rubrics, and a content tree.
- The big 2026 news: **NotebookLM is now "Gemini Notebook"** (renamed July 16, 2026, Deep Research agent,
  free tier got a 1M-token context); **Quizlet's best modes are paywalled and Knowt ate its lunch**;
  **Anki's FSRS scheduler is the retention gold standard**; **Khanmigo and Synthesis are K-12 products
  (and Khanmigo requires a US billing address — unusable from Canada)**; **Rewind is dead** (acquired by
  Dropbox 2024; rewind.ai is now an unrelated AI-tools directory); **"Feyn" is now an iOS drawing-
  flashcards app**, not the 2024 AI-flashcards startup.
- Campus's real gaps are exactly four: **no spaced-repetition/flashcards**, **no scholarly search**,
  **no mobile offline**, **no collaboration**. Only the first two are "build later" candidates; the
  others are "use a tool" answers.
- Worth installing today: **Anki** (review queue), **Knowt** (AI flashcards from the same PDFs campus
  syncs), **Elicit or Consensus** (paper search, free tier), **Gemini Notebook free tier** (exam-crunch
  study aids, if you accept Google holding copies), **Notion Education Plus** (group projects only).

---

## 1. The landscape at a glance

| # | Category | What it does | 2026 leaders | Campus coverage |
|---|----------|--------------|--------------|-----------------|
| 1 | Course / LMS hub | Content tree, deadlines, rubrics, announcements | Brightspace/D2L (institution side — no student-side equivalent exists) | ✅ **core** (the only one here) |
| 2 | Source-grounded doc Q&A / AI notes | Chat grounded in *your* documents, generated study aids | Gemini Notebook, Otio, Mem, Reflect | ◐ grounded chat yes; generated study aids no |
| 3 | Flashcards / spaced repetition | Review queues, active recall | Anki, Knowt, Quizlet, Feyn, RemNote | ✗ none |
| 4 | Academic paper search | Find, summarize, extract from 100M+ papers | Elicit, Consensus, Scite, Sourcely | ✗ (trawl is general web, not scholarly) |
| 5 | AI tutoring / guided practice | Socratic guidance, curriculum wiring | Khanmigo, Synthesis, ChatGPT/Claude prompted | ◐ chat can be prompted to tutor; no structured curriculum |
| 6 | Study organizers / workspaces | Notes + tasks + databases, AI over it | Notion, Taskade, Todoist AI | ◐ Today/calendar/Workspace, single-user |
| 7 | Agentic summarizers / research agents | Multi-step "research this" with citations | Otio, Gemini Notebook Deep Research, Perplexity deep research | ◐ digest + trawl yes; multi-step agent no |
| 8 | Second brains / PKM | Personal knowledge base, backlinks | Obsidian, Mem, Reflect, Logseq | ◐ audited Workspace notes; not a general brain |
| 9 | Lecture capture / transcription | Record lecture → notes | Otter, Krisp, Granola, Knowt lecture mode | ✗ (parked as H5) |
| 10 | Exam prep / practice | Practice tests, question banks, past exams | Knowt exam hubs, Anki decks, Gemini Notebook quizzes | ✗ none |

---

## 2. Tool-by-tool (14 tools, grouped by category)

### AI notes & document Q&A

**Gemini Notebook (Google NotebookLM)**
*What:* Google's source-grounded research/study tool — chat + citations over your documents, generated flashcards/quizzes/audio overviews, and a Deep Research agent; renamed from NotebookLM on July 16, 2026. For anyone who wants AI answers locked to their own files. Free tier is genuinely usable.
*Strengths:* best-in-class grounded chat with numbered citations; Deep Research (Nov 2025) finds sources for you and 1M-token context is free (Jan 2026); quizzes/flashcards with miss-tracking (Mar 2026) are the most genuinely useful study artifacts in the market; Plus dropped to $4.99/mo (Jun 2026).
*Weaknesses:* cloud-only with a Google account and **no consumer API**; notebooks are silos (no cross-notebook search); manual upload per notebook and 50 sources free — a full term of slides blows past the cap fast, and everything is metered (10 Deep Research runs/mo free); feature sprawl (cinematic videos) aimed at $99.99+ Ultra tiers.
*Verdict: **use alongside (sparingly)** — the best study-aid generator on the market and free, but cloud + manual upload means it complements campus for exam crunch only, and only if you accept Google holding copies of course materials.*

**Mem**
*What:* "Personal AI that remembers" — chat-native notes workspace with voice capture, meeting transcription, and a proactive Mem Agent. For knowledge workers drowning in meetings, not for course structure.
*Strengths:* frictionless capture (voice, Push-to-Remember, save-from-anywhere); semantic deep search over everything saved; proactive agent nudges tied to your own notes.
*Weaknesses:* cloud-only at $12+/mo (Proactive tiers $29–99); no course structure whatsoever (no deadlines, content tree, or rubrics); meeting-focused with a 2-hour recording cap on paid plans, and reviews report sync/editing bugs.
*Verdict: **skip** — it's a meeting brain, not a study system; campus already has the notes + AI layer you'd use it for.*

**Reflect**
*What:* minimalist daily-notes app with voice transcription, backlinks, E2E encryption, and "chat with your notes". For people who want Apple-Notes-plus-AI.
*Strengths:* clean daily-note flow that people genuinely stick with; strong voice transcription + AI note cleanup; E2E-encrypted and offline-capable.
*Weaknesses:* iPhone-first (no real Android/Linux story); cross-device sync is cloud-dependent; no study structure — it's a notebook, not a course system.
*Verdict: **skip** — campus's Workspace already gives you audited markdown notes; a second notes app is management burden, not capability.*

### Flashcards / SRS

**Anki**
*What:* the open-source spaced-repetition engine (free desktop/Android, $24.99 one-time on iOS) with FSRS scheduling now the default since v23.10. For anyone serious about retention.
*Strengths:* gold-standard FSRS scheduler, fully offline, your data is local files; huge ecosystem of shared decks and add-ons; free on every platform except a one-time iOS fee.
*Weaknesses:* ugly and famously steep learning curve (Anki's own forums are full of confused new users); card-making is manual — no AI generation; decks are islands with no course context.
*Verdict: **use alongside** — the review habit is exactly what campus doesn't do; campus feeds you the material, Anki schedules the recall. (The one bridge worth building later: CSV export of memory facts → deck.)*

**Feyn**
*What:* an iOS/iPad drawing-first flashcard app ("learn by drawing" with Apple Pencil) with spaced repetition. For iPad students who study by hand.
*Strengths:* best-in-class handwriting/drawing cards; free core with iCloud sync and no ads; vertical card format suits phone review and iPad split-screen.
*Weaknesses:* Apple-only (no Android/Windows/Linux); no AI generation — every card is hand-made; small app, and Pro ($29.99/yr) gates charts/import.
*Verdict: **skip** — you don't have an iPad-drawing workflow, and Anki/Knowt cover the same job cross-platform. (The 2024-era "Feyn AI" flashcard startup is gone; this app is what the name means now.)*

**Knowt**
*What:* the free Quizlet alternative — AI flashcards, notes, and study guides generated from PDFs, slides, videos, and lecture recordings, plus exam hubs and a voice tutor ("Kai"); 5M+ students.
*Strengths:* genuinely free core (unlimited learn mode, practice tests, SRS) — exactly what Quizlet paywalled; AI generation from the same file types campus already syncs (PDF/PPT/video); one-click Quizlet import and mobile apps on both stores.
*Weaknesses:* cloud-only — decks and uploads live on their servers; feature-heavy, TikTok-flavored product (games, exam hubs, voice tutor); AI-card quality varies, and the exam hubs are high-school (AP/IB) focused, not university.
*Verdict: **use alongside** — the fastest path from a synced PDF to a flashcard deck on your phone; treat decks as ephemeral study material, never as your archive.*

### Academic search

**Elicit**
*What:* AI research assistant that searches 125M+ papers, summarizes findings, and extracts structured data (methods, sample sizes, limitations); 2M+ researchers. For literature reviews.
*Strengths:* paper discovery + structured extraction in one pass; chat with the papers you collect; free tier exists; designed for systematic-review workflows.
*Weaknesses:* built for researcher/PhD lit reviews — overkill for most undergrad work; Pro is $49/mo and the free tier is limited; not course-aware — you bring the question and the reading list.
*Verdict: **use alongside (only for research-heavy terms)** — for a technical-writing course or capstone literature review it's the best paper-finder around; campus's trawl can't index 125M papers.*

**Consensus**
*What:* "Google Scholar with a consensus meter" — search 200M+ papers, get cited AI answers with study-design badges and a Yes/No consensus read; 5M users.
*Strengths:* answers yes/no questions with actual cited papers plus study-type labels; free basic paper search; Pro is $144/yr with up to 40% off for students; good for finding evidence quickly in CS-adjacent topics.
*Weaknesses:* science/medicine bias — software-engineering topics have thinner coverage; AI analysis is metered on free (15 Pro messages/mo); no course structure, no saving your syllabus.
*Verdict: **use alongside (optional)** — pick *one* of Elicit/Consensus and keep it free; they solve "what do papers say", campus solves "what does my course say".*

**Perplexity**
*What:* cited AI answer engine over the live web (free; Pro ~$20/mo; Max $200/mo). For quick, cited answers on anything.
*Strengths:* fast, cited, up-to-date answers — the best general lookup tool of the AI era; generous free tier; deep research mode for multi-hour questions.
*Weaknesses:* web-grounded, not scholarly-grounded — not a paper tool like Elicit/Consensus; not course-aware; subscription creep if you want the good models.
*Verdict: **skip (already covered)** — campus's chat + trawl does the coursework half; the free tier is fine for out-of-course questions, but it's not a study system.*

### AI tutoring

**Khanmigo**
*What:* Khan Academy's AI tutor that guides you Socratic-style instead of giving answers, wired into Khan Academy's free curriculum library; aimed at K-12/parents and early college.
*Strengths:* genuinely good pedagogy — forces you to work it out, 4 stars from Common Sense Media; grounded in Khan Academy's content; teacher-side tools free in 44 countries.
*Weaknesses:* **learner access requires a US billing address — unavailable from Canada**; content tops out at early college — nothing for a 3rd-year SE course load; paid subscription for learners.
*Verdict: **skip** — you literally can't subscribe from Canada, and campus's chat can be prompted to tutor the same way over your actual course content.*

**Synthesis**
*What:* the "personal math tutor for your child" (Josh Waitzkin, born out of the SpaceX school); ages 8–14.
*Strengths:* hands-on, game-like math learning kids love; adaptive and multisensory; 4.6★ across ~9.7k reviews.
*Weaknesses:* wrong audience — children's math, not university software engineering; no course or assignment integration; subscription for a niche you don't need.
*Verdict: **skip** — nothing to take from a kids' math tutor; the Socratic-tutor idea is better done as a prompt contract in campus's chat.*

### Study organizers

**Notion**
*What:* all-in-one workspace (notes, databases, wikis, tasks) with AI; **Education Plus is free with a school email**; the default group-project collaborator in university.
*Strengths:* unbeatable shared workspace — real-time multi-user and databases for tracking; free Plus tier for students; Notion AI is now bundled into plans (2026) rather than a paid add-on.
*Weaknesses:* cloud + proprietary format — the opposite of "I own my technology"; heavy and configurable-to-death — a standing management burden; no LMS sync — you hand-build any course structure.
*Verdict: **use alongside (narrowly)** — for the 3–4 group projects and shared docs per year, free student-tier Notion beats anything self-hosted; never as your personal course brain.*

### Agentic summarizers / research agents

**Otio**
*What:* AI research workspace that ingests PDFs, videos, podcasts, and web pages, runs agentic deep research with page-level citations, and exports notes/docs; 200k users, from $7/mo.
*Strengths:* every major model on every plan with no source caps; visible multi-step research with page/timestamp citations; Zotero/Drive/OneDrive integrations and markdown export.
*Weaknesses:* another cloud subscription and login; generic research workspace with no course awareness (no deadlines/rubrics); overlaps what campus's grounded chat + trawl already do for your coursework.
*Verdict: **skip** — campus already gives you grounded chat over your own corpus; Otio only pays off at thesis scale, and Elicit/Consensus cover that cheaper.*

### Second brains / PKM

**Obsidian**
*What:* local-first markdown knowledge base with graph view and a plugin ecosystem — in 2026, Smart Connections does local-embedding semantic search and Copilot + Ollama enable fully local vault chat. For people who want a knowledge base they own.
*Strengths:* plain markdown files you own, works offline, no account; the 2026 AI stack can run fully local (embeddings + Ollama, nothing leaves your machine); free for personal use.
*Weaknesses:* it's a note editor, not a course system — no deadlines, rubrics, or LMS sync; plugin selection and maintenance is a standing management burden (against the philosophy); AI features are third-party and inconsistent.
*Verdict: **use alongside (optional, non-course)** — if you want a personal knowledge base for projects/internship/job hunt, it's the best local-first choice and campus's Workspace shouldn't try to be that; just don't wire it into the course workflow.*

### Also in the market (one-liners)

- **Quizlet** — paywalled its best modes (Learn, practice tests, AI study guides) behind Plus; Knowt is the free replacement. *Skip.*
- **Scite** — "Smart Citations" showing whether papers support/contradict each other; useful but aimed at researchers and its free tier has been shrinking. *Skip for undergrad.*
- **Sourcely** — paste an essay paragraph → it finds matching academic sources and citations; handy for essay writing, low stakes. *Optional, free.*
- **Socratic** — Google's homework solver, effectively superseded by Gemini/NotebookLM's education push. *Skip.*
- **Taskade / Todoist AI** — task managers with AI chatter layered on; campus's Today + calendar already cover student scheduling. *Skip.*
- **Krisp / Otter / Granola** — meeting/lecture transcription and notes; the campus equivalent (lecture recording) is parked as H5 and the schema already exists. *Skip for now.*
- **Rewind** — the "searchable everything you've seen" screen-recorder was acquired by Dropbox (2024) and shut down; rewind.ai is now an unrelated AI-tools directory. *The category is dead.*
- **AgenticStudy** — no durable product surfaced in research (mid-2026); the "AI study agent" niche is occupied by Gemini Notebook Deep Research, ChatGPT/Claude, and Knowt's Kai. *Don't chase.*
- **engram** — the self-hosted learning engine (free-recall + FSRS + blind grading) covered in `comparison.md`; the one tool philosophically aligned with campus, but it's an agent-CLI plugin, not a course system. *Worth knowing; see comparison doc.*

---

## 3. Market map: what exists, what campus covers, what it doesn't

The 2026 landscape is ~10 categories, and almost every product in it competes on the **same
upstream problem: getting your material in**. NotebookLM wants you to upload per notebook; Anki
wants you to build decks; Notion wants you to build pages; Elicit wants you to bring the question;
Knowt wants you to upload the PDF. Ingestion is the shared tax.

Campus is the only tool whose pipeline starts **before** that: Brightspace sync → SQLite spine →
AI digest → memory facts → course-aware chat. Every other tool's job begins where campus's job
ends. In market terms, campus occupies the one category with no student-side commercial
competition — **"student-side LMS intelligence"**. The institution-side systems (Brightspace/D2L,
Canvas) own the data but serve the institution; D2L's own AI assistant features are institution-
configured, not something you can point at your own study workflow. That's why every comparison
set ends up being a grab-bag of adjacent tools instead of direct competitors.

Campus's coverage of the map:

- **Owns outright:** category 1 (course/LMS hub) — nothing else here does deadlines, rubrics,
  content trees, and announcements from a live sync.
- **Partially covers:** category 2 (grounded chat — but no generated study aids), category 5
  (chat can be prompted to tutor), category 6 (Today/calendar/Workspace, single-user), category 7
  (digest + trawl, but no multi-step research agent), category 8 (audited notes, but not a general brain).
- **Doesn't touch at all:** flashcards/SRS (3), academic paper search (4), lecture capture (9),
  exam-prep/practice (10).

---

## 4. Where campus sits (positioning)

Campus is a **course-aware agent with a deterministic spine** — the only system in this landscape
whose AI is course-aware *by default*, with zero setup per class, because the course arrives via
sync instead of upload. That inverts the design of every mainstream tool: NotebookLM is a
research box you feed; Anki is a review engine you feed; Notion is a workspace you build. Campus
is a spine that feeds itself, plus a chat rail that always knows what's due, what changed, and
what the memory facts say. Its moat is the combination no commercial tool has — synced
deadlines/rubrics, audited AI writes, and a course memory card without any RAG infrastructure —
and its mirror-image weakness is that **everything downstream of the spine is absent**: no recall
practice, no scholarly search, no collaboration, no lecture capture, no offline mobile. It is
deliberately a "course brain", not a "life brain" — which is exactly why the alongside-tools list
below exists. The honest positioning line: *campus should win the 20 minutes around each course
(what's due, what changed, explain this); other tools should win the 20 minutes of deliberate
practice and the group work.*

---

## 5. Categories campus is entirely missing — worth adding to self-hosted?

| Missing category | What it would give a 3rd-year SE student | Worth adding to a self-hosted system? |
|---|---|---|
| **Flashcards / spaced repetition** | The single best-replicated learning intervention; review queues for memory facts | **Yes, later** — FSRS + quiz receipts are deterministic and fit the philosophy perfectly, but only after the digest has been producing facts for a while; until then Knowt/Anki cover it |
| **Academic / paper search** | Finding and citing real papers for technical-writing courses and the capstone | **No — don't build.** The value is a 100M+-paper index you cannot replicate; use Elicit/Consensus free tiers |
| **Mobile / offline access** | Reviewing slides and due-dates on transit without LAN | **Yes, sooner** — the PWA exists; offline-first is a real gap, and it's an engineering task, not an AI task |
| **Sharing / collaboration** | Group projects (3–4 per year at Western) | **No — don't build.** Auth + multi-user is a big lift for a tiny annual need; Notion's free student tier wins this |
| **Exam mode / practice tests** | Generating practice questions from synced content, blind-graded | **Maybe, later** — highest-value single addition, but it's a "year two" item; Knowt does it today from the same PDFs |
| **Lecture capture / transcription** | Turning recorded lectures into notes/digests | **Later (already parked as H5)** — whisper is self-hostable, but only worth it if you actually attend lectures that need it |
| **General second brain (non-course)** | Projects, internship prep, job hunt notes | **No — don't build.** Campus shouldn't become Obsidian; keep the course brain and the life brain separate |
| **Voice / quick capture** | Dictating thoughts into your notes | **No — don't build.** Phones and dictation apps do this; Mem/Reflect demonstrate the maintenance tax of a capture layer |

---

## 6. Tools worth USING alongside campus (short list)

Install these; don't build them. All have usable free tiers.

1. **Anki** — free — the spaced-repetition review queue campus doesn't have. (Later: CSV export of memory facts → deck is the one bridge worth building.)
2. **Knowt** — free — AI flashcards/study guides generated from the very PDFs campus already syncs, with mobile apps for transit review.
3. **Elicit** *or* **Consensus** — pick one, free tier — paper search and cited evidence for research-heavy courses and the capstone.
4. **Gemini Notebook (free tier)** — exam-crunch only — best-in-class generated quizzes/flashcards/audio overviews; only feed it materials you're comfortable with Google holding.
5. **Notion (Education Plus, free with school email)** — group projects and shared docs only; never your personal course brain.
6. **Perplexity (free)** — optional general lookup; campus chat + trawl already covers the coursework half.

Skip with confidence: Mem, Reflect, Feyn, Synthesis, Khanmigo (US-only), Otio, Scite, Socratic,
Taskade, Todoist AI, Rewind (dead), Quizlet (paywalled), and the whole lecture-capture set until H5.

---

## 7. Sources (researched 2026-08-05)

- **Gemini Notebook / NotebookLM:** glasp.co/articles/notebooklm-2026 (verified update timeline through Aug 2026: rename July 16 2026, Deep Research Nov 2025, 1M-token free Jan 2026, quiz/flashcard tracking Mar 2026, Plus $4.99 Jun 2026); notebooklm.google/plans (tiers: 50/100/300/600 sources, Deep Research meters).
- **Mem:** get.mem.ai (Workspace + Agent, Push-to-Remember); App Store listing (Mem Agent July 2026, pricing $12 Pro / $29–99 Proactive, 2-hr recording cap noted in reviews).
- **Reflect:** App Store listing (daily notes, voice transcription, E2E encryption, chat-with-notes; iPhone-first).
- **Anki:** studyglen.com/guides/best-spaced-repetition-apps (FSRS default since v23.10, Nov 2023); memormore.app/blogs/best-spaced-repetition-apps-2026 (AnkiMobile $24.99 one-time, steep learning curve); forums.ankiweb.net.
- **Feyn:** apps.apple.com/us/app/feyn-flashcards/id1533923364 (drawing-first SRS, free core, Pro $29.99/yr, iOS-only); feyn.app.
- **Knowt:** knowt.com (5M users, free learn mode/practice tests, AI PDF/video/lecture summarizers, Kai voice tutoring, AP/IB hubs, Quizlet import).
- **Elicit:** elicit.com + elicit.com/pricing (125M papers, 2M researchers, Basic free / Pro $49/mo); casrai.org dictionary entry (mid-2026 product surface).
- **Consensus:** consensus.app/pricing (free basic search + 15 Pro msgs/mo; Pro $144/yr; Deep $540/yr; up to 40% student discount; 5M users).
- **Perplexity:** perplexity.ai; finout.io/blog/perplexity-pricing-in-2026 (Max $200/mo; deep research tiers).
- **Khanmigo:** khanmigo.ai (learner access requires US billing address; Socratic guidance; Khan Academy library; Common Sense Media 4★; teacher tools free in 44 countries).
- **Synthesis:** synthesis.com/tutor (math tutor ages 8–14, born from SpaceX school); App Store (4.6★, 9.7k ratings).
- **Notion:** notion.com/pricing (AI bundled, agents at $10/1k credits); truescho.com Notion AI for Students 2026 (standalone AI add-on gone); notion.com/help/notion-for-education (Education Plus free with school email).
- **Otio:** otio.ai/pricing (all models every plan, no source caps, page/timestamp citations, Deep Research on free; Lite $7/mo, Go $18/mo, Pro $45/mo; 200k users; Zotero/OneDrive integrations; updated July 7 2026).
- **Obsidian:** obsidian.md; shadow.do/blog/best-ai-plugins-for-obsidian-2026 (Smart Connections local embeddings, Copilot vault chat); localaimaster.com/blog/local-ai-obsidian-integration (Ollama fully-local stack).
- **Rewind:** rewind.ai (now an AI-tools directory of 400+ free tools; original screen-memory app acquired by Dropbox 2024).
- **Sourcely:** sourcely.net (AI academic source finder from pasted text).
- **Campus:** ~/campus — docs/DESIGN.md, schema.sql, web/ + sync/ + api/; docs/research/comparison.md (previous pass).
