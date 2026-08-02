import { Link, useLocation, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Calendar, Home, Newspaper, RefreshCw, BookOpen } from 'lucide-react'
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
      <div className="sidebar__section-label">Courses</div>
      {courses.map((c) => {
        const active = courseId === String(c.id) || location.pathname.includes(`/courses/${c.id}`)
        return (
          <Link
            key={c.id}
            to={`/courses/${c.id}`}
            className={`course-item${active ? ' active' : ''}`}
          >
            <span className="course-item__dot" style={{ background: c.color ?? '#a1a1aa' }} />
            <span>
              <span className="course-item__code">{c.code}</span>
              <span className="course-item__meta">
                {c.is_pilot ? 'Pilot · ' : ''}{c.term}
                {c.file_count ? ` · ${c.file_count} files` : ''}
              </span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}

const NAV = [
  { to: '/today', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/sync', label: 'Sync', icon: RefreshCw },
  { to: '/digest', label: 'Digest', icon: Newspaper },
  { to: '/courses', label: 'All courses', icon: BookOpen },
]

export function SidebarNav() {
  const location = useLocation()
  return (
    <nav className="sidebar-nav">
      {NAV.map((l) => {
        const Icon = l.icon
        return (
          <Link key={l.to} to={l.to} className={location.pathname === l.to ? 'active' : ''}>
            <Icon size={16} strokeWidth={location.pathname === l.to ? 2.25 : 1.75} />
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
