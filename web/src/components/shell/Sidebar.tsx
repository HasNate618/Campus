import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  GraduationCap,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SquarePen,
  Sunrise,
  Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { useChat } from '@/chat/ChatContext'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import { useIsDesktop } from '@/lib/useMediaQuery'
import type { Course } from '@/types'

const NAV = [
  { to: '/today', label: 'Today', icon: Sunrise, end: false },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/sync', label: 'Sync', icon: RefreshCw, end: false },
]

export function Sidebar() {
  const [courses, setCourses] = useState<Course[]>([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hc.sidebar.collapsed') === '1',
  )
  const { sessions, active, selectSession, deleteSession, newChat } = useChat()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('hc.sidebar.collapsed', c ? '0' : '1')
      return !c
    })
  }

  const openChat = (id: string) => {
    selectSession(id)
    if (!isDesktop) navigate('/')
  }

  const startNewChat = () => {
    newChat()
    if (!isDesktop) navigate('/')
  }

  const recentChats = sessions
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)

  const courseById = new Map(courses.map((c) => [c.id, c]))

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="logo-mark">
          <GraduationCap size={17} />
        </div>
        <span className="brand-name side-label">HippoCampus</span>
      </div>

      <div className="sidebar-scroll">
        <nav>
          <NavLink to="/" end title="Chat" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <MessageSquare size={17} />
            <span className="side-label">Chat</span>
          </NavLink>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={17} />
              <span className="side-label">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="section-head">
          <p className="section-label">Chats</p>
          <button className="icon-btn side-label" onClick={startNewChat} title="New chat">
            <SquarePen size={13} />
          </button>
        </div>
        <div>
          {recentChats.length === 0 && (
            <p className="side-label" style={{ padding: '0 20px', fontSize: 12, color: 'var(--text-3)', margin: '2px 0 6px' }}>
              No chats yet
            </p>
          )}
          {recentChats.map((s) => {
            const c = s.courseId != null ? courseById.get(s.courseId) : undefined
            return (
              <div key={s.id} className={`session-item${active?.id === s.id ? ' active' : ''}`}>
                <button className="session-btn" onClick={() => openChat(s.id)} title={s.title}>
                  <span
                    className="dot"
                    style={{ background: c ? courseColor(c) : 'var(--violet)', flexShrink: 0 }}
                  />
                  <span className="side-label session-title">{s.title}</span>
                  <span className="side-label session-time">{fmtRelative(new Date(s.updatedAt).toISOString())}</span>
                </button>
                <button
                  className="icon-btn session-delete"
                  onClick={() => deleteSession(s.id)}
                  title="Delete chat"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <p className="section-label">Courses</p>
        <div>
          {courses.map((c) => (
            <NavLink
              key={c.id}
              to={`/courses/${c.id}`}
              title={`${c.code} — ${c.name}`}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="dot" style={{ background: courseColor(c), margin: '0 5px' }} />
              <span className="side-label">{c.code}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ width: 'calc(100% - 20px)' }}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          <span className="side-label">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
