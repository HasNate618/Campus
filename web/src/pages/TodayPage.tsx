import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CalendarStrip } from '../components/CalendarStrip'
import type { Announcement, Event, SyncRun } from '../types'

export function TodayPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null)
  const [digestPreview, setDigestPreview] = useState('')

  useEffect(() => {
    api.announcements(undefined, 5).then(setAnnouncements).catch(console.error)
    api.eventsNext7().then(setEvents).catch(console.error)
    api.syncStatus().then((s) => setSyncRun(s.last_run)).catch(console.error)
    api.digest().then((d) => setDigestPreview(d.markdown.split('\n').slice(0, 3).join('\n'))).catch(console.error)
  }, [])

  const todayEvents = events.filter((e) => e.starts_at.startsWith(new Date().toISOString().slice(0, 10)))
  const upcomingDeadlines = events.filter((e) => e.kind === 'assignment')

  return (
    <div>
      <h1 className="page-title">Today</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
        {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Next 7 days</h3>
        <CalendarStrip />
      </div>

      <div className="grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h3>Today</h3>
          {todayEvents.length === 0 ? (
            <p className="empty-state" style={{ padding: '1rem' }}>No classes today</p>
          ) : (
            todayEvents.map((e) => (
              <div key={e.id} className="list-item">
                <div className="title">{e.title}</div>
                <div className="meta">{e.course_code} · {formatTime(e.starts_at)}</div>
              </div>
            ))
          )}
        </div>
        <div className="card">
          <h3>This week</h3>
          {upcomingDeadlines.length === 0 ? (
            <p className="empty-state" style={{ padding: '1rem' }}>No upcoming deadlines</p>
          ) : (
            upcomingDeadlines.map((e) => (
              <div key={e.id} className="list-item">
                <div className="title">{e.title}</div>
                <div className="meta">{e.course_code}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Announcements</h3>
        {announcements.length === 0 ? (
          <p className="empty-state">No announcements</p>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="list-item">
              <div className="title">{a.title}</div>
              <div className="meta">{a.course_code} · {formatDate(a.posted_at)}</div>
            </div>
          ))
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Morning digest</h3>
          <pre style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {digestPreview || 'No digest yet'}
          </pre>
          <Link to="/digest" style={{ fontSize: '0.85rem' }}>Read full digest →</Link>
        </div>
        <div className="card">
          <h3>Sync</h3>
          {syncRun ? (
            <>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <span className={`status-dot ${syncRun.status === 'ok' ? 'ok' : 'failed'}`} />
                Last: {formatDate(syncRun.finished_at ?? syncRun.started_at)} · {syncRun.status}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {syncRun.files_new} new files · {syncRun.announcements_new} announcements
              </p>
            </>
          ) : (
            <p className="empty-state" style={{ padding: '0.5rem' }}>Never synced</p>
          )}
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <Link to="/sync"><button>Sync now</button></Link>
            {syncRun && (
              <Link to={`/sync?run=${syncRun.id}`}>
                <button className="secondary">View log</button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
}
