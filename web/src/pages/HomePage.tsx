import { Link } from 'react-router-dom'
import { BookOpen, CalendarDays, GraduationCap, RefreshCw, Sunrise } from 'lucide-react'
import { ChatView } from '@/chat/ChatView'

const DESTINATIONS = [
  { to: '/today', icon: Sunrise, label: 'Today', sub: 'Digest & this week' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar', sub: 'Month & events' },
  { to: '/courses', icon: BookOpen, label: 'Courses', sub: 'Content & assignments' },
  { to: '/sync', icon: RefreshCw, label: 'Sync', sub: 'Runs & logs' },
]

export function HomePage() {
  return (
    <>
      <div className="home-desktop">
        <div className="logo-mark" style={{ width: 52, height: 52, borderRadius: 15 }}>
          <GraduationCap size={28} />
        </div>
        <h1 className="greeting" style={{ fontSize: 24 }}>
          HippoCampus
        </h1>
        <p className="page-sub" style={{ margin: 0, textAlign: 'center' }}>
          Chat is docked on the left — or jump somewhere:
        </p>
        <div className="home-grid">
          {DESTINATIONS.map(({ to, icon: Icon, label, sub }) => (
            <Link key={to} to={to} className="home-card">
              <Icon size={17} style={{ color: 'var(--violet)' }} />
              <div>
                <div className="row-title">{label}</div>
                <div className="row-sub">{sub}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div className="home-mobile">
        <ChatView />
      </div>
    </>
  )
}
