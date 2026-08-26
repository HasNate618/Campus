import { useEffect, useMemo, useRef, useState } from 'react'
import { useSchedule } from '@/lib/useSchedule'
import {
  DAY_FULL,
  type Meeting,
  type ScheduleBlock,
  type ScheduleCourse,
} from '@/types'

// Course colors match the app's sidebar dots (DB `courses.color`).
const COLORS: Record<number, string> = {
  2: '#8b5cf6',
  3: '#f59e0b',
  4: '#10b981',
  5: '#3b82f6',
  6: '#ef4444',
  7: '#ec4899',
  8: '#06b6d4',
  9: '#84cc16',
  10: '#f97316',
  11: '#a855f7',
  12: '#14b8a6',
  13: '#eab308',
  14: '#64748b',
}
const DAYS: Meeting['day'][] = ['M', 'Tu', 'W', 'Th', 'F']
const MIN_START = 8 * 60 // 8:00 AM
const MIN_END = 22 * 60 // 10:00 PM
const PX_MIN = 1 // 1 minute = 1px

function courseColor(course: ScheduleCourse): string {
  return COLORS[course.id] ?? '#a179f0'
}

function toMin(t: string): number {
  const [time, ampm] = t.split(' ')
  let [h, m] = time.split(':').map(Number)
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return h * 60 + m
}

