import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Home,
  MessageSquare,
  PanelLeft,
  PanelRight,
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
  initial: { opacity: 0, x: -16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
}

const chatMotion = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 16 },
}

export function Layout() {
  const location = useLocation()
  const courseId = useCourseIdFromPath()
  const [syncLabel, setSyncLabel] = useState('…')
  const [syncOk, setSyncOk] = useState(true)
  const showChat = location.pathname !== '/chat'

  const {
    narrow,
    sidebarOpen,
    chatOpen,
    toggleSidebar,
    toggleChat,
    closeSidebar,
    closeChat,
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
        {/* Sidebar toggle (when closed) */}
        {!sidebarOpen && (
          <button
            type="button"
            className="panel-toggle panel-toggle--left"
            onClick={toggleSidebar}
            aria-label="Open sidebar"
          >
            <PanelLeft size={18} />
          </button>
        )}

        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              key="sidebar"
              className="float-panel float-panel--sidebar"
              variants={panelMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <button
                type="button"
                className="float-panel__close"
                onClick={closeSidebar}
                aria-label="Close sidebar"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="panel__brand">
                <Link to="/today" className="brand">
                  <span className="brand__mark">H</span>
                  <span className="brand__name">HippoCampus</span>
                </Link>
                <span className="brand__term">2026F</span>
              </div>
              <CourseSwitcher />
              <SidebarNav />
            </motion.aside>
          )}
        </AnimatePresence>

        <main className="main-stage">
          <header className="main-stage__topbar">
            {narrow && sidebarOpen && (
              <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
                <PanelLeft size={18} />
              </button>
            )}
            <div className="main-stage__topbar-spacer" />
            <Link to="/sync" className="sync-chip">
              <span className={cn('status-dot', syncOk ? 'ok' : 'failed')} />
              Synced {syncLabel}
            </Link>
            {narrow && showChat && chatOpen && (
              <button type="button" className="icon-btn" onClick={toggleChat} aria-label="Toggle chat">
                <PanelRight size={18} />
              </button>
            )}
          </header>
          <div className="main-stage__scroll">
            <PageTransition />
          </div>
        </main>

        {showChat && !chatOpen && (
          <button
            type="button"
            className="panel-toggle panel-toggle--right"
            onClick={toggleChat}
            aria-label="Open chat"
          >
            <MessageSquare size={18} />
          </button>
        )}

        <AnimatePresence>
          {showChat && chatOpen && (
            <motion.aside
              key="chat"
              className="float-panel float-panel--chat"
              variants={chatMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <button
                type="button"
                className="float-panel__close float-panel__close--right"
                onClick={closeChat}
                aria-label="Close chat"
              >
                <ChevronRight size={16} />
              </button>
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
              <Icon strokeWidth={active ? 2.25 : 1.75} />
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
