# Campus — Product Demo Video Plan

One file, everything needed to produce the video: concept, exact scene script with
frame timings, camera moves, captions, mock data, the mock-AI replay system, the
Remotion architecture, and the production pipeline.

**Deliverable:** a 82-second, 1080p60, caption-driven product demo that shows Campus
the way a senior engineer would demo it to a hiring manager — one storyline, real UI
rebuilt natively, zero slideshow pans.

---

## 1. Concept

**The one-line pitch of the video:**

> Brightspace scatters your term. Campus syncs it into one local desk — and the agent
> that sits on top of it has to show its work.

**The narrative spine (deliberately single-threaded):** the whole video follows
*one assignment* (CS 1100A · Assignment 1 — Control Flow, due Fri Aug 29):

1. **Ask** — "where does the syllabus mention late penalties?" → cited answer,
   file + line.
2. **Act** — "extend Assignment 1 by 2 days" → the due date visibly changes on Home,
   write lands in the audit log.
3. **Retain** — "quiz me on week 1" → blind-graded recall of that exact policy.

Ask → act → retain is Campus' whole thesis (agent that reads, writes audited, and
helps you remember) told through one object. Everything else (sync, content, schedule)
is the setup for those three beats.

**Tone & rules**

- Caption-first (videos autoplay muted in READMEs and portfolios). Every scene must
  make sense with sound off. An optional voiceover script is included for a narrated
  variant.
- Show the product within 8 seconds. No logo-only intro, no stock footage, no
  fake terminals.
- The UI is **rebuilt natively in Remotion**, not screenshotted (rationale in §3).
  Every pixel is vector-crisp; typing, streaming, tool chips and page transitions are
  real animations, not baked pixels.
- Honest mock: the fake agent replays the app's **real SSE event schema**
  (`token`, `tool_start`, `tool_end`, `done`) from a scripted transcript. The demo is
  a deterministic replay of the app's own protocol — worth saying out loud in the README.

---

## 2. What we show off (and what we deliberately don't)

| Show | Why |
| --- | --- |
| Home (digest, next 7 days, calendar, sync card) | The "one desk" promise, instantly legible |
| Sync engine (trigger → run log → sha256 skips → PDF→markdown) | The unglamorous moat; hiring managers respect reliability work |
| Course hub: Overview → Content → **pageless PDF / zen markdown** | The study experience; "pageless" is a differentiator nobody expects |
| Schedule (weekly timetable, Fall/Winter toggle) | Visual proof the store is structured, not a file dump |
| **Chat with tool steps, streaming, citations (file:line)** | The hero. Agent shows its work |
| Audited mutation + visible propagation to Home | "It doesn't just answer — it acts, and you can audit it" |
| Blind-graded quiz | A genuinely novel idea; memorable closer before the stack |
| End card: tests · CI · Docker · PWA | Engineering credibility in 4 words each |

| Skip | Why |
| --- | --- |
| Login screen | Zero information |
| Calendar page, More page | Calendar card on Home already covers it; pacing > completeness |
| Rubric grid, digest email, MCP client, `terminal_run`, `web_search` | Second-order features; each would cost 5–8s of runtime |
| Real Brightspace screenshots / real course data | Privacy + clean legal footing; the mock term below is fully fictional |

---

## 3. Production approach: native rebuild, not screenshots

The repo's current scaffold pans a camera over static PNGs (`public/frames/*.png`).
That caps the ceiling: stills can't type, stream, or change state, and pans over
bitmaps read as a slideshow.

**Decision: rebuild the app's UI as React components inside Remotion.**

- Crisp at any resolution (render a 4K master by `--scale=2`, downscale to 1080p).
- Typing, streaming, chips, transitions, highlight glows — all first-class animations.
- The "camera" is just transforms over live components; zooms never pixelate.
- The video regenerates as the app's design evolves; no stale screenshots.

Cost estimate: ~3.2k LOC of Remotion components (inventory in §9). The existing
`Zoom`, `Cursor`, `ToolChip`, `Pill` components are kept and adapted; the
`capture-frames` script is retired.

**Video specs**

