# The 2026 SE Student's AI-Assisted Week — Workflows, Pain Points, and Where Campus Fits

**Date:** 2026-08-05 · **Author:** research pass (grounded in live web research — see Sources)
**Audience:** Nate (Western SE, 3rd year), for understanding *how* students actually use AI week-to-week.
**Relationship to `comparison.md`:** that report was a feature menu (what tools offer vs. campus). This one
is about the *workflow* — the shape of a real week, the recurring pain points, and the habits worth
adopting. No feature recommendations; behaviors and priorities only.

> Working assumption: a 2026-27 week looks like — lectures with slide decks, labs, C#/Java coding
> assignments, group projects (teams, contracts, deliverables), exam season, deadlines. AI use is now
> the default operating mode, not an add-on.

---

## 1. The baseline: AI use is near-universal and mainstream (2025–2026 data)

| Stat | Source |
|---|---|
| 95% of undergraduates use AI in at least one way; **94% use it for assessed work** | HEPI Student GenAI Survey 2026 (n=1,054, UK, Dec 2025) |
| **90%** of college students use AI in class at least occasionally | Instructure poll, July 2026 (n≈1,100) |
| 73% of graduating seniors used GenAI for coursework; **top uses: research a topic (60%), brainstorm (57%), study for exams (57%)**; only 30% for code generation | UCLA Class of 2025 Senior Survey (n=6,639) |
| Most popular academic uses: **explaining concepts (58%), summarising articles (48%), suggesting research ideas (41%)**; only 18% paste AI text directly into assessments | HEPI 2025, via Turnitin synthesis |
| 12% now include AI-generated text directly in assessed work — up from 3% (2024) and 8% (2025) | HEPI 2026 |

Two things stand out. First, the *dominant* student uses are comprehension and exam prep, not
ghostwriting: students use AI as a 24/7 tutor, summariser, and quiz generator. Second, adoption is
well ahead of institutional support — only ~36% of students feel their institution encourages AI use,
and only ~38% are provided tools (HEPI 2026). **Students are mostly building their own stacks, alone.**

---

## 2. The common tool stack: five slots, each with a default

Student workflows in 2025–26 consistently decompose into five tool slots (triangulated from the XDA
2026 student-tool shootout, r/Anki / r/studytips / r/notebooklm threads, Hacker News, and the survey
data above):

1. **The general chatbot** (ChatGPT / Gemini / Claude — the universal default). Explaining concepts,
   "pretend to be my TA," practice problems, brainstorming, syntax questions, filling gaps *not* in
   course materials. 2026 versions ship student modes (ChatGPT Study & Learn, Gemini Guided Learning,
   Claude Learning Mode) that nudge toward Socratic guidance instead of direct answers.
2. **The source-grounded study tool** (NotebookLM / Gemini Notebook — the 2025–26 breakout). Upload
   lecture slides, PDFs, notes, YouTube links; chat with numbered citations, generate flashcards,
   quizzes, study guides, mind maps, and audio-overview "podcasts." The XDA 2026 test is explicit:
   **NotebookLM beats ChatGPT/Claude/Gemini for studying material you already have; general chatbots
   win for questions *beyond* your sources.**
3. **Spaced repetition** (Anki, or Anki-style quizzing via the chatbot). The perennial exam-season
   slot. The common pairing: *NotebookLM generates the cards, Anki schedules the reviews*; or "I just
   let ChatGPT quiz me Anki-style on topics I'm learning" (HN). Retention is the goal AI summaries
   don't give you.
