import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { CalendarStrip } from '@/components/CalendarStrip'
import { AppCard as Card } from '@/components/AppCard'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { CourseHub } from '@/types'

export function CourseLayout() {
  const { courseId } = useParams()
  const id = Number(courseId)

  return (
    <div className="page page--wide">
      <nav className="tabs">
        <NavLink to={`/courses/${id}`} end>Overview</NavLink>
        <NavLink to={`/courses/${id}/content`}>Content</NavLink>
        <NavLink to={`/courses/${id}/assignments`}>Assignments</NavLink>
      </nav>
      <Outlet />
    </div>
  )
}

export function CourseHubPage() {
  const { courseId } = useParams()
  const id = Number(courseId)
  const [hub, setHub] = useState<CourseHub | null>(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryMd, setMemoryMd] = useState('')

  useEffect(() => {
    api.courseHub(id).then(setHub).catch(console.error)
  }, [id])

  if (!hub) return <p className="list-item__meta">Loading…</p>

  const { course, announcements, memory_facts, recent_files, stats } = hub

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-header__title">{course.code}</h1>
          <p className="page-header__subtitle">
            {course.name} · {course.term}
            {course.is_pilot ? ' · Pilot' : ''}
            {course.last_sync_at ? ` · Synced ${new Date(course.last_sync_at).toLocaleDateString('en-CA')}` : ''}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/sync">Sync course</Link>
        </Button>
      </header>

      <Card title="Next 7 days">
        <CalendarStrip courseId={id} />
      </Card>

      <Card title="Announcements">
        {announcements.length === 0 ? (
          <EmptyState compact>No announcements</EmptyState>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="list-item">
              <div className="list-item__title">{a.title}</div>
              <div className="list-item__meta">
                {a.posted_at ? new Date(a.posted_at).toLocaleDateString('en-CA') : ''}
              </div>
              {a.body && <p className="list-item__body">{a.body}</p>}
            </div>
          ))
        )}
      </Card>

      <div className="grid-2">
        <Card title="At a glance">
          <p className="list-item__body" style={{ marginTop: 0 }}>{stats.assignment_count} assignments</p>
          <p className="list-item__body">{stats.file_count} files · {stats.processed_files} processed</p>
          <Link to={`/courses/${id}/assignments`} className="text-link">View assignments →</Link>
        </Card>
        <Card title="Memory">
          {memory_facts.length === 0 ? (
            <EmptyState compact>No facts yet</EmptyState>
          ) : (
            memory_facts.map((f) => (
              <p key={f.id} className="list-item__body" style={{ marginTop: 0 }}>· {f.fact}</p>
            ))
          )}
          <div className="card-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const m = await api.memoryCard(id)
                setMemoryMd(m.markdown)
                setMemoryOpen(true)
              }}
            >
              View memory card
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Recent files">
        {recent_files.length === 0 ? (
          <EmptyState compact>No files</EmptyState>
        ) : (
          recent_files.map((f) => (
            <div key={f.id} className="list-item">
              <div className="list-item__title">{f.path.split('/').pop()}</div>
              <div className="list-item__meta">{f.kind}{f.processed ? ' · processed' : ''}</div>
            </div>
          ))
        )}
        <Link to={`/courses/${id}/content`} className="text-link">Browse content →</Link>
      </Card>

      {memoryOpen && (
        <Card
          title="Memory card"
          action={<Button variant="ghost" size="sm" onClick={() => setMemoryOpen(false)}>Close</Button>}
        >
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8125rem', color: 'hsl(var(--muted-foreground))', fontFamily: 'inherit', lineHeight: 1.55 }}>
            {memoryMd}
          </pre>
        </Card>
      )}
    </div>
  )
}
