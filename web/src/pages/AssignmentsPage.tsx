import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { api } from '@/api/client'
import { listKeys, useListCursor, useZoneKeys } from '@/lib/keynav'
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
  const navigate = useNavigate()
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

  // sectioned by the dropbox category tag (Labs, Project); untagged first,
  // closed assignments sink to a Closed section at the bottom
  const openItems = sorted.filter((a) => !a.closed)
  const closedItems = sorted.filter((a) => a.closed)
  const untagged = openItems.filter((a) => !a.category)
  const tags = [...new Set(openItems.map((a) => a.category).filter(Boolean))].sort()

  // rows in DOM render order (section headers excluded) for j/k navigation
  const ordered = useMemo(
    () => [
      ...untagged,
      ...tags.flatMap((t) => openItems.filter((a) => a.category === t)),
      ...closedItems,
    ],
    [untagged, tags, openItems, closedItems],
  )
  const cursor = useListCursor(ordered.length)
  const idxById = useMemo(() => {
    const m = new Map<number, number>()
    ordered.forEach((a, i) => m.set(a.id, i))
    return m
  }, [ordered])

  useZoneKeys('course', (key) =>
    listKeys(key, cursor, () => {
      const a = ordered[cursor.cursor]
      if (a) navigate(`/courses/${cid}/assignments/${a.id}`)
    }),
  )

  const row = (a: Assignment, i: number) => {
    const s = statusChip(a)
    return (
      <Link
        className={`row${cursor.cursor === i ? ' kbd-cursor' : ''}`}
        key={a.id}
        ref={cursor.setRef(i)}
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
        {!loading && untagged.map((a, i) => row(a, i))}
        {!loading &&
          tags.map((tag) => (
            <Fragment key={tag}>
              <p className="rubric-name" style={{ marginTop: 8 }}>
                {tag}
              </p>
              {openItems
                .filter((a) => a.category === tag)
                .map((a) => row(a, idxById.get(a.id) ?? 0))}
            </Fragment>
          ))}
        {!loading && closedItems.length > 0 && (
          <>
            <p className="rubric-name" style={{ marginTop: 8 }}>
              Closed
            </p>
            {closedItems.map((a) => row(a, idxById.get(a.id) ?? 0))}
          </>
        )}
      </div>
    </div>
  )
}
