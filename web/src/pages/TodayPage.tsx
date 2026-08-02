import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CalendarStrip } from '../components/CalendarStrip'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
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
    api.digest().then((d) => setDigestPreview(d.markdown.split('\n').slice(0, 4).join('\n'))).catch(console.error)
  }, [])

  const todayEvents = events.filter((e) => e.starts_at.startsWith(new Date().toISOString().slice(0, 10)))
  const upcomingDeadlines = events.filter((e) => e.kind === 'assignment')
  const dateStr = new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="page">
      <PageHeader title="Today" subtitle={dateStr} />

      <Card title="Next 7 days">
        <CalendarStrip />
      </Card>

      <div className="grid-2">
        <Card title="Today">
          {todayEvents.length === 0 ? (
            <EmptyState compact>No classes today</EmptyState>
          ) : (
            todayEvents.map((e) => (
              <div key={e.id} className="list-item">
                <div className="list-item__title">{e.title}</div>
                <div className="list-item__meta">{e.course_code} · {formatTime(e.starts_at)}</div>
              </div>
            ))
          )}
        </Card>
        <Card title="This week">
          {upcomingDeadlines.length === 0 ? (
            <EmptyState compact>No upcoming deadlines</EmptyState>
          ) : (
            upcomingDeadlines.map((e) => (
              <div key={e.id} className="list-item">
                <div className="list-item__title">{e.title}</div>
                <div className="list-item__meta">{e.course_code}</div>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card title="Announcements">
        {announcements.length === 0 ? (
          <EmptyState>No announcements</EmptyState>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="list-item">
              <div className="list-item__title">{a.title}</div>
              <div className="list-item__meta">{a.course_code} · {formatDate(a.posted_at)}</div>
            </div>
          ))
        )}
      </Card>

      <div className="grid-2">
        <Card title="Morning digest">
          <p className="digest-preview">{digestPreview || 'No digest yet'}</p>
          <Link to="/digest" className="text-link">Read full digest →</Link>
        </Card>
        <Card title="Sync">
          {syncRun ? (
            <>
              <p style={{ fontSize: '0.8125rem', marginBottom: '0.375rem' }}>
                <span className={`status-dot ${syncRun.status === 'ok' ? 'ok' : 'failed'}`} />
                {formatDate(syncRun.finished_at ?? syncRun.started_at)} · {syncRun.status}
              </p>
              <p className="list-item__meta">
                {syncRun.files_new} new files · {syncRun.announcements_new} announcements
              </p>
            </>
          ) : (
            <EmptyState compact>Never synced</EmptyState>
          )}
          <div className="card-actions">
            <Button to="/sync">Sync now</Button>
            {syncRun && <Button to={`/sync?run=${syncRun.id}`} variant="secondary">View log</Button>}
          </div>
        </Card>
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
