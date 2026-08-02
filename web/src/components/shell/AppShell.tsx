import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CalendarDays,
  MessageSquare,
  MoreHorizontal,
  Sunrise,
} from 'lucide-react'
import { ChatProvider } from '@/chat/ChatContext'
import { Sidebar } from './Sidebar'

const MOBILE_TABS = [
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: true },
  { to: '/', label: 'Today', icon: Sunrise, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/courses', label: 'Courses', icon: BookOpen, end: false },
  { to: '/more', label: 'More', icon: MoreHorizontal, end: false },
]

export function AppShell() {
  const location = useLocation()
  // Remount transitions on top-level view changes only, so drilling into
  // content nodes within a course doesn't replay the page animation.
  const transitionKey = location.pathname.split('/').slice(0, 3).join('/')

  return (
    <ChatProvider>
      <div className="shell">
        <Sidebar />
        <main className="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={transitionKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        <nav className="tabbar">
          {MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `tabbar-tab${isActive ? ' active' : ''}`}
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </ChatProvider>
  )
}
