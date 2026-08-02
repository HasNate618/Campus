import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { AppCard as Card } from '@/components/AppCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/badge'
import type { Course } from '@/types'

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    api.courses(!showInactive).then(setCourses).catch(console.error)
  }, [showInactive])

  return (
    <div className="page">
      <PageHeader
        title="Courses"
        action={
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'hsl(var(--muted-foreground))', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        }
      />

      {courses.map((c) => (
        <Link key={c.id} to={`/courses/${c.id}`} className="course-card">
          <Card padding="sm">
            <div className="course-card__top">
              <div>
                <div className="course-card__title">{c.code} · {c.name}</div>
                <div className="course-card__subtitle">
                  {c.term}{c.instructor ? ` · ${c.instructor}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {c.is_pilot ? <Badge variant="secondary">Pilot</Badge> : null}
                {!c.last_sync_at && <Badge variant="outline">Not synced</Badge>}
              </div>
            </div>
            <div className="course-card__footer">
              {c.last_sync_at
                ? `Last sync ${new Date(c.last_sync_at).toLocaleDateString('en-CA')} · ${c.file_count ?? 0} files · ${c.assignment_count ?? 0} assignments`
                : 'Not synced yet'}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  )
}