4. **The notes app** (Obsidian, Joplin, Notion + AI). Local-first markdown notes as the searchable
   spine; AI plugs in via chat, graph plugins, or export from the study tool ("Gemini Notebook produces
   Cornell notes I paste into my notes app").
5. **The coding agent** (Copilot, Cursor, Claude Code, Codex). Near-universal among CS/SE students —
   and now *free*: GitHub Copilot Student plan (rebranded March 2026) and Cursor Pro for a year via
   student verification. Used for scaffolding, boilerplate, debugging, tests, and "whip up a React
   framework" (see §4).

**Where campus sits in this map:** campus's per-course chat + Brightspace content = the source-grounded
slot (slot 2) *plus* the LMS spine no mainstream tool has (deadlines, rubrics, groups, announcements).
The slots campus does *not* cover: spaced repetition (slot 3) and the general chatbot (slot 1) — which
the research says students need precisely because source-grounded tools are useless for
"what the prof said in class but isn't on the slides."

---

## 3. A week in the life (grounded in the research)

- **Monday lecture, databases (SE 3309A):** slides dropped to Brightspace. That night: upload slides to
  the study tool, ask for a summary + flashcards; the chatbot fills in "what the prof said about
  normalization that isn't on the slide" — the exact NotebookLM-vs-chatbot split described above.
- **Wednesday lab (OS, SE 3316A):** stuck on a C# concurrency bug. Ask the coding agent for an
  explanation first, then a fix; paste the error, get a suggestion, apply it, run tests. Research note:
  this is the *incremental* mode (L2) where students report real benefit — not first-exposure learning.
- **Thursday group project standup (teams, contracts, deliverables):** two teammates push AI-generated
  code they can't explain. The XDA author (herself a CS student) describes this as routine: "group
  projects where some teammates can't explain what they turned in." Team-dynamics research confirms
  free-riding remains the top SE-course problem — AI makes it *easier* to contribute volume without
  understanding.
- **Friday: assignment due.** Deadline crunch — the AI digest/agenda becomes the triage tool; "saving
  hours of tedious work" is the #1 cited benefit (HEPI 2026: 49% say AI improved their experience
  "particularly by saving time").
- **Exam season:** the stack flips to flashcards → spaced repetition → closed-book practice. The
  research is blunt that *this* is where over-reliance backfires: in a large RCT, students with
  unrestricted AI scored +48% on practice but **−17% on exams once AI was removed**; guardrailed
  (hints-not-answers) AI did not have this effect.

---

## 4. What AI coding agents are actually good and bad at for coursework

The clearest evidence comes from a 16-student interview study of SE students (Choudhuri et al., ICSE
2025) and the NUS-Google white paper on reshaping CS education (arXiv, June 2026):

- **Where agents genuinely help (student-reported):** incremental learning (clarifying a confusing
  lecture concept) and *initial* implementation — "whip up boilerplates," set up frameworks, get a
  code structure to start from, brainstorm approach. This is the "AI as junior engineer" sweet spot:
  boilerplate, simple bugs, test scaffolding, docs.
- **Where agents actively hurt:** learning a concept from scratch (novices can't judge output quality —
  "if you don't understand the concept, you can't use AI for it") and *advanced* integration —
  orchestrating code across files/services, debugging real codebases. Students report agents "break
  the codebase," loop on the same wrong answer, and eat 30+ minutes of prompt-refinement.
- **The measurable quality cost:** a large-scale causal study of Cursor adoption found short-term
  velocity up but a *persistent* increase in static-analysis warnings and code complexity — i.e.,
  technical debt compounds when nobody reviews the agent's output. A controlled trial of experienced
  devs found they were 19% *slower* with AI while believing they were 20% faster.
- **Why it matters for coursework:** Western CS's scholastic-offence rules treat "code from an external
  source where a student's own code is expected" as an offence (first offence = zero on the
  assignment), and Western now requires every course outline to state an AI policy (allowed / limited /
  prohibited). Meanwhile assessment is shifting toward *process* — reflections, vivas, presentations,
  even submitting AI-interaction history. **The student who can't explain their agent's code is the one
  who fails the viva.**

---

## 5. The recurring pain points (in priority order, per the research)

1. **Verification / "it sounds confident when wrong."** 65% of both students and instructors say this
   (Instructure 2026); 51% of students say hallucinations discourage them from using AI (HEPI).
   Student-reported failure mode: "I ended up learning the wrong things." The working pattern among
   successful students is *triangulation* — AI output checked against docs, Stack Overflow, YouTube,
   or the course materials. This is the single most-cited friction point in every study.
