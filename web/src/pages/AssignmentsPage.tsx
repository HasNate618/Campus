import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Assignment } from '../types'

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
      <h1 className="page-title">Assignments</h1>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'upcoming', 'past'] as const).map((f) => (
          <button key={f} className={filter === f ? '' : 'secondary'} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {filter === 'upcoming'
            ? 'No upcoming assignments. Term may be complete or not synced.'
            : 'No assignments found.'}
        </p>
      ) : (
        filtered.map((a) => (
          <div key={a.id} className="card" style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{a.title}</div>
            {a.due_at && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Due: {new Date(a.due_at).toLocaleString('en-CA')}
                {a.due_at < now ? ' · Past' : ''}
                {a.weight != null ? ` · Weight: ${a.weight}%` : ''}
              </div>
            )}
            <div style={{ marginTop: '0.35rem' }}>
              <span className="badge">{a.status}</span>
            </div>
            {a.description && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{a.description}</p>
            )}
            {a.notes && (
              <p style={{ fontSize: '0.8rem', marginTop: '0.35rem', fontStyle: 'italic' }}>{a.notes}</p>
            )}
            <Link to="/chat" style={{ fontSize: '0.85rem', display: 'inline-block', marginTop: '0.5rem' }}>
              Ask in chat →
            </Link>
          </div>
        ))
      )}
    </div>
  )
}
