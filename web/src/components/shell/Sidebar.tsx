import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  CalendarDays,
  GraduationCap,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sunrise,
} from 'lucide-react'
import { api } from '@/api/client'
import { courseColor } from '@/lib/courses'
import type { Course } from '@/types'

const NAV = [
  { to: '/', label: 'Chat', icon: MessageSquare, end: true },
  { to: '/today', label: 'Today', icon: Sunrise, end: false },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/sync', label: 'Sync', icon: RefreshCw, end: false },
]

export function Sidebar() {
  const [courses, setCourses] = useState<Course[]>([])
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('hc.sidebar.collapsed') === '1',
  )

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('hc.sidebar.collapsed', c ? '0' : '1')
      return !c
    })
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="brand">
        <div className="logo-mark">
          <GraduationCap size={17} />
        </div>
        <span className="brand-name side-label">HippoCampus</span>
      </div>

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
