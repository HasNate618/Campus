import { Link, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
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

  useEffect(() => {
    api.syncStatus().then((s) => {
      if (!s.last_run) {
        setSyncLabel('Never synced')
        return
      }
      const ago = formatAgo(s.last_run.finished_at ?? s.last_run.started_at)
      const dot = s.last_run.status === 'ok' ? 'ok' : s.last_run.status === 'failed' ? 'failed' : 'running'
      setSyncLabel(`${ago} · ${s.last_run.status}`)
      setSyncLabel((prev) => prev) // keep for eslint
      void dot
      setSyncLabel(`${ago} · ${s.last_run.status}`)
    }).catch(() => setSyncLabel('Unknown'))
  }, [location.pathname])

  const mobileLinks = [
    { to: '/today', label: 'Today' },
    { to: '/courses', label: 'Courses' },
    { to: '/calendar', label: 'Calendar' },
    { to: '/sync', label: 'Sync' },
    { to: '/chat', label: 'Chat' },
  ]

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/today" className="logo">🦛 HippoCampus</Link>
        <span className="term-badge">2026F · Western</span>
        <Link to="/sync" className="sync-pill">
          <span className="status-dot ok" />
          Sync: {syncLabel}
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
        {mobileLinks.map((l) => (
          <Link key={l.to} to={l.to} className={location.pathname.startsWith(l.to) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
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
