import { useEffect, useState } from 'react'
import { CalendarDays, Home, LogOut } from 'lucide-react'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { api } from '@/api/client'
import { CalendarCard } from '@/components/CalendarCard'
import { SyncCard } from '@/components/SyncCard'
import { eventDayKey, fmtDateTime, fmtRelative, fmtTime } from '@/lib/format'
import type { Event } from '@/types'

type Digest = { generated_at: string; markdown: string; source: string }

function eventChipClass(kind: string): string {
  if (kind === 'assignment' || kind === 'deadline') return 'chip violet'
  if (kind === 'exam' || kind === 'quiz') return 'chip red'
  return 'chip'
}

export function TodayPage({ onLogout }: { onLogout?: () => void }) {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    api.digest().then(setDigest).catch(() => setDigest(null))
    api.eventsNext7().then(setEvents).catch(() => setEvents([]))
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
      <div className="page-col wide">
        <div>
          <div className="page-head">
            <div>
              <h1 className="page-title">Home</h1>
              <p className="page-sub">{today}</p>
            </div>
            {onLogout && (
              <button
                className="icon-btn mobile-only page-logout"
                onClick={onLogout}
                title="Log out"
                aria-label="Log out"
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="dash-grid">
          <div className="dash-col">
            <div className="card">
              <p className="card-title">
                <Home size={14} /> Digest
                {digest && (
                  <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--text-3)' }}>
                    {fmtRelative(digest.generated_at)}
                  </span>
                )}
              </p>
              {digest ? (
                <ZenMarkdown content={digest.markdown} />
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
                            {e.ends_at
                              ? ` · ${fmtTime(e.starts_at)}–${fmtTime(e.ends_at)}`
                              : ` · ${fmtDateTime(e.starts_at)}`}
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

          <div className="dash-col">
            <CalendarCard />
            <SyncCard />
          </div>
        </div>
      </div>
    </div>
  )
}
