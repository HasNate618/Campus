import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Event } from '../types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function CalendarStrip({ courseId }: { courseId?: number }) {
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    api.eventsNext7(courseId).then(setEvents).catch(console.error)
  }, [courseId])

  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    return d
  })

  const eventsForDay = (d: Date) => {
    const key = d.toISOString().slice(0, 10)
    return events.filter((e) => e.starts_at.startsWith(key))
  }

  return (
    <div className="calendar-strip">
      {days.map((d) => {
        const isToday = d.toDateString() === today.toDateString()
        const dayEvents = eventsForDay(d)
        return (
          <div key={d.toISOString()} className={`cal-day${isToday ? ' today' : ''}`}>
            <div className="dow">{DAYS[d.getDay()]}</div>
            <div className="num">{d.getDate()}</div>
            {dayEvents.length > 0 && <div className="dot" />}
          </div>
        )
      })}
    </div>
  )
}
