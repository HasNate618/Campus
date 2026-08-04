import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { api } from '@/api/client'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import { fmtDue, isPast } from '@/lib/format'
import type { Assignment } from '@/types'

function statusChip(a: Assignment): { cls: string; label: string } {
  if (a.status === 'submitted' || a.status === 'graded') return { cls: 'chip green', label: a.status }
  if (a.due_at && isPast(a.due_at)) return { cls: 'chip red', label: 'overdue' }
  return { cls: 'chip violet', label: a.status || 'pending' }
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

  const sorted = [...assignments].sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))

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
        {sorted.map((a) => {
          const s = statusChip(a)
          return (
            <div className="row" key={a.id} style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">{a.title}</div>
                <div className="row-sub">
                  {fmtDue(a.due_at)}
                  {a.weight != null ? ` · ${a.weight}%` : ''}
                  {a.notes ? ` · ${a.notes}` : ''}
                </div>
                {a.description?.trim() ? (
                  <ZenMarkdown content={sanitizeHtml(a.description)} />
                ) : null}
              </div>
              <span className={s.cls}>{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
