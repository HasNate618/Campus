import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  GraduationCap,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { useChat } from '@/chat/ChatContext'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import type { Course } from '@/types'

const NAV = [{ to: '/', label: 'Home', icon: Home, end: true }]

export function Sidebar() {
  const [courses, setCourses] = useState<Course[]>([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hc.sidebar.collapsed') === '1',
  )
  const { sessions, activeFor, openSession, deleteSession } = useChat()
  const navigate = useNavigate()

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('hc.sidebar.collapsed', c ? '0' : '1')
      return !c
    })
  }

  const recentChats = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  const courseById = new Map(courses.map((c) => [c.id, c]))

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="logo-mark">
          <GraduationCap size={17} />
        </div>
        <span className="brand-name side-label">Campus</span>
      </div>

      <div className="sidebar-scroll">
        <nav>
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

        {recentChats.length > 0 && (
          <>
            <p className="section-label">Recent Chats</p>
            <div className="sidebar-list">
              {recentChats.map((s) => {
                const c = courseById.get(s.courseId)
                const active = activeFor(s.courseId)?.id === s.id
                return (
                  <div
                    key={s.id}
                    className={`session-item${active ? ' active' : ''}`}
                  >
                    <button
                      className="session-btn"
                      title={`${c?.code ?? 'Course'} — ${s.title}`}
                      onClick={() => {
                        openSession(s.courseId, s.id)
                        navigate(`/courses/${s.courseId}`)
                      }}
                    >
                      <span
                        className="dot"
                        style={{ background: c ? courseColor(c) : 'var(--violet)', flexShrink: 0 }}
                      />
                      <span className="session-title">{s.title}</span>
                      <span className="session-time">
                        {fmtRelative(new Date(s.updatedAt).toISOString())}
                      </span>
                    </button>
                    <button
                      className="icon-btn session-delete"
                      title="Delete chat"
                      onClick={() => deleteSession(s.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <p className="section-label">Courses</p>
        <div className="sidebar-list">
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
