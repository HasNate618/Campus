import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ClipboardList, ExternalLink, ListChecks } from 'lucide-react'
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

  const [openRubric, setOpenRubric] = useState<number | null>(null)

  // due date ascending; no-due assignments sink to the bottom
  const sorted = [...assignments].sort((a, b) => {
    if (!a.due_at && !b.due_at) return a.title.localeCompare(b.title)
    if (!a.due_at) return 1
    if (!b.due_at) return -1
    return a.due_at.localeCompare(b.due_at)
  })

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
          const open = openRubric === a.id
          return (
            <div className="row" key={a.id} style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
              <div style={{ display: 'flex', width: '100%', gap: 12, alignItems: 'flex-start' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {a.rubrics?.length ? (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setOpenRubric(open ? null : a.id)}
                    title="Show the marking rubric"
                  >
                    <ListChecks size={12} /> Rubric
                  </button>
                ) : null}
                {a.url && (
                  <a
                    className="icon-btn"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Open in Brightspace"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
                <span className={s.cls}>{s.label}</span>
              </div>
              </div>
              {open && <RubricView rubrics={a.rubrics ?? []} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
