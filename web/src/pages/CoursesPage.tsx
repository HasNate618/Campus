import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Course } from '../types'

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    api.courses(!showInactive).then(setCourses).catch(console.error)
  }, [showInactive])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Courses</h1>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {courses.map((c) => (
        <Link key={c.id} to={`/courses/${c.id}`} style={{ textDecoration: 'none' }}>
          <div className="card" style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {c.code} · {c.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {c.term}
                  {c.instructor ? ` · ${c.instructor}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {c.is_pilot ? <span className="badge pilot">Pilot</span> : null}
                {!c.last_sync_at && <span className="badge">Not synced</span>}
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              {c.last_sync_at
                ? `Last sync: ${new Date(c.last_sync_at).toLocaleDateString('en-CA')} · ${c.file_count ?? 0} files · ${c.assignment_count ?? 0} assignments`
                : 'Not synced yet'}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