2. **The context gap.** Students' #1 self-reported struggle: giving the AI enough course context to be
   useful ("my biggest challenge is asking it the right questions"; "providing enough context… and
   communicating my needs"). Course-grounded tools exist precisely because of this. It's also why
   domain knowledge still matters: you can't direct an AI usefully on a topic you don't understand.
3. **Exam prep / illusion of competence.** Studying for exams is a top-3 use case (57%, UCLA), but
   re-reading AI summaries ≠ retention. The RCT evidence (practice +48%, exam −17%) is the strongest
   finding in the whole literature: **retrieval practice under exam conditions is the anti-crutch.**
4. **Academic-integrity ambiguity.** ~half of students avoid legitimate AI use out of fear of false
   accusation (53% HEPI / 47% Turnitin); 76% believe detection tools will flag them. Per-course rules
   (Western's model) reduce this, but "inconsistent between courses" is itself a complaint.
5. **Group coordination.** Free-riding and unexplained AI contributions are the new team-project
   failure mode; demos and vivas expose them. The "junior engineer" dynamic means one member can
   generate a week of apparent output in an evening — and the team inherits code nobody owns.
6. **Deadline management.** AI is bought with time ("saves hours") but also spends it: prompt loops,
   re-doing broken AI code from scratch, task abandonment on advanced integration. The plan-then-
   execute discipline (outline first, then AI-assisted execution) is what the data rewards.
7. **Skill erosion anxiety.** 59% of students worry AI reduces their critical thinking (Turnitin);
   students themselves describe the crutch ("I'm not using my brain at all"). This is the tension
   campus's audit trail — knowing exactly what the AI wrote and what you wrote — directly addresses.

---

## 6. Where campus fits — and where the gaps are

**Campus already covers** the slots that mainstream tools handle poorly for this workload:
- **LMS spine** (deadlines, rubrics, group categories, announcements) — no mainstream study tool has
  any of this; it's the "source of truth" layer the rest of the stack lacks.
- **Source-grounded per-course chat** (the NotebookLM slot) — grounded in *actual* Brightspace content,
  with the memory card keeping it course-aware without any RAG.
- **Audited workspace** — the one thing that answers both the integrity-anxiety pain point (a
  first-party record of what AI wrote vs. what you wrote) and the process-assessment shift (reflections
  write themselves from the audit log).
- **Calendar / deadlines / digest** — the triage layer for the deadline crunch.

**Gaps relative to the observed stack** (noting them for awareness, not as a build list):
- **No spaced-repetition slot** — the exam-season behavior (flashcards → Anki-style review) has no
  campus equivalent; retention still lives outside campus.
- **No "beyond sources" general-chatbot slot** — campus chat is course-grounded by design; the
  research says students need *both*.
- **No citation click-through** in chat answers (grounded, but not inline-cited like NotebookLM) —
  the #1 verification pain point.
- **No group-work support** — campus knows the groups and rubrics but has no role in team coordination,
  which is where the biggest new failure mode (unexplained AI code) lives.
- **No exam-prep mode** — no practice-quiz generation or free-recall workflow.

---

## 7. Practical observations for your workflow (5–8)

These are behaviors to adopt, not features to build.

1. **Run campus as the NotebookLM slot and keep one general chatbot for beyond-source questions.**
   Use campus chat for anything answerable from course material (slides, assignments, rubrics) — it's
   grounded and course-aware. Use a general chatbot (Claude/ChatGPT) for "the prof said something in
   lecture that isn't on the slides." Splitting these two is the single most consistent pattern in the
   2026 student stack.

2. **Pair campus with Anki (or Anki-style quizzing) for exam season — don't try to make campus do
   retention.** Exam prep is a different mode: generate flashcards/practice questions from course
   content via campus chat, then review them on a spaced-repetition schedule. The RCT evidence
   (+48% practice, −17% exam with unrestricted AI) says the *retrieval* step is where learning
   happens — summaries alone are the crutch.

3. **Adopt the two-source verification rule for anything you'll be examined on.** Research students'
   top failure mode is "learning the wrong thing" from confident AI output. Cheap discipline: every
   AI claim you intend to remember gets cross-checked against the actual slide/PDF in campus's viewer
   (or a second source). Campus makes this a 10-second operation instead of a research project.

4. **Know the per-course AI policy before using agents — and keep the audit trail as your defense.**
   Western requires every course outline to state whether AI is allowed/limited/prohibited; Western CS
   treats "code from an external source where your own code is expected" as a scholastic offence with a
   zero on first offence. Check the policy per course (it lives in the syllabus campus syncs), and
   treat campus's audited AI-write log as your first-party record if a question ever comes up — that
   anxiety is real for ~half of students.

5. **Use coding agents only in the modes where they help: incremental clarification and initial
   scaffolding — never first-exposure learning.** Agent-on-day-one for a concept you don't know = the
   documented path to illusions of competence ("if you don't understand the concept, you can't use AI
   for it"). For algorithms/data-structures (SE 3310A/3351A) and OS (SE 3316A): attempt the problem,
   then use the agent to scaffold, explain, and debug *your* approach. Treat the agent as a junior
   engineer you supervise — review every diff, run the tests, and never merge code you can't explain.

6. **For group projects, set AI-use rules in the team contract up front.** The new team failure mode is
   volume-without-understanding: teammates who can't explain the AI code they contributed, exposed at
   demos/vivas. Agree in the contract (before deliverables) on what's allowed, who owns each module,
   and that every member must be able to walk through their own code. Campus's group/rubric data tells
   you what's actually assessed — align the rules to that.

7. **Keep a single searchable notes file per course in the campus workspace, and write the final
   version in your own words.** Every student stack has a notes-app slot; the notes that survive exam
   season are the ones *you* wrote (AI as first draft, you as editor). The audit trail doubles as your
   process record — newer SE assessment is increasingly "reflection + AI-use history," and you'll have
   it already written.

8. **Let the AI digest/calendar be your triage, not your memory.** The deadline crunch is the #1 place
   AI "saves hours" — but the documented failure mode is task abandonment on advanced integration.
   Use the digest to plan the week (what's due, what's new), then execute in the order the calendar
   says, with the agent used for scaffolding and debugging rather than whole-deliverable generation.

---

## Sources

- HEPI / Kortext, *Student Generative AI Survey 2026* (HEPI Report 199, survey Dec 2025, n=1,054):
  https://www.hepi.ac.uk/reports/student-generative-ai-survey-2026/
- UCLA Center for the Advancement of Teaching, *Generative AI Use & Perspectives from the Class of
  2025* (Senior Survey module, n=6,639): https://teaching.ucla.edu/news/ucla-student-ai-use-perspectives/
- Instructure poll via Higher Ed Dive, "90% of students use AI in the classroom" (Jul 2026):
  https://www.highereddive.com/news/90-of-students-use-ai-in-the-classroom-instructure-poll-finds/825714/
- Turnitin, "How students really use generative AI in 2025" (synthesis of HEPI 2025, Turnitin/Vanson
  Bourne, Common Sense Media/Hopelab): https://www.turnitin.com/blog/what-2025-generative-ai-trends-reveal-about-student-behavior
- R. Choudhuri et al., *Insights from the Frontline: GenAI Utilization Among Software Engineering
  Students* (ICSE CSEE&T 2025; 16 reflective SE-student interviews):
  https://arxiv.org/abs/2412.15624
- *Reshaping Undergraduate Computer Science Education in the Generative AI Era* (NUS–Google white
  paper, arXiv Jun 2026; includes Bastani et al. guardrail RCT, Becker et al. productivity RCT, He et
  al. Cursor-adoption study, Brynjolfsson et al. entry-level employment data):
  https://arxiv.org/html/2606.07545v2
- M. Faisal (CS student & tech journalist), "I tested NotebookLM, Gemini, Claude, and ChatGPT for
  studying" (XDA, Mar 2026): https://www.xda-developers.com/tested-notebooklm-gemini-claude-and-chatgpt-for-studying/
- Western University AI governance — per-course Statement on AI use in course outlines; academic
  integrity / scholastic offences: https://ai.uwo.ca/governance/policies.html
- Western CS, *Scholastic Offenses* (external-source code rule; first-offence zero):
  https://www.csd.uwo.ca/undergraduate/current/policies/scholastic_offenses.html
- GitHub Education — Copilot Student plan (Mar 2026):
  https://github.com/education/students ; Cursor for students: https://cursor.com/students
- Pearson, *Student AI Tracker* (Spring 2025): "early experimentation transitioning toward stable,
  preferred use cases" (PDF, plc.pearson.com)
- Community practice threads: r/Anki + NotebookLM pairing (Dec 2025), r/studytips "what tools do you
  swear by" (Jul 2025), Hacker News "Spaced repetition systems have gotten better" (May 2025), r/CS
  "no one I know actually writes code anymore" (Jan 2026)
