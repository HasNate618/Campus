import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Bell, CalendarDays } from 'lucide-react'
import { api } from '@/api/client'
import { ChatView } from '@/chat/ChatView'
import { useChat } from '@/chat/ChatContext'
import { SplitPane } from '@/components/SplitPane'
import { courseColor } from '@/lib/courses'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import type { Announcement, Course, CourseHub } from '@/types'

function AnnouncementRow({ a }: { a: Announcement }) {
  // Full body, never clamped — the overview panel scrolls internally.
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="row-main">
        <div className="row-title">{a.title}</div>
        {a.body && <div className="row-sub" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
      </div>
      <span className="chip" title={a.posted_at ?? undefined}>
        {fmtRelative(a.posted_at)}
      </span>
    </div>
  )
}

export function CourseLayout() {
  const { courseId } = useParams()
  const cid = Number(courseId)
  const [course, setCourse] = useState<Course | null>(null)
  const { setLastCourse } = useChat()

  useEffect(() => {
    setCourse(null)
    setLastCourse(cid)
    api.course(cid).then(setCourse).catch(console.error)
  }, [cid, setLastCourse])

  const page = (
    <div className="page course-page">
      <header className="course-head">
        <div className="course-head-main">
          <div className="course-head-title">
            {course && (
              <span className="dot" style={{ background: courseColor(course), width: 10, height: 10 }} />
            )}
            <h1 className="page-title">{course?.code ?? '…'}</h1>
            {course && <span className="chip">{course.term}</span>}
            <p className="page-sub course-head-name">{course?.name ?? ''}</p>
          </div>
        </div>
        <div className="course-head-right">
          <nav className="tabs">
            <NavLink to={`/courses/${cid}`} end className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
              Overview
            </NavLink>
            <NavLink to={`/courses/${cid}/content`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
              Content
            </NavLink>
            <NavLink to={`/courses/${cid}/assignments`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
              Assignments
            </NavLink>
          </nav>
        </div>
      </header>
      <div className="course-scroll">
        <div className="page-col">
          <Outlet />
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SplitPane
        storageKey="hc.split.course"
        left={page}
        right={<ChatView key={cid} courseId={cid} course={course ?? undefined} />}
      />
    </div>
  )
}

export function CourseHubPage() {
  const { courseId } = useParams()
  const cid = Number(courseId)
  const [hub, setHub] = useState<CourseHub | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHub(null)
    api
      .courseHub(cid)
      .then(setHub)
      .catch((e) => setError(String(e)))
  }, [cid])

  if (error) return <div className="card">Failed to load: {error}</div>
  if (!hub) return <div className="card"><div className="empty compact">Loading…</div></div>

  return (
    <div className="overview-body">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="chip">{hub.stats.file_count} files</span>
        <span className="chip">{hub.stats.processed_files} processed</span>
        <span className="chip">{hub.stats.assignment_count} assignments</span>
      </div>

      <div className="card announce-card">
        <p className="card-title">
          <Bell size={14} /> Announcements
        </p>
        <div className="announce-scroll">
          {hub.announcements.length === 0 && (
            <div className="empty compact">No announcements.</div>
          )}
          {hub.announcements.map((a) => (
            <AnnouncementRow key={a.id} a={a} />
          ))}
        </div>
      </div>

      <div className="card">
        <p className="card-title">
          <CalendarDays size={14} /> Upcoming
        </p>
        {hub.events.length === 0 && (
          <div className="empty compact">No upcoming events — the pilot term has ended.</div>
        )}
        {hub.events.map((e) => (
          <div className="row" key={e.id}>
            <div className="row-main">
              <div className="row-title">{e.title}</div>
              <div className="row-sub">{fmtDateTime(e.starts_at)}</div>
            </div>
            <span className="chip">{e.kind}</span>
          </div>
        ))}
        {hub.assignments_upcoming.map((a) => (
          <div className="row" key={`a-${a.id}`}>
            <div className="row-main">
              <div className="row-title">{a.title}</div>
              <div className="row-sub">due {fmtDateTime(a.due_at)}</div>
            </div>
            <span className="chip violet">assignment</span>
          </div>
        ))}
      </div>
    </div>
  )
}
