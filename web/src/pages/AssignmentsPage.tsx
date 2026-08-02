import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { AppCard as Card } from '@/components/AppCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Assignment } from '@/types'

export function AssignmentsPage() {
  const { courseId } = useParams()
  const id = Number(courseId)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all')

  useEffect(() => {
    api.assignments(id).then(setAssignments).catch(console.error)
  }, [id])

  const now = new Date().toISOString()
  const filtered = assignments.filter((a) => {
    if (filter === 'upcoming') return a.due_at && a.due_at > now && !['submitted', 'graded'].includes(a.status)
    if (filter === 'past') return a.due_at && a.due_at <= now
    return true
  })

  return (
    <div>
      <PageHeader title="Assignments" />
      <div className="filter-bar">
        {(['all', 'upcoming', 'past'] as const).map((f) => (
          <Button key={f} variant={filter === f ? 'default' : 'secondary'} size="sm" onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState>
          {filter === 'upcoming'
            ? 'No upcoming assignments. Term may be complete or not synced.'
            : 'No assignments found.'}
        </EmptyState>
      ) : (
        filtered.map((a) => (
          <Card key={a.id} padding="sm" className="assignment-card">
            <div className="assignment-card__title">{a.title}</div>
            {a.due_at && (
              <div className="assignment-card__meta">
                Due {new Date(a.due_at).toLocaleString('en-CA')}
                {a.due_at < now ? ' · Past' : ''}
                {a.weight != null ? ` · ${a.weight}%` : ''}
              </div>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <Badge variant="outline">{a.status}</Badge>
            </div>
            {a.description && <p className="list-item__body">{a.description}</p>}
            {a.notes && <p className="assignment-card__notes">{a.notes}</p>}
            <Link to="/chat" className="text-link" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
              Ask in chat →
            </Link>
          </Card>
        ))
      )}
    </div>
  )
}
