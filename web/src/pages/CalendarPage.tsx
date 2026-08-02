import { useEffect, useState } from 'react'
import { api } from '../api/client'
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
    <div>
      <h1 className="page-title">Calendar</h1>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className={view === 'agenda' ? '' : 'secondary'} onClick={() => setView('agenda')}>Agenda</button>
        <button className={view === 'month' ? '' : 'secondary'} onClick={() => setView('month')}>Month</button>
        <button className="secondary" disabled title="Coming in Phase 4">Export ICS</button>
      </div>

      {view === 'agenda' ? (
        <div className="card">
          <h3>Upcoming</h3>
          {events.length === 0 ? (
            <p className="empty-state">No upcoming events. Pilot course deadlines are in the past.</p>
          ) : (
            events.map((e) => (
              <div key={e.id} className="list-item" onClick={() => setSelected(e)} style={{ cursor: 'pointer' }}>
                <div className="title">{e.title}</div>
                <div className="meta">
                  {e.course_code} · {new Date(e.starts_at).toLocaleString('en-CA')}
                  {e.notes ? ` · ${e.notes}` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <MonthGrid events={events} onSelect={setSelected} />
      )}

      {selected && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>{selected.title}</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {selected.course_code} · {selected.kind} · {new Date(selected.starts_at).toLocaleString('en-CA')}
          </p>
          {selected.notes && <p>{selected.notes}</p>}
        </div>
      )}

      <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Legend: class · assignment · exam · personal
      </p>
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
    <div className="card">
      <h3>{today.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '0.75rem' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '0.25rem' }}>{d}</div>
        ))}
        {cells.map((day, i) => (
          <div
            key={i}
            style={{
              minHeight: '64px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '4px',
              background: day === today.getDate() ? 'rgba(91,159,212,0.1)' : undefined,
            }}
          >
            {day && (
              <>
                <div style={{ fontWeight: 600 }}>{day}</div>
                {eventsOnDay(day).slice(0, 2).map((e) => (
                  <div
                    key={e.id}
                    style={{ fontSize: '0.65rem', color: 'var(--accent)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => onSelect(e)}
                  >
                    {e.title}
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
