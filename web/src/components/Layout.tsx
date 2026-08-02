import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  Calendar,
  Home,
  MessageSquare,
  PanelLeft,
  RefreshCw,
} from 'lucide-react'
import { api } from '@/api/client'
import { CourseSwitcher, SidebarNav } from './CourseSwitcher'
import { ChatPanel } from './ChatPanel'
import { PageTransition } from './PageTransition'
import { usePanelLayout } from '@/hooks/usePanelLayout'
import { cn } from '@/lib/utils'

function useCourseIdFromPath(): number | null {
  const location = useLocation()
  const match = location.pathname.match(/\/courses\/(\d+)/)
  return match ? Number(match[1]) : null
}

const panelMotion = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

const chatMotion = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 12 },
}

export function Layout() {
  const location = useLocation()
  const courseId = useCourseIdFromPath()
  const [syncLabel, setSyncLabel] = useState('…')
  const [syncOk, setSyncOk] = useState(true)
  const showChat = location.pathname !== '/chat'

  const {
    sidebarOpen,
    chatOpen,
    toggleSidebar,
    toggleChat,
  } = usePanelLayout()

  useEffect(() => {
    api.syncStatus().then((s) => {
      if (!s.last_run) {
        setSyncLabel('Never synced')
        setSyncOk(false)
        return
      }
      setSyncLabel(formatAgo(s.last_run.finished_at ?? s.last_run.started_at))
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
      <div
        className={cn(
          'app-canvas',
          sidebarOpen && 'app-canvas--sidebar-open',
          chatOpen && showChat && 'app-canvas--chat-open',
        )}
      >
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              key="sidebar"
              className="float-panel float-panel--sidebar"
              variants={panelMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <div className="panel__brand">
                <Link to="/today" className="brand">
                  <span className="brand__mark">H</span>
                  <span className="brand__name">HippoCampus</span>
                  <span className="brand__term">2026F</span>
                </Link>
              </div>
              <CourseSwitcher />
              <SidebarNav />
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="main-stage">
          <header className="main-stage__topbar">
            <button
              type="button"
              className={cn('icon-btn', 'topbar-panel-btn', sidebarOpen && 'active')}
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
            >
              <PanelLeft size={16} />
            </button>
            {!sidebarOpen && (
              <Link to="/today" className="brand-mini">
                <span className="brand__mark">H</span>
                <span>HippoCampus</span>
              </Link>
            )}
            <div className="main-stage__topbar-spacer" />
            <Link to="/sync" className="sync-chip">
              <span className={cn('status-dot', syncOk ? 'ok' : 'failed')} />
              Synced {syncLabel}
            </Link>
            {showChat && (
              <button
                type="button"
                className={cn('icon-btn', 'topbar-panel-btn', chatOpen && 'active')}
                onClick={toggleChat}
                aria-label="Toggle chat"
              >
                <MessageSquare size={16} />
              </button>
            )}
          </header>
          <div className="main-stage__scroll">
            <PageTransition />
          </div>
        </main>

        <AnimatePresence>
          {showChat && chatOpen && (
            <motion.aside
              key="chat"
              className="float-panel float-panel--chat"
              variants={chatMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <ChatPanel courseId={courseId} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <nav className="mobile-dock">
        {mobileLinks.map((l) => {
          const Icon = l.icon
          const active = location.pathname === l.to || (l.to !== '/today' && location.pathname.startsWith(l.to))
          return (
            <Link key={l.to} to={l.to} className={active ? 'active' : ''}>
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span>{l.label}</span>
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
