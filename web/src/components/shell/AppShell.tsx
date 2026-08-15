import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, CalendarDays, Home, MessageSquare } from 'lucide-react'
import { ChatProvider } from '@/chat/ChatContext'
import { KeyNavProvider } from '@/lib/keynav'
import { Sidebar } from './Sidebar'

const MOBILE_TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: true },
  { to: '/courses', label: 'Courses', icon: BookOpen, end: false },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays, end: true },
]

function ShellInner({ onLogout }: { onLogout: () => void }) {
  const location = useLocation()
  // Remount transitions on top-level view changes only, so drilling into
  // content nodes within a course doesn't replay the page animation.
  const transitionKey = location.pathname.split('/').slice(0, 3).join('/')

  return (
    <ChatProvider>
      <div className="shell">
        <Sidebar onLogout={onLogout} />
        <main className="main" data-kbd-zone="course">
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

export function AppShell({ onLogout }: { onLogout: () => void }) {
  return (
    <KeyNavProvider>
      <ShellInner onLogout={onLogout} />
    </KeyNavProvider>
  )
}
