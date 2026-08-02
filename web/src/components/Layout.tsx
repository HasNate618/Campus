import { Link, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Calendar,
  Home,
  MessageSquare,
  RefreshCw,
  BookOpen,
} from 'lucide-react'
import { api } from '../api/client'
import { CourseSwitcher, SidebarNav } from './CourseSwitcher'
import { ChatPanel } from './ChatPanel'

function useCourseIdFromPath(): number | null {
  const location = useLocation()
  const match = location.pathname.match(/\/courses\/(\d+)/)
  return match ? Number(match[1]) : null
}

export function Layout() {
  const location = useLocation()
  const courseId = useCourseIdFromPath()
  const [syncLabel, setSyncLabel] = useState('…')
  const [syncOk, setSyncOk] = useState(true)

  useEffect(() => {
    api.syncStatus().then((s) => {
      if (!s.last_run) {
        setSyncLabel('Never synced')
        setSyncOk(false)
        return
      }
      const ago = formatAgo(s.last_run.finished_at ?? s.last_run.started_at)
      setSyncLabel(`${ago}`)
      setSyncOk(s.last_run.status === 'ok')
    }).catch(() => setSyncLabel('Unknown'))
  }, [location.pathname])

  const mobileLinks = [
    { to: '/today', label: 'Today', icon: Home },
    { to: '/courses', label: 'Courses', icon: BookOpen },
    { to: '/calendar', label: 'Calendar', icon: Calendar },
    { to: '/sync', label: 'Sync', icon: RefreshCw },
    { to: '/chat', label: 'Chat', icon: MessageSquare },
  ]

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/today" className="app-header__logo">
          <span className="app-header__logo-icon">
            <BookOpen size={15} strokeWidth={2.25} />
          </span>
          HippoCampus
        </Link>
        <span className="app-header__term">2026F</span>
        <Link to="/sync" className="app-header__sync">
          <span className={`status-dot ${syncOk ? 'ok' : 'failed'}`} />
          {syncLabel}
        </Link>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <CourseSwitcher />
          <SidebarNav />
        </aside>
        <main className="main-content">
          <Outlet />
        </main>
        {location.pathname !== '/chat' && <ChatPanel courseId={courseId} />}
      </div>
      <nav className="mobile-nav">
        {mobileLinks.map((l) => {
          const Icon = l.icon
          const active = location.pathname === l.to || (l.to !== '/today' && location.pathname.startsWith(l.to))
          return (
            <Link key={l.to} to={l.to} className={active ? 'active' : ''}>
              <Icon strokeWidth={active ? 2.25 : 1.75} />
              {l.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
