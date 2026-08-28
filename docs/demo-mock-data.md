# Demo mock data pack — 20s silent showcase

This pack is designed for a 20-second no-talking video. Every line of text is chosen to be readable on a phone in 1.5 seconds and to make the two hero AI queries hit verbatim. All dates are relative to today (2026-08-26) so Today and Chat both look alive.

## Seeded courses (already in courses.example.json, keep these)

- CS 1100A — Introduction to Programming — J. Morgan — #64748b — term 2026F — LEC Mon/Wed 10:00-11:30 Room 1120 — LAB Fri 14:00-16:00 Lab A
- MATH 1600A — Linear Algebra — R. Patel — #0ea5e9 — term 2026F — LEC Mon/Wed/Fri 08:30-09:30 Room 1010
- ENG 3300A — Software Engineering — K. Wright — #f59e0b — term 2026F — LEC Mon/Wed 15:30-17:00 Room 1210

These three give you three colors and a full weekly timetable.

## Files to create / ensure exist

Place markdown siblings next to the PDFs so search and the viewer both work. Keep file names short so the citation looks clean in chat.

### 1) school/2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md

```markdown
# CS 1100A — Syllabus — Fall 2026

## Late policy
Assignments submitted up to 48 hours late incur a penalty of 10 percent per day. After 48 hours, submissions are not accepted without an approved extension.

## Grading
Assignments 30%, Labs 20%, Midterm 20%, Final 30%. All grades posted on Brightspace.

## Office hours
Tuesdays 2pm-4pm in Room 1120. Email j.morgan@uwo.ca for appointments.

## Required text
Downey, Think Python, 2nd edition. Available as PDF in Module 1.
```

Why this exact first sentence: It is the line the lexical boost needs to surface. Short, exact, 18 words. Chat query "where does the syllabus mention late penalties" will cite this verbatim.

### 2) school/2026F/CS1100A/content/Module 2 - Intro/lecture-01.md

```markdown
# Lecture 01 — Variables and Control Flow

Python variables are dynamically typed. Assignment uses = and comparison uses ==.

Example:
x = 5
if x == 5:
    print("x is five")

Key idea: control flow decides which lines run next.
```

### 3) school/2026F/MATH1600A/content/Module 1/syllabus.md (optional, for second course chatter)

```markdown
# MATH 1600A — Syllabus — Fall 2026

Midterm is Oct 15 in Room 1010. Final is Dec 12. No late assignments accepted.
Office hours Wed 3pm-5pm.
```

## Assignments — update to relative dates so Today is not empty

Current DB has three 2025 assignments that will never show in "Next 7 days" on 2026-08-26. Replace with these for the demo, then revert after recording if you want.

| Course | Title | Due at (ISO) | Status | Why it works on camera |
| --- | --- | --- | --- | --- |
| CS 1100A | Assignment 1 — Control Flow | 2026-08-29T23:59:00 (in 3 days) | open | Shows in Next 7 days + answers "what is due this week" |
| CS 1100A | Assignment 2 — Functions and Testing | 2026-09-05T23:59:00 (in 10 days) | open | Shows just outside Next 7 days, proves longer horizon |
| MATH 1600A | Problem Set 1 — Vectors | 2026-09-01T17:00:00 (in 6 days) | open | Gives the second course a due date, colors the calendar |
| ENG 3300A | Lab Report 1 — Requirements | 2026-08-30T23:59:00 (in 4 days) | open | Optional, adds variety |

## Announcements — one digest line

Add one announcement per course so the digest has something to summarize:

- CS 1100A — "Lab A moved to Lab C for Week 2 due to maintenance. Check Room 1220."
- MATH 1600A — "Midterm review session added Thu Sep 3, 6pm, Room 1010."

These are short enough to render well in the digest card.

## Memory facts — optional but makes chat grounded

If memory_facts is empty, the agent still works, but one fact makes the digest feel smarter:

- fact: "CS 1100A office hours are Tuesdays 2pm-4pm in Room 1120" — category: logistics — confidence 0.9 — source: syllabus — is_active 1

## Events — already from seed + ICS, just verify

With the assignments above, the Next 7 days should show 3 items grouped by day. The weekly timetable from seed/courses.example.json and sample.ics already gives Mon-Fri lectures. No extra work needed, just make sure "Next 7 days" is not empty on recording day.

## Scripted queries that hit perfectly with this data

These are the ONLY queries to type in the 20s video. They are ordered to tell the story in two questions.

1. `where does the syllabus mention late penalties` — must return the exact sentence from syllabus.md with file path citation. Rehearse until it does, then lock the seed.
2. `what's due this week?` — must return Assignment 1 (Aug 29) and optionally ENG Lab Report (Aug 30) grouped. If it returns too much, scope chat to CS 1100A only and ask `what's due this week in CS 1100A?`

Do not add a third query in 20 seconds. Pace beats breadth.

## What to delete/avoid in mock data

- No lorem ipsum, no "Test Assignment", no 2025 dates, no empty module with 0 topics, no PDF that is a scanned image with no text layer. Those signal tutorial project.
