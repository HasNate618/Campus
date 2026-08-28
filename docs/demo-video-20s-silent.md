# Campus — 20s silent showcase storyboard

No talking. No voiceover. Just a tight, music-driven screencast that a recruiter can watch on mute in 20 seconds and understand what you built, why it matters, and that it actually works. Designed for seeded data (no live term) and to highlight the two things that make Campus not just another chat wrapper: local sync + citation-required answers.

## Constraints you said

- 20 seconds total, no talking, pure showcase
- Seeded demo only (CS 1100A / MATH 1600A etc.), live Brightspace sync comes in September
- Must feel useful, not feature-listy. Main usefulness = ask my courses anything and get the exact file line
- Must include well thought out mock data that makes queries hit cleanly

## Mock data this storyboard assumes (already written to disk)

If you record tomorrow, use the pack in `docs/demo-mock-data.md` and the rows already inserted into `data/harness.db`:

- Courses: CS 1100A (Introduction to Programming, J. Morgan, #64748b), MATH 1600A (R. Patel, #0ea5e9), ENG 3300A (K. Wright, #f59e0b)
- Files:
  - `school/2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md` with the exact line: "Assignments submitted up to 48 hours late incur a penalty of 10 percent per day."
  - `school/2026F/CS1100A/content/Module 2 - Intro/lecture-01.md` with dynamic typing note
- Assignments (all drive the "Next 7 days" grouping so Today is not empty on Aug 26):
  - CS 1100A Assignment 1 — Control Flow — due 2026-08-29 23:59 (in 3 days)
  - ENG 3300A Lab Report 1 — Requirements — due 2026-08-30 23:59
  - MATH 1600A Problem Set 1 — Vectors — due 2026-09-01 17:00
  - CS 1100A Assignment 2 — Functions and Testing — due 2026-09-05 (just outside 7 days)
- Events table also has 3 class events in the next 7 days so the timetable is not bare
- Announcements: 2 short lines so the digest card has markdown to render

Rehearse the two queries below against this exact wording until the citation is perfect, then lock the files and do not edit between rehearsal and recording.

---

## Overall specs

- **Runtime:** 20.0 seconds exactly. Export 1920x1080, 60fps, H.264 at 12 Mbps, under 30MB so LinkedIn and GitHub do not re-encode to mush. Browser at 125% zoom so a phone viewer can read it.
- **Tool:** Screen Studio on macOS or OBS with cursor smoothing + auto-zoom on click. Clean browser profile, light mode, bookmark bar hidden, extensions hidden. Cursor size +1.
- **Audio:** No voice. One lo-fi or soft ambient track at -26 dB, ducked to -32 dB when captions change. No click sounds. Add a very quiet pop ( -34 dB) on each hard cut if you want rhythm.
- **Captions instead of voice:** All narration is burned-in pills. White text on charcoal rounded pill, 20px, centered bottom, 72% opacity background. Keep each pill on screen 2.8 to 3.5 seconds, no more than 9 words per pill so it is readable on mute.
- **Movement rule:** No screen sits still for more than 3 seconds without a cursor move, scroll, or zoom. Calm cursor: move, pause, click. Never circle.
- **Transitions:** Hard cuts only. No crossfades. Add chapter label pills top-left (10px, muted) for scrubbers: `01 Today · 02 Files · 03 Ask`
- **Seeded disclaimer:** One elegant line only, 11px bottom-left for 3 seconds at the start: `Seeded demo — Fall 2026 samples · Full Brightspace sync live in September`. Then never mention it again.

---

## Second-by-second flow

### 0.0 – 2.0s — Cold open on product, not a title card

**Screen:** Already on Today page, Campus wordmark visible in left header. Do not show desktop, do not show VS Code. The first pixel is the product.

**Action:** Static for 0.6s, then a slow cursor hover across the sidebar showing three course colors (CS 1100A gray, MATH 1600A blue, ENG 3300A amber) and back to Today. No clicks.

**Caption pill (0.5 – 2.0):**
`Campus — your courses, actually findable`

**Small footer (0.5 – 3.5, 11px muted):**
`Seeded demo · No LMS needed · github.com/HasNate618/Campus`

**Audio:** Music starts quietly at 0.0, establishes tone.

### 2.0 – 6.0s — Today: week at a glance

**Screen:** Today page, wide layout. Digest markdown card on left, Next 7 days grouped by day on right.

**Action:**

- 2.0 – 3.2: Slow scroll to reveal digest text fully. Let the zen markdown breathe for 1 second. The digest should be 4 to 6 lines, not a wall.
- 3.2 – 6.0: Hover over Next 7 days rows so course codes and violet `assignment` chips are readable. Pause on `CS 1100A — Assignment 1 — due Aug 29` for emphasis.

**Caption pill (2.4 – 5.5):**
`Your week at a glance — digest + next 7 days`

**Why this first:** Every recruiter was once a student who panicked about "what is due this week." Immediate empathy before any technical brag.

**Visual note:** If your digest text is longer than 6 lines, trim the seeded announcement that feeds it. White space reads as polish.

### 6.0 – 10.0s — Course hub: proof the sync is real

**Screen:** Click `Courses` grid → click `CS 1100A` tile.

**Action:**

- 6.0 – 7.0: Click Courses, grid with 3 course cards is visible.
- 7.0 – 8.2: Click CS 1100A. Module list expands. Hover over `Module 1: Course Overview` to show topics: `Syllabus`, `Course Schedule`, `Grading Policy`. Hover over `Module 2: Intro to Programming` to show `Lecture 01 Slides`, `Reading: Variables`.
- 8.2 – 10.0: Click `Syllabus` file. Vendored pageless PDF viewer / markdown view opens. Slow scroll 1 page until the late policy line is centered. Highlight that exact sentence with a soft yellow rounded rectangle at 18% opacity for 1.2 seconds (do not use an arrow).

**Caption pill (6.5 – 9.5):**
`Every Brightspace file, synced locally — sha256, only what changed`

**Technical drop:** The pill is the capture. Say sha256 once, visually, and move on. This tells an engineer you handled change detection, without slowing the video.

### 10.0 – 15.8s — Hero: ask in plain English → exact citation (the rewind moment)

**Screen:** Switch to Chat, course-scoped to CS 1100A. Chat input is focused. Prior chat is empty or shows one earlier "what is due" answer to prove it is not a mock.

**Action:**

- 10.0 – 11.8: Type at human speed (45 wpm, not pasted) into the input:
  `where does the syllabus mention late penalties`
  Let each character appear. This typing is what proves SSE is real. Do not cut it.
- 11.8 – 13.0: Hit send. Show the streaming tokens. Leave 0.8s of silence after the tool call resolves before the answer streams — that beat is where credibility lands.
- 13.0 – 15.8: Answer streams in and settles with citation. The exact text you want:
  > "Syllabus section Late policy: 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.' [Source: 2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md:4]"

  When it lands, auto-zoom to the citation line. Highlight the sentence with the same yellow rectangle as before, now in the chat bubble, for 1.8 seconds.

**Caption pills (two, sequential):**

- (10.8 – 13.2): `Ask in plain English`
- (13.4 – 15.8): `Get the exact line — with citation, not a guess`

**Why this ordering:** You just showed where files live, so the viewer is primed to ask "can it find anything?" The hardest query type is an exact phrase that embeds poorly. You answer it verbatim and prove the hybrid `instr()` lexical boost story without ever saying the word embedding.

**What not to do:** Do not ask "explain late penalties" — that returns paraphrase. Must ask "where does the syllabus mention..." to force citation.

### 15.8 – 18.6s — Second proof: knows what is due

**Screen:** Still in Chat.

**Action:**

- 15.8 – 16.8: Type the second and final query:
  `what's due this week?`
- 16.8 – 18.6: Stream the answer: a short list with two items, each with course color chip and due date:
  - `CS 1100A — Assignment 1 — Control Flow — due Aug 29`
  - `ENG 3300A — Lab Report 1 — Requirements — due Aug 30`

  If the agent returns tool call details, let one `harness_list_assignments` line be briefly visible — engineers will catch it and know it is not prompt hallucination.

**Caption pill (16.2 – 18.6):**
`Knows what's due — no tab hunting`

**Pace:** This segment is faster than the previous. No highlight needed. The list itself is the proof.

### 18.6 – 20.0s — Close on the product

**Screen:** Cut back to Today, slightly zoomed out so the full app shell is visible. No new interaction.

**Action:** Static hold. Bottom-center, a clean white rounded card fades in and holds for the final 1.4 seconds. No animation beyond a soft fade.

**Card text:**

```
Campus
Offline-first study system
github.com/HasNate618/Campus
```

**Caption pill (18.8 – 20.0, smaller, muted):**
`Built with SQLite · 19 tools · sha256 · audited writes`

**End frame:** Hold Campus wordmark on white for 0.6s of silence, then cut to black. Do not end on code or terminal.

---

## Shot checklist — do these the evening before you record

- [ ] Regenerate `data/harness.db` assignments so due dates are +3 and +6 days from recording date (already done for 2026-08-26, redo if you record later)
- [ ] Verify `syllabus.md` contains exactly "Assignments submitted up to 48 hours late incur a penalty of 10 percent per day." — one typo breaks the lexical hit
- [ ] Seed the three markdown files under `school/` and ensure `files` table has `processed=1` (already done)
- [ ] Rehearse both queries until citations are perfect, then lock the seed — do not change data between rehearsal and take
- [ ] Open app at `http://localhost:8087`, set browser to 125% zoom, light mode, hide bookmarks, use a clean profile
- [ ] Record 3 full takes at 60fps. Pick the take where the chat streams without stutter
- [ ] Export master 20.0s H.264 + a 3-still pack: Today.png, CourseHubWithPDF.png, ChatCitation.png at 1280x720 for the README table
- [ ] Add first line to README preview after export: replace placeholder table cells with `![Today](docs/images/today.png)` etc.

## What to delete if you need 15 seconds instead

Cut the second query (15.8 – 18.6) and extend the hero citation hold to 4 seconds. Never cut the syllabus → chat citation sequence; that is the entire differentiation.

## Stretch when term goes live (add +8 seconds after September)

Insert between current 15.8 and 18.6: a 3-second terminal capture of `python -m sync sync` showing `files_new: 3, files_changed: 1, announcements_new: 1` and a fresh announcement appearing at the top of the Course hub. Caption: `Live: D2L REST + Playwright MFA · real sync, same citation guarantee`. Then continue to "what is due this week?" This proves the pipeline you demoed with seeded data is the same one that hits Brightspace.
