import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import type { Event } from '../types'

export function CalendarPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [view, setView] = useState<'month' | 'agenda'>('agenda')
  const [selected, setSelected] = useState<Event | null>(null)

  useEffect(() => {
    const now = new Date()
    const end = new Date(now)
    end.setDate(end.getDate() + 30)
    api.events({ from_dt: now.toISOString(), to_dt: end.toISOString() }).then(setEvents).catch(console.error)
  }, [])

  return (
    <div className="page">
      <PageHeader
        title="Calendar"
        action={
          <div className="filter-bar" style={{ marginBottom: 0 }}>
            <Button variant={view === 'agenda' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('agenda')}>Agenda</Button>
            <Button variant={view === 'month' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('month')}>Month</Button>
            <Button variant="secondary" size="sm" disabled title="Coming in Phase 4">Export ICS</Button>
          </div>
        }
      />

      {view === 'agenda' ? (
        <Card title="Upcoming">
          {events.length === 0 ? (
            <EmptyState>No upcoming events. Pilot course deadlines are in the past.</EmptyState>
          ) : (
            events.map((e) => (
              <div key={e.id} className="list-item" onClick={() => setSelected(e)} style={{ cursor: 'pointer' }}>
                <div className="list-item__title">{e.title}</div>
                <div className="list-item__meta">
                  {e.course_code} · {new Date(e.starts_at).toLocaleString('en-CA')}
                  {e.notes ? ` · ${e.notes}` : ''}
                </div>
              </div>
            ))
          )}
        </Card>
      ) : (
        <MonthGrid events={events} onSelect={setSelected} />
      )}

      {selected && (
        <Card title={selected.title}>
          <p className="list-item__meta" style={{ marginBottom: '0.5rem' }}>
            {selected.course_code} · {selected.kind} · {new Date(selected.starts_at).toLocaleString('en-CA')}
          </p>
          {selected.notes && <p className="list-item__body">{selected.notes}</p>}
        </Card>
      )}
    </div>
  )
}

function MonthGrid({ events, onSelect }: { events: Event[]; onSelect: (e: Event) => void }) {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const eventsOnDay = (day: number) => {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return events.filter((e) => e.starts_at.startsWith(key))
  }

  return (
    <Card title={today.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}>
      <div className="month-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="month-grid__head">{d}</div>
        ))}
        {cells.map((day, i) => (
          <div
            key={i}
            className={`month-grid__cell${day === today.getDate() ? ' month-grid__cell--today' : ''}`}
          >
            {day && (
              <>
                <div className="month-grid__day-num">{day}</div>
                {eventsOnDay(day).slice(0, 2).map((e) => (
                  <div key={e.id} className="month-grid__event" onClick={() => onSelect(e)}>
                    {e.title}
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