| Spec | Value |
| --- | --- |
| Resolution | 1920×1080, master also rendered at `--scale=2` (4K) then downscaled |
| Frame rate | 60 fps |
| Length | 82 s (4920 frames) |
| Codec | H.264, yuv420p, CRF 17; silent master (autoplay-safe) |
| Audio | Optional music bed (§11); captions carry meaning regardless |
| Typography | Plus Jakarta Sans (via `@remotion/google-fonts`), JetBrains Mono for paths/code |
| Palette | App tokens from `global.css`: bg `hsl(250 14% 5%)`, card `hsl(250 12% 8%)`, primary `hsl(262 62% 71%)`, text `#ededed` / `#a1a1a3` / `#656566` |

---

## 4. Frozen clock & the mock term

All timestamps in the video derive from one frozen moment so relative labels
("1d ago", "due in 2 days") stay consistent:

> **Today = Thursday, August 27, 2026, 4:12 PM** (after the last class; Fall 2026,
> week 1 just ended). Calendar highlights the 27th. Announcement ages: 1d / 1d / 3d.

**Courses (from `seed/courses.example.json`, hero course re-colored for emphasis)**

| Code | Name | Term | Color (video) | Role |
| --- | --- | --- | --- | --- |
| CS 1100A | Introduction to Programming | 2026F | `#8b5cf6` violet | **Hero course** (matches app primary) |
| MATH 1600A | Linear Algebra for Engineers | 2026F | `#0ea5e9` sky | Sidebar texture |
| ENG 3300A | Software Engineering | 2026F | `#f59e0b` amber | Sidebar texture |
| CS 2200B / ENG 3400B / STAT 2400B | (Winter courses) | 2027W | teal/green/red | Only visible in Winter toggle flick, 0.5 s |

**Sessions (hero course):** LEC Mon/Wed 10:00–11:30 Room 1120 · LAB Fri 14:00–16:00 Lab A.
MATH: LEC Mon/Wed/Fri 8:30–9:30 · TUT Tue 16:00–17:00. ENG 3300A: LEC Mon/Wed 15:30–17:00 · LAB Thu 14:00–17:00 Lab D.

**Assignments**

| Course | Title | Due | Status |
| --- | --- | --- | --- |
| CS 1100A | **Assignment 1 — Control Flow** | Fri Aug 29, 23:59 | open → *extended to Aug 31 in Scene 7* |
| CS 1100A | Assignment 2 — Functions and Testing | Sat Sep 5, 23:59 | open |
| ENG 3300A | Lab Report 1 — Requirements | Sun Aug 30, 23:59 | open |
| MATH 1600A | Problem Set 1 — Vectors | Tue Sep 1, 17:00 | open |

**Announcements (CS 1100A)** — mirror the app's real demo content:
"Assignment 1 Q&A Session" (1d ago, "Q&A for Assignment 1 on Fri Aug 29, 4pm in Room 1120") ·
"Lab A moved to Lab C for Week 2" (1d ago) · "Welcome to CS 1100A" (3d ago).

**Content tree (CS 1100A)**

```text
2026F/CS1100A/content/
├── Module 1 - Course Overview/
│   └── syllabus.md            ← line 4: "Assignments submitted up to 48 hours
│                                 late incur a penalty of 10 percent per day."
├── Module 2 - Control Flow/
│   ├── lecture-03.pdf         (Loops & conditionals, 18 pages)
│   └── lecture-04.pdf         (Functions & testing, 22 pages)
└── Module 3 - Functions/
    └── lab-01.md
```

**Memory facts (CS 1100A)** — what the quiz draws from:
`late-policy`: "Late submissions accepted up to 48h, penalty 10% per day" (source: syllabus.md:4) ·
`logistics`: "Lab A moved to Lab C for Week 2" · `grading`: "Assignment 1 weighs 8%".

**Morning digest (Home card, typed in Scene 2)**

```text
• 3 deadlines in the next 7 days — Assignment 1 is Friday.
• 2 new announcements in CS 1100A — Q&A session Friday 4pm.
• Lab A is in Lab C for Week 2.
```

---

## 5. Scene-by-scene script (frame-exact, 60 fps)

Layout vocabulary: the app shell is centered at ~94% scale with a soft shadow over a
radial violet-on-near-black backdrop. Scenes declare which panes are visible
(sidebar is always visible, 260 px). `f=` frames from video start. Caption zone:
bottom-left, 96 px tall, never covered by zooms (safe-area rule in §7).

