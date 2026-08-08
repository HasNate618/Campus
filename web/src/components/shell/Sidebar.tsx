import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  GraduationCap,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { useChat } from '@/chat/ChatContext'
import { listKeys, useKeyNav, useListCursor, useZoneKeys } from '@/lib/keynav'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import type { Course } from '@/types'

const NAV = [{ to: '/', label: 'Home', icon: Home, end: true }]

export function Sidebar() {
  const [courses, setCourses] = useState<Course[]>([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hc.sidebar.collapsed') === '1',
  )
  const { sessions, activeFor, openSession, renameSession, deleteSession } = useChat()
  const navigate = useNavigate()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const { zone } = useKeyNav()

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

  // Flat list of keyboard-navigable rows in DOM order: Home, recent chats,
  // courses. Enter activates each kind.
  const rows = useMemo(() => {
    const r: { kind: 'nav' | 'chat' | 'course'; to?: string; sessionId?: string; courseId?: number }[] = []
    for (const n of NAV) r.push({ kind: 'nav', to: n.to })
    for (const s of recentChats) r.push({ kind: 'chat', sessionId: s.id, courseId: s.courseId })
    for (const c of courses) r.push({ kind: 'course', courseId: c.id, to: `/courses/${c.id}` })
    return r
  }, [recentChats, courses])

  const cursor = useListCursor(rows.length)

  useZoneKeys('sidebar', (key) => {
    if (key === 'c') {
      toggle()
      return true
    }
    return listKeys(key, cursor, () => {
      const row = rows[cursor.cursor]
      if (!row) return
      if (row.kind === 'nav' && row.to) navigate(row.to)
      else if (row.kind === 'chat' && row.sessionId && row.courseId != null) {
        openSession(row.courseId, row.sessionId)
        navigate(`/courses/${row.courseId}`)
      } else if (row.kind === 'course' && row.courseId != null) {
        navigate(`/courses/${row.courseId}`)
      }
    })
  })

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${zone === 'sidebar' ? ' kbd-active' : ''}`}>
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
              ref={cursor.setRef(0)}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}${cursor.cursor === 0 ? ' kbd-cursor' : ''}`
              }
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
              {recentChats.map((s, i) => {
                const c = courseById.get(s.courseId)
                const active = activeFor(s.courseId)?.id === s.id
                return (
                  <div
                    key={s.id}
                    ref={cursor.setRef(i + 1)}
                    className={`session-item${active ? ' active' : ''}${cursor.cursor === i + 1 ? ' kbd-cursor' : ''}`}
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
                      {renamingId === s.id ? (
                        <input
                          className="session-rename"
                          value={renameText}
                          autoFocus
                          onChange={(e) => setRenameText(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              renameSession(s.id, renameText)
                              setRenamingId(null)
                            } else if (e.key === 'Escape') {
                              setRenamingId(null)
                            }
                          }}
                          onBlur={() => {
                            if (renamingId === s.id) {
                              renameSession(s.id, renameText)
                              setRenamingId(null)
                            }
                          }}
                        />
                      ) : (
                        <span className="session-title">{s.title}</span>
                      )}
                      <span className="session-time">
                        {fmtRelative(new Date(s.updatedAt).toISOString())}
                      </span>
                    </button>
                    <button
                      className="icon-btn session-rename-btn"
                      title="Rename chat"
                      onClick={() => {
                        setRenamingId(s.id)
                        setRenameText(s.title)
                      }}
                    >
                      <Pencil size={12} />
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
          {courses.map((c, i) => (
            <NavLink
              key={c.id}
              to={`/courses/${c.id}`}
              title={`${c.code} — ${c.name}`}
              ref={cursor.setRef(i + 1 + recentChats.length)}
              className={({ isActive }) =>
                `nav-item${isActive ? ' active' : ''}${cursor.cursor === i + 1 + recentChats.length ? ' kbd-cursor' : ''}`
              }
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
