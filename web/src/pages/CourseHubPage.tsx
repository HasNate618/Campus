import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Bell, CalendarDays } from 'lucide-react'
import { api } from '@/api/client'
import { ChatView } from '@/chat/ChatView'
import { useChat } from '@/chat/ChatContext'
import { SplitPane } from '@/components/SplitPane'
import { useZoneKeys } from '@/lib/keynav'
import { sanitizeHtml } from '@/lib/sanitize'
import { courseColor } from '@/lib/courses'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import type { Announcement, Course, CourseHub } from '@/types'

// Course tab order for [ / ] keyboard switching ('' = Overview).
const TAB_ORDER = ['', 'content', 'assignments', 'workspace']

function AnnouncementRow({ a }: { a: Announcement }) {
  // Rich HTML body (links + real paragraph spacing) when the sync has it —
  // falls back to the plain text body (pre-wrap) until the next sync.
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="row-main">
        <div className="row-title announce-title">{a.title}</div>
        {a.body_html ? (
          <div className="md html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body_html) }} />
        ) : a.body ? (
          <div className="row-sub" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
        ) : null}
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
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [course, setCourse] = useState<Course | null>(null)
  const { setLastCourse } = useChat()
  // Alt+2 / Alt+3 hide the course pane / chat pane (persisted).
  const [hideCourse, setHideCourse] = useState(() => localStorage.getItem('hc.split.hideCourse') === '1')
  const [hideChat, setHideChat] = useState(() => localStorage.getItem('hc.split.hideChat') === '1')

  useEffect(() => {
    const h = (e: Event) => {
      const pane = (e as CustomEvent).detail?.pane
      if (pane === 'course') {
        setHideCourse((v) => {
          localStorage.setItem('hc.split.hideCourse', v ? '0' : '1')
          return !v
        })
      } else if (pane === 'chat') {
        setHideChat((v) => {
          localStorage.setItem('hc.split.hideChat', v ? '0' : '1')
          return !v
        })
      }
    }
    window.addEventListener('campus:toggle-pane', h)
    return () => window.removeEventListener('campus:toggle-pane', h)
  }, [])

  useEffect(() => {
    setCourse(null)
    setLastCourse(cid)
    api.course(cid).then(setCourse).catch(console.error)
  }, [cid, setLastCourse])

  // [ / ] switch course tabs (Overview · Content · Assignments · Workspace),
  // wrapping at the ends. Registered for the course zone; page-level
  // handlers (ContentPage j/k etc.) run first and return false for these.
  useZoneKeys('course', (key) => {
    if (key !== '[' && key !== ']') return false
    const seg = pathname.split('/')[3] ?? ''
    let idx = TAB_ORDER.indexOf(seg)
    if (idx === -1) idx = 0
    const next = (idx + (key === ']' ? 1 : -1) + TAB_ORDER.length) % TAB_ORDER.length
    navigate(`/courses/${cid}${TAB_ORDER[next] ? `/${TAB_ORDER[next]}` : ''}`)
    return true
  })

  const page = (
    <div className="page course-page">
      <header className="course-head">
        <div className="course-head-main">
          <Link to="/courses" className="course-back mobile-only">
            <ArrowLeft size={14} /> Courses
          </Link>
          <div className="course-head-title">
            {course && (
              <span className="dot" style={{ background: courseColor(course), width: 10, height: 10 }} />
            )}
            <h1 className="page-title">{course?.code ?? '…'}</h1>
            {course && <span className="chip course-term">{course.term}</span>}
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
            <NavLink to={`/courses/${cid}/workspace`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
              Workspace
            </NavLink>
          </nav>
        </div>
        <nav className="course-tabs-mobile mobile-only" aria-label="Course sections">
          <NavLink to={`/courses/${cid}`} end className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
            Overview
          </NavLink>
          <NavLink to={`/courses/${cid}/content`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
            Content
          </NavLink>
          <NavLink to={`/courses/${cid}/assignments`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
            Assignments
          </NavLink>
          <NavLink to={`/courses/${cid}/workspace`} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
            Workspace
          </NavLink>
        </nav>
      </header>
      <div className="course-scroll">
        <div className="page-col">
          {/* Key by SECTION (overview / content / assignments) — tab
              switches keep their transition, but navigating inside a
              section (content nodes, assignment details) must NOT replay
              it: remounting the pane re-animates the content tree and
              resets its scroll on every click. */}
          <motion.div
            key={pathname.split('/').slice(0, 4).join('/')}
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
          >
            <Outlet />
          </motion.div>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {hideChat ? (
        // chat hidden: course page fills the pane
        page
      ) : hideCourse ? (
        // course hidden: chat fills the pane
        <ChatView key={cid} courseId={cid} course={course ?? undefined} />
      ) : (
        <SplitPane
          storageKey="hc.split.course"
          left={page}
          right={<ChatView key={cid} courseId={cid} course={course ?? undefined} />}
        />
      )}
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
