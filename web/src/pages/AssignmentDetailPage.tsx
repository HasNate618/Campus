import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList, ExternalLink } from 'lucide-react'
import { api } from '@/api/client'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import { fmtDue, isPast } from '@/lib/format'
import type { Assignment, Rubric, RubricCell } from '@/types'

function cellText(c?: RubricCell): string {
  const t = c?.Description?.Text || c?.Feedback?.Text || ''
  return t.replace(/\r?\n/g, ' ').trim()
}

/** Compact D2L rubric grid: levels as columns, criteria as rows. */
function RubricView({ rubrics }: { rubrics: Rubric[] }) {
  return (
    <div className="rubric-view">
      {rubrics.map((rb) => (
        <div key={rb.RubricId} className="rubric">
          <p className="rubric-name">{rb.Name}</p>
          {rb.CriteriaGroups?.map((g, gi) => (
            <table key={gi} className="rubric-table">
              <thead>
                <tr>
                  <th>Criterion</th>
                  {g.Levels?.map((lv) => (
                    <th key={lv.Id}>
                      {lv.Name}
                      {lv.Points != null ? ` · ${lv.Points}` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.Criteria?.map((c) => (
                  <tr key={c.Id}>
                    <td className="rubric-crit">{c.Name}</td>
                    {g.Levels?.map((lv, li) => (
                      <td key={lv.Id}>{cellText(c.Cells?.[li]) || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </div>
  )
}

function statusChip(a: Assignment): { cls: string; label: string } {
  if (a.status === 'submitted' || a.status === 'graded') return { cls: 'chip green', label: a.status }
  if (a.status === 'extended') return { cls: 'chip amber', label: a.status }
  if (isPast(a.due_at)) return { cls: 'chip red', label: 'overdue' }
  return { cls: 'chip', label: 'open' }
}

export function AssignmentDetailPage() {
  const { courseId, assignmentId } = useParams()
  const cid = Number(courseId)
  const aid = Number(assignmentId)
  const [a, setA] = useState<Assignment | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .assignment(cid, aid)
      .then(setA)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [cid, aid])

  if (loading) return <div className="empty compact">Loading…</div>
  if (!a) return <div className="empty compact">Assignment not found.</div>

  const s = statusChip(a)
  return (
    <div className="card" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <Link className="icon-btn" to={`/courses/${cid}/assignments`} title="Back to assignments">
          <ArrowLeft size={14} />
        </Link>
        <h2 className="page-title" style={{ margin: 0, fontSize: 17 }}>
          {a.title}
        </h2>
        <span className={s.cls}>{s.label}</span>
      </div>
      <div className="row-sub" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>
          <ClipboardList size={12} style={{ verticalAlign: -2 }} /> {fmtDue(a.due_at)}
        </span>
        {a.weight != null ? <span>· {a.weight}%</span> : null}
        {a.url && (
          <a className="btn btn-outline btn-sm" href={a.url} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={12} /> Open in Brightspace
          </a>
        )}
      </div>
      {a.description?.trim() && (
        <>
          <p className="rubric-name">Description</p>
          <ZenMarkdown content={sanitizeHtml(a.description)} />
        </>
      )}
      {a.rubrics?.length ? <RubricView rubrics={a.rubrics} /> : null}
    </div>
  )
}