function fmtHour(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh} ${ampm}`
}

interface Interval {
  course: ScheduleCourse
  block: ScheduleBlock
  meeting: Meeting
  start: number
  end: number
  lane: number
  lanes: number
}

/** Greedy lane assignment (interval scheduling): overlapping meetings in a
 *  day column stack side-by-side, each lane gets an equal slice. */
function layoutDay(meetings: Interval[]): Interval[] {
  const sorted = [...meetings].sort((a, b) => a.start - b.start)
  const laneEnds: number[] = []
  for (const m of sorted) {
    let lane = laneEnds.findIndex((end) => end <= m.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = m.end
    m.lane = lane
  }
  for (const m of sorted) m.lanes = laneEnds.length
  return sorted
}

export function SchedulePage() {
  // Fall (A) vs Winter (B) term — course codes carry the suffix. Default
  // follows the calendar: Jan–Apr = winter, everything else (incl. summer,
  // when the upcoming term is fall) = fall.
  const [term, setTerm] = useState<'A' | 'B'>(() =>
    new Date().getMonth() <= 3 ? 'B' : 'A',
  )
  const { schedule, loading, error } = useSchedule()
  const termCourses = useMemo(
    () => schedule.filter((c) => c.code.slice(-1) === term),
    [schedule, term],
  )
  // Current time for the "now" line — refreshed every minute.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const dayIndex = (now.getDay() + 6) % 7 // 0 = Monday
  const today: Meeting['day'] | null =
    dayIndex >= 0 && dayIndex <= 4 ? DAYS[dayIndex] : null
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMin - MIN_START) * PX_MIN
  const showNow = today != null && nowMin >= MIN_START && nowMin <= MIN_END
  const ttScrollRef = useRef<HTMLDivElement>(null)
  const todayColRef = useRef<HTMLDivElement>(null)

  // On mobile, keep all five days available but focus the current day.
  useEffect(() => {
    const wrap = ttScrollRef.current
    const todayCol = todayColRef.current
    if (!wrap || !todayCol) return
    requestAnimationFrame(() => {
      wrap.scrollLeft = Math.max(0, todayCol.offsetLeft - 48)
      if (showNow) {
        wrap.scrollTop = Math.max(0, nowTop - wrap.clientHeight / 2)
      }
    })
  }, [showNow, today, nowTop])

  const byDay = useMemo(() => {
    const map: Record<Meeting['day'], Interval[]> = { M: [], Tu: [], W: [], Th: [], F: [] }
    for (const course of termCourses) {
      for (const block of course.blocks) {
        for (const meeting of block.meetings) {
          map[meeting.day].push({
            course,
            block,
            meeting,
            start: toMin(meeting.start),
            end: toMin(meeting.end),
            lane: 0,
            lanes: 1,
          })
        }
      }
    }
    const out = {} as Record<Meeting['day'], Interval[]>
    for (const day of DAYS) out[day] = layoutDay(map[day])
    return out
  }, [termCourses])

  const hours = useMemo(() => {
    const arr: number[] = []
    for (let h = 8; h <= 21; h++) arr.push(h)
    return arr
  }, [])

  return (
    <div className="page page-schedule">
      <div className="page-head">
        <h1>My Schedule</h1>
        <p className="page-sub">
          Weekly timetable · {termCourses.length} courses ·{' '}
          {term === 'A' ? 'Fall term' : 'Winter term'}
        </p>
      </div>

      <div className="term-toggle">
        <button
          className={`term-btn${term === 'A' ? ' active' : ''}`}
          onClick={() => setTerm('A')}
        >
          Fall · A
        </button>
        <button
          className={`term-btn${term === 'B' ? ' active' : ''}`}
          onClick={() => setTerm('B')}
        >
          Winter · B
        </button>
      </div>


      {error && (
        <div className="empty">
          Couldn't load your schedule — {error}
        </div>
      )}
      {!error && (
        <div className="tt-wrap">
        <div className="tt">
          {loading && <div className="empty">Loading schedule…</div>}
          {/* Static time gutter — never scrolls, so courses in the day pane
              to its right are culled by layout, not by an opaque fill. */}
          <div className="tt-ruler">
            <div className="tt-ruler-head" />
            <div className="tt-ruler-body">
              {hours.map((h) => (
                <span key={h} className="tt-hour" style={{ top: (h * 60 - MIN_START) * PX_MIN }}>
                  {fmtHour(h)}
                </span>
              ))}
              {showNow && (
                <span className="tt-now tt-now-ruler" style={{ top: nowTop }}>
                  <span className="tt-now-dot" />
                </span>
              )}
            </div>
          </div>

          <div className="tt-scroll" ref={ttScrollRef}>
            <div className="tt-grid">
              {DAYS.map((d) => (
                <div key={d} className={`tt-day-head${d === today ? ' today' : ''}`}>
                  {DAY_FULL[d]}
                </div>
              ))}

              {DAYS.map((d) => (
                <div
                  key={d}
                  ref={d === today ? todayColRef : undefined}
                  className={`tt-col${d === today ? ' today' : ''}`}
                  style={{ height: (MIN_END - MIN_START) * PX_MIN }}
                >
                  {hours.map((h) => (
                    <span key={h} className="tt-line" style={{ top: (h * 60 - MIN_START) * PX_MIN }} />
                  ))}
                  {d === today && showNow && (
                    <span className="tt-now" style={{ top: nowTop }}>
                      <span className="tt-now-dot" />
                    </span>
                  )}
                  {byDay[d].map((iv, i) => {
                    const color = courseColor(iv.course)
                    const top = (iv.start - MIN_START) * PX_MIN
                    const height = Math.max((iv.end - iv.start) * PX_MIN, 18)
                    const w = 100 / iv.lanes
                    const tall = height >= 44
                    return (
                      <div
                        key={i}
                        className="tt-block"
                        title={`${iv.course.code} · ${iv.course.name}\n${iv.block.type} ${iv.block.section} · CRN ${iv.block.crn}${iv.block.instructor ? ` · ${iv.block.instructor}` : ''}\n${iv.meeting.start} – ${iv.meeting.end}${iv.meeting.room ? ` · ${iv.meeting.room}` : ''}`}
                        style={{
                          top,
                          height,
                          left: `${iv.lane * w}%`,
                          width: `${w}%`,
                          background: `${color}24`,
                          borderColor: `${color}66`,
                          color,
                        }}
                      >
                        <b className="tt-code">{iv.course.code}</b>
                        {tall && <span className="tt-type">{iv.block.type}</span>}
                        {tall && (
                          <span className="tt-time">
                            {iv.meeting.start}–{iv.meeting.end}
                            {iv.meeting.room ? ` · ${iv.meeting.room}` : ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      )}

      <div className="sched-legend">
        {termCourses.map((course) => (
          <div key={course.id} className="sched-legend-row">
            <span className="dot" style={{ background: courseColor(course) }} />
            <span className="sched-legend-code">{course.code}</span>
            <span className="sched-legend-name">{course.name}</span>
            {course.credit && <span className="sched-legend-credit">{course.credit}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
