import { Link, useLocation, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Course } from '../types'

export function CourseSwitcher() {
  const [courses, setCourses] = useState<Course[]>([])
  const { courseId } = useParams()
  const location = useLocation()

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  return (
    <div>
      <div style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Courses
      </div>
      {courses.map((c) => (
        <Link
          key={c.id}
          to={`/courses/${c.id}`}
          className={`course-item${courseId === String(c.id) || location.pathname.includes(`/courses/${c.id}`) ? ' active' : ''}`}
          style={{ borderLeftColor: c.color ?? undefined }}
        >
          <span className="code">{c.code}</span>
          <span className="meta">
            {c.is_pilot ? 'Pilot · ' : ''}{c.term}
            {c.file_count ? ` · ${c.file_count} files` : ''}
          </span>
        </Link>
      ))}
    </div>
  )
}

export function SidebarNav() {
  const location = useLocation()
  const links = [
    { to: '/today', label: 'Today' },
    { to: '/calendar', label: 'Calendar' },
    { to: '/sync', label: 'Sync' },
    { to: '/digest', label: 'Digest' },
    { to: '/courses', label: 'All Courses' },
  ]
  return (
    <nav className="sidebar-nav">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className={location.pathname === l.to ? 'active' : ''}>
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
