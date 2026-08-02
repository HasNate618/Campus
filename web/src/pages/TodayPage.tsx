import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { CalendarDays, RefreshCw, Sunrise } from 'lucide-react'
import { api } from '@/api/client'
import { eventDayKey, fmtDateTime, fmtRelative, fmtTime } from '@/lib/format'
import type { Event, SyncRun } from '@/types'

type Digest = { generated_at: string; markdown: string; source: string }
type SyncStatus = { status: string; last_run: SyncRun | null; token_valid?: boolean }

function eventChipClass(kind: string): string {
  if (kind === 'assignment' || kind === 'deadline') return 'chip violet'
  if (kind === 'exam' || kind === 'quiz') return 'chip red'
  return 'chip'
}

export function TodayPage() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.digest().catch(() => null),
      api.eventsNext7().catch(() => [] as Event[]),
      api.syncStatus().catch(() => null),
    ])
      .then(([d, e, s]) => {
        setDigest(d)
        setEvents(e)
        setSync(s)
      })
      .catch((e) => setError(String(e)))
  }, [])

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const grouped = new Map<string, Event[]>()
  for (const e of events) {
    const k = eventDayKey(e)
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k)!.push(e)
  }
  const days = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="page">
      <div className="page-col">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 className="page-title">Today</h1>
            <p className="page-sub">{today}</p>
          </div>
          {sync && (
            <Link to="/sync" className="chip" style={{ textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <RefreshCw size={11} />
              {sync.last_run
                ? `Synced ${fmtRelative(sync.last_run.started_at)} · ${sync.last_run.status}`
                : 'Never synced'}
            </Link>
          )}
        </div>

        {error && <div className="card">Failed to load: {error}</div>}

        <div className="card">
          <p className="card-title">
            <Sunrise size={14} /> Digest
            {digest && (
              <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--text-3)' }}>
                {fmtRelative(digest.generated_at)}
              </span>
            )}
          </p>
          {digest ? (
            <div className="md">
              <ReactMarkdown>{digest.markdown}</ReactMarkdown>
            </div>
          ) : (
            <div className="empty compact">No digest yet — it generates after the next sync.</div>
          )}
        </div>

        <div className="card">
          <p className="card-title">
            <CalendarDays size={14} /> Next 7 days
          </p>
          {days.length === 0 && (
            <div className="empty compact">Nothing scheduled — the pilot term has ended.</div>
          )}
          {days.map(([day, evs]) => (
            <div className="row" key={day} style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 86, paddingTop: 1 }}>
                <div className="row-title" style={{ fontSize: 13 }}>
                  {new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div className="row-sub">
                  {new Date(`${day}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div className="row-main" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {evs.map((e) => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="row-main">
                      <div className="row-title">{e.title}</div>
                      <div className="row-sub">
                        {e.course_code ?? ''}
                        {e.ends_at ? ` · ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}` : ` · ${fmtDateTime(e.starts_at)}`}
                      </div>
                    </div>
                    <span className={eventChipClass(e.kind)}>{e.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
