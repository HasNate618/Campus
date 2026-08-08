import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { listKeys, useListCursor, useZoneKeys } from '@/lib/keynav'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import type { Course } from '@/types'

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const cursor = useListCursor(courses.length)

  useEffect(() => {
    api
      .courses()
      .then(setCourses)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useZoneKeys('course', (key) =>
    listKeys(key, cursor, () => {
      const c = courses[cursor.cursor]
      if (c) navigate(`/courses/${c.id}`)
    }),
  )

  return (
    <div className="page">
      <div className="page-col">
        <div>
          <h1 className="page-title">Courses</h1>
          <p className="page-sub">{loading ? 'Loading…' : `${courses.length} active`}</p>
        </div>

        {!loading && courses.length === 0 && (
          <div className="card">
            <div className="empty">No courses synced yet — run a sync first.</div>
          </div>
        )}

        {courses.map((c, i) => (
          <Link
            key={c.id}
            to={`/courses/${c.id}`}
            ref={cursor.setRef(i)}
            className={`card course-card${cursor.cursor === i ? ' kbd-cursor' : ''}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="course-card-top">
              <span className="dot" style={{ background: courseColor(c) }} />
              <div className="row-main">
                <div className="row-title">{c.code}</div>
                <div className="row-sub">
                  {c.name} · {c.term}
                </div>
              </div>
            </div>
            <div className="course-card-chips">
              <span className="chip">{c.file_count ?? 0} files</span>
              <span className="chip">{c.assignment_count ?? 0} assignments</span>
              {c.last_sync_at && <span className="chip">{fmtRelative(c.last_sync_at)}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
