import { Fragment, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { api } from '@/api/client'
import { fmtDue, isPast } from '@/lib/format'
import type { Assignment } from '@/types'

function statusChip(a: Assignment): { cls: string; label: string } {
  if (a.status === 'submitted' || a.status === 'graded') return { cls: 'chip green', label: a.status }
  if (a.status === 'extended') return { cls: 'chip amber', label: a.status }
  if (a.closed) return { cls: 'chip', label: 'Closed' }
  if (isPast(a.due_at)) return { cls: 'chip red', label: 'overdue' }
  return { cls: 'chip', label: 'open' }
}

export function AssignmentsPage() {
  const { courseId } = useParams()
  const cid = Number(courseId)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .assignments(cid)
      .then(setAssignments)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [cid])

  // due date ascending; no-due assignments sink to the bottom
  const sorted = [...assignments].sort((a, b) => {
    if (!a.due_at && !b.due_at) return a.title.localeCompare(b.title)
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return a.due_at.localeCompare(b.due_at)
  })

  // sectioned by the dropbox category tag (Labs, Project); untagged first
  const untagged = sorted.filter((a) => !a.category)
  const tags = [...new Set(sorted.map((a) => a.category).filter(Boolean))].sort()

  const row = (a: Assignment) => {
    const s = statusChip(a)
    return (
      <Link
        className="row"
        key={a.id}
        to={`/courses/${cid}/assignments/${a.id}`}
        style={{
          alignItems: 'center',
          textDecoration: 'none',
          color: 'inherit',
          opacity: a.closed ? 0.55 : 1,
        }}
      >
        <div className="row-main">
          <div className="row-title">
            {a.group_name ? `${a.group_name}: ` : ''}
            {a.title}
          </div>
          <div className="row-sub">{fmtDue(a.due_at)}</div>
        </div>
        <span className={s.cls}>{s.label}</span>
      </Link>
    )
  }

  return (
    <div className="card assign-card">
      <p className="card-title">
        <ClipboardList size={14} /> Assignments
      </p>
      <div className="assign-scroll">
        {loading && <div className="empty compact">Loading…</div>}
        {!loading && sorted.length === 0 && (
          <div className="empty compact">No assignments synced for this course.</div>
        )}
        {!loading && untagged.map(row)}
        {!loading &&
          tags.map((tag) => (
            <Fragment key={tag}>
              <p className="rubric-name" style={{ marginTop: 8 }}>
                {tag}
              </p>
              {sorted.filter((a) => a.category === tag).map(row)}
            </Fragment>
          ))}
      </div>
    </div>
  )
}
