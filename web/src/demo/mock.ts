export interface DemoCourse {
  code: string
  name: string
  color: string
}

export const COURSES: DemoCourse[] = [
  { code: 'SE 2250B', name: 'Software Construction', color: '#a179f0' },
  { code: 'SE 2205A', name: 'Algorithms & Data Structures', color: '#60a5fa' },
  { code: 'ECE 2270A', name: 'Circuits', color: '#34d399' },
  { code: 'DS 3000A', name: 'Data Science I', color: '#fbbf24' },
]

export const SUGGESTIONS = [
  "What's due this week?",
  'Summarize SE 2250B announcements',
  'Explain decorators from week 5 notes',
  'When is my next lab?',
]

export const SCRIPTED = {
  tool: {
    name: 'harness_assignments',
    detail: `args:   { "days_ahead": 7, "course": null }
result: 4 rows · assignments JOIN courses
  SE 2250B · Assignment 3: UML Design · 2026-02-14
  SE 2250B · Quiz 4                  · 2026-02-17
  ECE 2270A · Lab 4 Report          · 2026-02-13
  DS 3000A · Problem Set 6          · 2026-02-15`,
  },
  reply: `You have 4 deadlines in the next 7 days:

SE 2250B — Software Construction
  Assignment 3: UML Design — due Fri, Feb 14, 11:59 PM
  Quiz 4 — opens Mon, Feb 17

ECE 2270A — Circuits
  Lab 4 Report — due Thu, Feb 13, 11:59 PM

DS 3000A — Data Science I
  Problem Set 6 — due Sat, Feb 15, 11:59 PM

The Lab 4 report is your most urgent item. Want me to pull the lab instructions from the course content?`,
}

export const DUE_THIS_WEEK = [
  { course: 'ECE 2270A', color: '#34d399', title: 'Lab 4 Report', due: 'Thu, Feb 13 · 11:59 PM', urgent: true },
  { course: 'SE 2250B', color: '#a179f0', title: 'Assignment 3: UML Design', due: 'Fri, Feb 14 · 11:59 PM', urgent: false },
  { course: 'DS 3000A', color: '#fbbf24', title: 'Problem Set 6', due: 'Sat, Feb 15 · 11:59 PM', urgent: false },
]

export const UPCOMING_EVENTS = [
  { day: 'Mon, Feb 10', items: ['SE 2250B lecture · 9:30–11:30 · SEB 2100', 'DS 3000A tutorial · 2:30–3:30 · TC 141'] },
  { day: 'Tue, Feb 11', items: ['ECE 2270A lab · 8:30–11:30 · TEB 253'] },
  { day: 'Wed, Feb 12', items: ['SE 2205A lecture · 10:30–12:30 · NCB 113'] },
  { day: 'Thu, Feb 13', items: ['Lab 4 Report due · 11:59 PM'] },
]
