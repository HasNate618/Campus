import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/api/client'
import { dayKey, eventDayKey, fmtDateTime, fmtTime } from '@/lib/format'
import type { Event } from '@/types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Cell {
  date: Date
  otherMonth: boolean
}

function monthCells(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1)
  // Monday-first offset
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return { date: d, otherMonth: d.getMonth() !== month }
  })
}

export function CalendarPage() {
  const now = new Date()
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState(dayKey(now))
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    const from = new Date(view.year, view.month, 1)
    const to = new Date(view.year, view.month + 1, 0, 23, 59, 59)
    api
      .events({ from_dt: from.toISOString(), to_dt: to.toISOString() })
      .then(setEvents)
      .catch(console.error)
  }, [view])

  const byDay = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events) {
      const k = eventDayKey(e)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(e)
    }
    return m
  }, [events])

  const shift = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  const todayKey = dayKey(now)
  const selectedEvents = byDay.get(selected) ?? []
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="page">
      <div className="page-col">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 className="page-title">{monthLabel}</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-outline btn-sm" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setView({ year: now.getFullYear(), month: now.getMonth() })
                setSelected(todayKey)
              }}
            >
              Today
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="card">
          <div className="cal-grid">
            {WEEKDAYS.map((d) => (
              <div className="cal-head" key={d}>
                {d}
              </div>
            ))}
            {monthCells(view.year, view.month).map(({ date, otherMonth }) => {
              const k = dayKey(date)
              const count = byDay.get(k)?.length ?? 0
              const cls = [
                'cal-cell',
                otherMonth && 'other-month',
                k === todayKey && 'today',
                k === selected && 'selected',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button key={k} className={cls} onClick={() => setSelected(k)}>
                  {date.getDate()}
                  <span className="cal-dots">
                    {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                      <span className="cal-dot" key={i} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="card">
          <p className="card-title">
            {new Date(`${selected}T12:00`).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          {selectedEvents.length === 0 && <div className="empty compact">Nothing scheduled.</div>}
          {selectedEvents.map((e) => (
            <div className="row" key={e.id}>
              <div className="row-main">
                <div className="row-title">{e.title}</div>
                <div className="row-sub">
                  {e.course_code ?? ''}
                  {e.ends_at
                    ? ` · ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`
                    : ` · ${fmtDateTime(e.starts_at)}`}
                </div>
              </div>
              <span className="chip">{e.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
