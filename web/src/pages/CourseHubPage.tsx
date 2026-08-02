import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CalendarStrip } from '../components/CalendarStrip'
import type { CourseHub } from '../types'

export function CourseLayout() {
  const { courseId } = useParams()
  const id = Number(courseId)

  return (
    <div>
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

  if (!hub) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>

  const { course, announcements, memory_facts, recent_files, stats } = hub

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
          {course.code} · {course.name}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {course.term}
          {course.is_pilot ? ' · Pilot' : ''}
          {course.last_sync_at ? ` · Synced ${new Date(course.last_sync_at).toLocaleDateString('en-CA')}` : ''}
          <Link to="/sync" style={{ marginLeft: '1rem' }}>Sync course</Link>
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Course calendar — next 7 days</h3>
        <CalendarStrip courseId={id} />
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Announcements</h3>
        {announcements.length === 0 ? (
          <p className="empty-state">No announcements</p>
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="list-item">
              <div className="title">{a.title}</div>
              <div className="meta">{a.posted_at ? new Date(a.posted_at).toLocaleDateString('en-CA') : ''}</div>
              {a.body && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{a.body}</p>}
            </div>
          ))
        )}
      </div>

      <div className="grid-2" style={{ marginBottom: '1rem' }}>
        <div className="card">
          <h3>At a glance</h3>
          <p style={{ fontSize: '0.85rem' }}>{stats.assignment_count} assignments</p>
          <p style={{ fontSize: '0.85rem' }}>{stats.file_count} files · {stats.processed_files} processed</p>
          <Link to={`/courses/${id}/assignments`} style={{ fontSize: '0.85rem' }}>View assignments →</Link>
        </div>
        <div className="card">
          <h3>Memory highlights</h3>
          {memory_facts.length === 0 ? (
            <p className="empty-state" style={{ padding: '0.5rem' }}>No facts yet</p>
          ) : (
            memory_facts.map((f) => (
              <p key={f.id} style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>· {f.fact}</p>
            ))
          )}
          <button className="secondary" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }} onClick={async () => {
            const m = await api.memoryCard(id)
            setMemoryMd(m.markdown)
            setMemoryOpen(true)
          }}>
            View memory card
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Recent files</h3>
        {recent_files.length === 0 ? (
          <p className="empty-state">No files</p>
        ) : (
          recent_files.map((f) => (
            <div key={f.id} className="list-item">
              <div className="title">{f.path.split('/').pop()}</div>
              <div className="meta">
                {f.kind}
                {f.processed ? <span className="badge processed" style={{ marginLeft: '0.5rem' }}>processed</span> : null}
              </div>
            </div>
          ))
        )}
        <Link to={`/courses/${id}/content`} style={{ fontSize: '0.85rem' }}>Browse content →</Link>
      </div>

      {memoryOpen && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>Memory card</h3>
            <button className="secondary" onClick={() => setMemoryOpen(false)}>Close</button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{memoryMd}</pre>
        </div>
      )}
    </div>
  )
}