---

### S0 · Logo sting — f0–120 (0:00–0:02)

Black. The Campus wordmark (`web/public/logo-full.svg`, inlined as SVG paths) draws
itself via stroke-dashoffset over 45f, fills, then the tagline fades in beneath:

> **Your term. One desk.**

The wordmark's graduation-cap glyph gets a single violet glint sweep (masked gradient,
20f). Hard cut.

---

### S1 · The problem — f120–480 (0:02–0:08)

Three grey, deliberately-lifeless cards stack in with a dull 8f drop each (contrast
with the app's springy violet world):

1. **A breadcrumb grave:** `Content → Module 2 → Week 3 → lecture-04.pdf` — a small
   red counter chip reads "4 clicks deep".
2. **A PDF page** with a highlighted buried line: `due Aug 29 — see §3.2 for the late policy`
   and chip "deadline hidden in a PDF".
3. **An announcements feed** with one card falling off the bottom edge, mid-fade,
   chip "scroll past once, gone".

Captions (staggered):

| f in–out | Caption |
| --- | --- |
| 150–250 | Files four clicks deep. |
| 250–350 | Deadlines split across pages and PDFs. |
| 350–450 | Announcements you scroll past once. |

At f450: everything desaturates and slides away in one wipe → cut to the app.

---

### S2 · Home — the desk — f480–960 (0:08–0:16)

**Layout:** sidebar + Home grid. The shell scales in 1.05→1.0 (spring), sidebar items
stagger in (4f apart), then Home cards cascade: Digest, Next 7 days, Calendar, Sync
(6f stagger, spring 0.92→1.0).

- f620–760: the three digest bullets **type in** one per line (replay engine, §8).
- f760–840: camera pushes to **Next 7 days** (zoom to center `[0.42, 0.55]`, scale
  1.25). Rows light up sequentially: `Fri · CS 1100A LAB` → `Assignment 1 — Control
  Flow` (violet chip pulses once) → `Lab Report 1` → `Problem Set 1`.
- f840–960: hold; calendar card shows Aug 27 ringed; Sync card reads
  `Last run 27 Aug · success · 2 new files`.

| f in–out | Caption |
| --- | --- |
| 510–620 | Campus syncs Brightspace into one local desk. |
| 630–760 | A morning digest, then your next 7 days. |
| 770–940 | Everything local. Everything fresh. |

Cursor drifts toward **Schedule→Sync** in the sidebar during the hold (sets up S3).

---

### S3 · The sync engine — f960–1560 (0:16–0:26)

- f960–1000: cursor clicks **Sync** in the sidebar; content crossfades (8f) with a
  12 px rise.
- f1000–1100: Sync page settles. Header chips: `token valid · refreshed 2h ago` (the
  MFA nod) and `21 tables · SQLite WAL`.
- f1100–1160: cursor clicks **▶ Sync**; button presses (scale 0.97, 4f).
- f1160–1400: a run card grows; per-course log lines **type out** in JetBrains Mono:

```text
CS 1100A   14 files unchanged (sha256 skip) · 2 new · 1 updated   ✓
MATH 1600A 11 files unchanged (sha256 skip) · 0 new               ✓
ENG 3300A  9 files unchanged (sha256 skip) · 1 updated            ✓
announcements  3 fetched · 0 changes
```

  A small chip flips `sha256: unchanged → skip` with a violet flash as each ✓ lands.
  Progress bar 0→100% in 3 ticks.

- f1400–1480: one pipeline beat zooms in (scale 1.3 on the log area):
  `lecture-04.pdf → markdown · 38 ms/page · PyMuPDF, no OCR needed`.
- f1480–1560: a minimal architecture ribbon slides in under the log and holds:

```text
Brightspace ──(Playwright · MFA)──▶ SQLite (21 tables) + files ──▶ agent / PWA
```

| f in–out | Caption |
| --- | --- |
| 1010–1150 | Playwright handles the MFA login. |
| 1160–1390 | sha256 skips everything that didn't change. |
| 1400–1550 | PDFs become searchable markdown in milliseconds. |

---

### S4 · Course hub & the pageless reader — f1560–2160 (0:26–0:36)

- f1560–1620: cursor clicks **CS 1100A** in the sidebar (row highlight, violet dot
  pulse). Course hub loads; tab bar `Overview · Content · Assignments · Workspace`
  with Overview active; stat chips `4 files · 2 assignments` (matching the §4 tree).
- f1620–1700: Overview cards cascade: three announcements, then Upcoming (2 rows).
- f1700–1760: cursor clicks **Content** tab. File tree slides in:
  Module 1 (syllabus.md), Module 2 (lecture-03.pdf, lecture-04.pdf), Module 3 (lab-01.md).
- f1760–1860: cursor clicks `syllabus.md` → **zen markdown** view, pageless, single
  column; the view scrolls 200 px smoothly.
- f1860–1980: cursor clicks `lecture-04.pdf` → the **pageless PDF**: continuous
  reflowed text + one figure, no pager chrome. Camera zooms slightly (1.15) on the
  seamless scroll.
- f1980–2160: hold; a subtle comparison ghost flashes for 12f (paged view at 20%
  opacity sliding out) to sell "pageless".

| f in–out | Caption |
| --- | --- |
| 1580–1700 | Every course, exactly as it's organized. |
| 1710–1860 | Syllabus, lectures, labs — all local and searchable. |
| 1870–2140 | PDFs go pageless — no pager, just reading. |

---

### S5 · Schedule — f2160–2460 (0:36–0:41)

- f2160–2240: cursor clicks **Schedule**. The weekly grid's hour lines draw in
  (30f), then course blocks pop per color with 4f stagger: violet CS 1100A, sky
  MATH 1600A, amber ENG 3300A. Footer shows the three-course legend + `0.50` units.
- f2240–2300: **Fall · A / Winter · B** toggle flicks to Winter for 24f (teal/green
  blocks preview) and back — proof the whole year is in the store.
- f2300–2460: hold with a gentle push-in on Thursday's ENG 3300A lab block.

| f in–out | Caption |
| --- | --- |
| 2190–2320 | Your week, rebuilt from the sync. |
| 2330–2440 | Two terms, one timetable. |

---

### S6 · THE AGENT, part 1 — ask & cite — f2460–3360 (0:41–0:56) ★ hero

**Layout:** sidebar + **wide chat pane** (the course split; content pane slides in
only at the click-through, below). This is the longest scene; every beat is specified
in §8's replay script. Summary:

- f2460–2520: chat settles; input focused, caret blinking (30f cycle). Suggested
  prompt chip `where does the syllabus mention late penalties?` sits above the input.
- f2520–2760: the question **types character-by-character** into the input
  (47 chars, jittered cadence). f2760: Enter — user bubble slides in from the right.
- f2790–2970: steps chip appears: `⌘ 1 step · 1 tool call ▾` with a running spinner;
  it expands to show `content_grep  query:"late penalty" · course:"CS 1100A"`
  spinning → lands `1 hit · syllabus.md` with a green check (spring pop).
- f2970–3180: the answer **streams in word-chunks** (~60 chars/s):

  > Found it — from your CS 1100A syllabus (Late policy):
  >
  > ▎ "Assignments submitted up to 48 hours late incur a penalty of 10 percent per day."
  >
  > That's in `2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md:4` — want me to open it?

  The quote block's left bar draws in top→bottom as its text streams; the monospace
  path chip pops with a 1-frame violet flash when it lands.
- f3180–3240: camera pushes onto the citation (center `[0.68, 0.60]`, scale 1.35).
- f3240–3300: cursor moves to the path chip, clicks (ripple).
- f3300–3360: the **content pane slides in from the left** (chat compresses, exactly
  the app's split behavior), `syllabus.md` opens scrolled to **line 4**, which glows
  violet for 30f. Hold.

| f in–out | Caption |
| --- | --- |
| 2500–2760 | Ask in plain language. |
| 2790–2970 | It searches your actual files. |
| 2990–3180 | Answers cite the file — and the line. |
| 3210–3350 | Click the citation. See it yourself. |

---

### S7 · THE AGENT, part 2 — act & audit — f3360–3960 (0:56–1:06)

- f3360–3420: camera eases back to 1.0; input refocused.
- f3420–3620: typing: `extend Assignment 1 by 2 days — note "approved per email 2026-09-08"`
- f3650–3720: chips: `harness_list_assignments` (spinner→✓) then
  `mutate_update_assignment  #1 → Aug 31` (violet **write** icon, spinner→✓).
- f3720–3840: answer streams:

  > Done — Assignment 1 — Control Flow moved from Aug 29 to **Aug 31** and your note
  > "approved per email 2026-09-08" is saved. Marked as extended, logged to the audit trail.
- f3840–3960: **proof cut**: hard cut to Home, camera already pushed into Next 7
  days; the Assignment 1 row's due chip flips `Aug 29 → Aug 31` (violet flip
  animation, the "29" folds down, "31" folds up). Simultaneously a compact
  **audit card** slides in from the right:

```text
audit_log · write #412                       16:12:04
mutate_update_assignment  id=1
- due_at: "2026-08-29T23:59:59"
+ due_at: "2026-08-31T23:59:59"
+ notes:  "approved per email 2026-09-08"
```

| f in–out | Caption |
| --- | --- |
| 3430–3620 | It doesn't just answer. It acts. |
| 3650–3830 | Deadline moved — everywhere, instantly. |
| 3840–3950 | Every write lands in the audit log. |

---

### S8 · THE AGENT, part 3 — blind quiz — f3960–4440 (1:06–1:14)

- f3960–4020: back to chat (12f crossfade), type `quiz me on week 1`.
- f4020–4080: chip `quiz_start · CS 1100A · 1 fact` (spinner→✓).
- f4080–4140: a question card slides up:

  > **Q1** — What's the late-submission policy for Assignment 1?
- f4140–4260: the student's answer **types into an inline answer box**:
  `10% per day, up to 48 hours late`
- f4260–4320: chip `quiz_grade · blind` spins → lands.
- f4320–4440: a stamp slams in (scale 1.6→1.0, 8f, slight rotation −4°):
  **✓ correct** — with the kicker line beneath:

  > The grader saw only the answer key and your words — not this chat.

| f in–out | Caption |
| --- | --- |
| 3990–4130 | Quiz me — recalled from your course memory. |
| 4140–4310 | Graded blind, so it can't flatter you. |
| 4330–4430 | Substance counts. Vibes don't. |

---

### S9 · Proof & close — f4440–4920 (1:14–1:22)

- f4440–4560: on a dimmed, blurred Home backdrop, three proof chips cascade in:
  `25 pytest units · CI on every push` · `docker compose up — that's the demo` ·
  `PWA — installs, works offline`.
- f4560–4890: end card: wordmark (reusing S0's stroke animation, faster), tagline,
  repo line `github.com/HasNate618/Campus`, and stack chips:
  `Python` `FastAPI` `SQLite` `React 19` `Playwright` `Docker` + `MIT`.
- f4890–4920: 30f fade to black.

| f in–out | Caption |
| --- | --- |
| 4460–4550 | Reliable enough to trust with your term. |
| 4600–4880 | Campus — your term. One desk. |

---

## 6. Camera & motion language

**Camera** = a single `<Camera>` wrapper around the app shell (zoom/pan via transform,
spring-damped). Zoom targets are specified as `[centerX, centerY, scale]` in the
shell's normalized space.

| Beat | Frames | Target | Move |
| --- | --- | --- | --- |
| Home → next-7-days | 760–840 | `[0.42, 0.55, 1.25]` | push in, hold, no return (cut carries) |
| Sync log zoom | 1400–1480 | `[0.5, 0.62, 1.3]` | push in + pull back by 1540 |
| PDF pageless scroll | 1860–1980 | `[0.5, 0.5, 1.15]` | gentle push |
| Citation close-up | 3180–3240 | `[0.68, 0.60, 1.35]` | push in; ease out 3360–3420 |
| Due-date flip | 3840–3960 | `[0.42, 0.40, 1.3]` | pre-framed at cut |

**Rules** (what makes it feel "edited, not animated"):

- Max **one** active zoom at a time; every zoom ≥45f in, ≥60f hold, ≥30f out.
- Never zoom while text is mid-stream (exception: none. The citation push starts
  after the path chip lands).
- Springs only (damping 16–20, stiffness 90–160). No linear eases anywhere.
- Cuts on scene boundaries are **hard cuts**; within scenes, 8–12f crossfades with
  a 12 px rise.
- Card entrances: 6f stagger, scale 0.92→1.0 spring. Nothing fades in alone —
  things *arrive*.
- Safe areas: captions own the bottom 120 px; zoom centers never place critical
  content there.

**Cursor:** the existing `Cursor.tsx` (move + dwell + click ripple). Moves are
bezier-eased 15–20f, dwell 8–12f before click, ripple 10f.

---

## 7. Captions — master list

Style: bottom-left chip, `rgba(10,10,15,0.85)` background, 1px `rgba(255,255,255,0.12)`
border, Plus Jakarta Sans 600 at 30 px, key nouns tinted `#a78bfa`. Enter: 20 px rise

- fade over 8f; exit: fade 6f. Minimum on-screen time 1.4 s. Full list with timings is
inline in each scene above; the compiled order:

1. Files four clicks deep. / Deadlines split across pages and PDFs. / Announcements you scroll past once.
2. Campus syncs Brightspace into one local desk. / A morning digest, then your next 7 days. / Everything local. Everything fresh.
3. Playwright handles the MFA login. / sha256 skips everything that didn't change. / PDFs become searchable markdown in milliseconds.
4. Every course, exactly as it's organized. / Syllabus, lectures, labs — all local and searchable. / PDFs go pageless — no pager, just reading.
5. Your week, rebuilt from the sync. / Two terms, one timetable.
6. Ask in plain language. / It searches your actual files. / Answers cite the file — and the line. / Click the citation. See it yourself.
7. It doesn't just answer. It acts. / Deadline moved — everywhere, instantly. / Every write lands in the audit log.
8. Quiz me — recalled from your course memory. / Graded blind, so it can't flatter you. / Substance counts. Vibes don't.
9. Reliable enough to trust with your term. / Campus — your term. One desk.

**Optional voiceover script** (for a narrated variant; ≈150 wpm, fits the same cuts):

> S1: "Brightspace is where organization goes to die. Files four clicks deep, deadlines
> buried in PDFs, announcements that scroll away."
> S2: "Campus syncs all of it into one local desk — with a digest every morning."
> S3: "A Playwright-driven sync handles MFA, skips unchanged files by hash, and turns
> PDFs into searchable markdown."
> S4–5: "Every course is browsable, PDFs read pageless, and your week rebuilds itself."
> S6: "Then ask. The agent greps your actual files and cites the exact file and line."
> S7: "It can act too — extending a deadline propagates everywhere and lands in an
> audit log."
> S8: "And when you quiz yourself, grading is blind — it sees the key and your words,
> nothing else."
> S9: "Campus. Tested, containerized, installable. Your term, on one desk."

---

## 8. The mock-AI replay engine (typing & streaming)

The fake agent is not hand-keyed animation — it's a **scripted transcript replayed
through the app's real event protocol** (`agent/chat.py` emits `reasoning`, `token`,
`tool_start`, `tool_end`, `done` over SSE). A `useReplay(transcript, startFrame)` hook
drives all chat UI from one data file. This keeps the simulation faithful and makes
edits cheap ("change the question" = edit one array).

**Replay primitives**

| Primitive | Behavior |
| --- | --- |
| `TypeText` | Per-char input typing. Base 45 ms/char, ±25 ms seeded jitter (mulberry32, fixed seed → deterministic renders), +3f after `,`, +6f after `—`, +9f after `.`. Caret: 2 px violet bar, 30f blink, solid while typing. |
| `StreamText` | Markdown-aware word-chunk streaming, 2–5 chars every 3–4f (~60 chars/s). Partial markdown renders as plain text until its close token arrives (quote block paints when complete). |
| `ToolChipTimeline` | Chips enter with spring (stagger 12f), spinner while `running` (dashed arc, 28f/rev), morph to ✓ + result summary (e.g. `1 hit · syllabus.md`) with a 1-frame violet flash. |
| `CitationChip` | Monospace path chip; on land: 1-frame violet border flash, then subtle shadow. Clickable in the app; in video, cursor-clicked to trigger the content-pane slide. |
| `Cursor` | Existing component: move 15–20f bezier, dwell 8–12f, 10f click ripple. |

**Transcript — Scene 6** (events carry frame offsets relative to scene start f2460;
text abbreviated, full text in §5):

```ts
[
  { at: 300, event: 'user',         text: 'where does the syllabus mention late penalties?' },
  { at: 330, event: 'tool_start',  tool: 'content_grep',  args: { query: 'late penalty', course: 'CS 1100A' } },
  { at: 470, event: 'tool_end',    tool: 'content_grep',  summary: '1 hit · syllabus.md' },
  { at: 510, event: 'token',       text: 'Found it — from your CS 1100A syllabus (Late policy):' },
  { at: 555, event: 'token',       quote: 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.' },
  { at: 660, event: 'token',       text: "That's in ", then: 'chip:2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md:4',
                                   text2: ' — want me to open it?' },
  { at: 720, event: 'done' },
]
```

**Transcript — Scene 7**: user line as scripted; `harness_list_assignments` at +290
(✓ `#1 found`) → `mutate_update_assignment { id: 1, due_at: '2026-08-31T23:59:59',
note: 'approved per email 2026-09-08' }` at +360 (✓ `audited · write #412`) → answer
stream at +360→+480. The Home cut is a separate scene-local animation (due-chip flip),
not chat-driven.

**Transcript — Scene 8**: `quiz_start { course: 'CS 1100A', topic: 'week 1' }` →
question card (fact: late-policy) → typed answer → `quiz_grade { blind: true }` →
stamp `correct · "Substance there — 10%/day up to 48h."`

**Reading-speed check:** Scene 6's answer is ~230 chars over ~210f of streaming
(≈66 chars/s) — fast but legible at 1080p with the caption carrying the point; the
citation zoom + hold adds 180f of dwell on the money line.

---

## 9. Remotion architecture

```text
remotion/
├── Root.tsx                    # <Composition id="CampusDemo" 1920×1080@60, 4920f>
├── CampusDemo.tsx              # TransitionSeries of scenes; global caption track
├── theme.ts                    # tokens ported from global.css + spacing/type scale
├── data/demo.ts                # THE mock dataset + chat transcripts (§4, §8)
├── motion/
│   ├── TypeText.tsx  StreamText.tsx  ToolChipTimeline.tsx
│   ├── Camera.tsx              # zoom/pan wrapper (evolves Zoom.tsx)
│   └── Caption.tsx             # caption track + timing data
├── ui/                         # app rebuild (tokens-only inline styles, no Tailwind)
│   ├── Shell.tsx  Sidebar.tsx  TopTabs.tsx  Card.tsx  Chip.tsx  InputBar.tsx
│   ├── Home.tsx  SyncRun.tsx  CourseHub.tsx  ContentTree.tsx
│   ├── ZenViewer.tsx  PdfPageless.tsx  Schedule.tsx
│   ├── Chat.tsx                # bubbles, steps chip, quote block, citation chip
│   └── AuditCard.tsx  QuizCard.tsx
├── scenes/
│   ├── S0Logo.tsx S1Problem.tsx S2Home.tsx S3Sync.tsx S4Content.tsx
│   ├── S5Schedule.tsx S6Cite.tsx S7Act.tsx S8Quiz.tsx S9Close.tsx
└── components/                 # kept: Cursor.tsx, Pill.tsx; ToolChip.tsx → motion/
```

Notes:

- `@remotion/transitions` added for `TransitionSeries` (fade/slide). All other deps
  already present. Icons inlined as lucide SVG paths (MIT, tree-shakeable).
- Fonts via `@remotion/google-fonts` (bundled at render time, no network flakiness).
- Every scene is a pure function of `frame` + `data/demo.ts`; the only randomness is
  the seeded PRNG in `TypeText`.
- Chat scenes declare pane visibility (`['sidebar','chat']` → `['sidebar','content','chat']`)
  so the hero scenes read at 1080p without microscopic text.

**Build order (milestones, each ends in a draft render):**

1. **M1 — Skeleton:** theme, Shell, Camera, Caption track, S0 + S2 static. `--scale=0.5`
   draft. *Validates fonts, palette, pipeline in one day of work.*
2. **M2 — Replay engine + S6 (hero):** TypeText/StreamText/ToolChipTimeline, Chat UI,
   citation click-through. *The video is watchable at this point.*
3. **M3 — Remaining scenes:** S1, S3, S4, S5, S7, S8, S9.
4. **M4 — Timing pass:** caption rhythm, zoom holds, (optional) music beat alignment.
5. **M5 — Masters:** 4K→1080p downscale, hero still, README GIF, 20 s cutdown.

**Render commands**

```bash
npx remotion studio                                          # iterate
npx remotion render CampusDemo out/draft.mp4 --scale=0.5 --crf=28   # review
npx remotion render CampusDemo out/master-4k.mp4 --scale=2 --crf=17 --image-format=jpeg
ffmpeg -i out/master-4k.mp4 -vf scale=1920:1080:flags=lanczos -c:v libx264 \
       -crf 17 -pix_fmt yuv420p -movflags +faststart out/campus-demo-1080p60.mp4
npx remotion still CampusDemo out/hero-citation.png --frame=3210    # README hero
# README GIF: Scene 6, 12 s, 720 px, 12 fps, palettegen/paletteuse
```

(NixOS: renders run inside `nix-shell` — `REMOTION_CHROMIUM_PATH` already wired in
`shell.nix` and `remotion.config.ts`.)

---

## 10. Quality gates (check before calling it done)

- [ ] Every caption ≥1.4 s on screen; no caption under a zoom's critical content.
- [ ] Readability pass at 100% zoom on a laptop screen: chat text ≥13 px effective,
      mono paths ≥11 px effective.
- [ ] All dates consistent with the frozen clock (Aug 27, 2026; "1d/3d ago";
      Aug 29 → Aug 31 flip).
- [ ] Deterministic: two renders byte-identical (seeded PRNG, no `Date.now()`).
- [ ] Silent master plays correctly muted-inline (README test), `+faststart` set.
- [ ] Master ≤ 40 MB; GIF ≤ 8 MB.
- [ ] Side-by-side fidelity check vs. real app screenshots (sidebar order, chip
      shapes, tab labels) — it should look like the app, idealized.
- [ ] No real names, emails, course URLs, or Brightspace identifiers anywhere.

---

## 11. Sound (optional)

Master ships **silent** (autoplay-safe). For a narrated/music variant:

- Music: 88–96 BPM minimal electronic, no vocal samples (YouTube Audio Library /
  CC0 sources to keep the portfolio clean). At 90 BPM one bar = 160f — scene cuts at
  f480, 960, 1560, 2160, 2460, 3360, 3960, 4440 land within ±8f of bar lines; nudge
  scene boundaries ≤10f to snap exactly.
- Duck nothing; no SFX except two: a soft tick on the citation land (f3150) and a low
  thunk on the quiz stamp (f4320). Restraint reads as taste.

---

## 12. Risks & fallbacks

| Risk | Mitigation |
| --- | --- |
| Rebuild scope creep (~3.2k LOC) | M1–M2 gate: if the hero scene isn't working by then, switch to fallback below for non-hero scenes |
| 60 fps × 82 s render time | Draft at `--scale=0.5 --crf=28`; final only after M4; concurrency 4 already configured |
| Font/layout drift from real app | Fidelity checklist (§10) against live screenshots each milestone |
| NixOS chromium quirks | Already solved (`REMOTION_CHROMIUM_PATH` in shell.nix + remotion.config.ts) |
| **Fallback approach** | Extend the existing `capture-frames` Playwright script to shoot the *real app* in many scripted states (chat mid-stream can't be captured live — overlay simulated typing on real input-field screenshots). Visual fidelity 100%, animation ceiling lower. Keep as plan B only. |

---

## 13. Bonus outputs (cheap once the composition exists)

- **20 s cutdown:** the same composition parameterized with a scene subset
  (S2 → S6 → S7 → S9) for README autoplay and social embeds.
- **Hero stills:** citation close-up (f3210), due-date flip (f3880), schedule
  (f2200) — README assets and portfolio page headers.
- **Poster frame** for the video embed (f4560, end card).
