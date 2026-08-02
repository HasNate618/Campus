import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  Info,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Sunrise,
} from 'lucide-react'
import { COURSES, DUE_THIS_WEEK, UPCOMING_EVENTS } from './mock'
import { DemoChat } from './DemoChat'
import './demo.css'

type Tab = 'chat' | 'today' | 'calendar' | 'courses' | 'more'

const NAV: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'today', label: 'Today', icon: Sunrise },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'courses', label: 'Courses', icon: BookOpen },
]

const MOBILE_TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  ...NAV,
  { id: 'more', label: 'More', icon: MoreHorizontal },
]

export default function DemoApp() {
  const [tab, setTab] = useState<Tab>('chat')
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="demo-root">
      <aside className={`demo-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="demo-brand">
          <div className="demo-logo-mark">
            <GraduationCap size={17} />
          </div>
          <span className="demo-brand-name demo-label">HippoCampus</span>
        </div>

        <nav className="demo-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`demo-nav-item${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
              title={label}
            >
              <Icon size={17} />
              <span className="demo-label">{label}</span>
            </button>
          ))}
        </nav>

        <p className="demo-section-label">Courses</p>
        <div>
          {COURSES.map((c) => (
            <button key={c.code} className="demo-course-item" title={c.code}>
              <span className="demo-course-dot" style={{ background: c.color }} />
              <span className="demo-label">{c.code}</span>
            </button>
          ))}
        </div>

        <div className="demo-sidebar-footer">
          <button
            className="demo-nav-item"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span className="demo-label">Collapse</span>
          </button>
        </div>
      </aside>

      <main className="demo-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            {tab === 'chat' && <DemoChat />}
            {tab === 'today' && <DemoToday />}
            {tab === 'calendar' && <DemoCalendar />}
            {tab === 'courses' && <DemoCourses />}
            {tab === 'more' && <DemoMore onSync={() => setTab('more')} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="demo-tabbar">
        {MOBILE_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`demo-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function DemoToday() {
  return (
    <div className="demo-page">
      <div className="demo-col">
        <div>
          <h1 className="demo-page-title">Today</h1>
          <p className="demo-page-sub">Sunday, February 9 · Winter 2026</p>
        </div>

        <div className="demo-card">
          <p className="demo-card-title">
            <Sunrise size={14} /> Morning digest
          </p>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>
            4 deadlines this week, 2 new announcements in SE 2250B, and your ECE lab report is due
            in 4 days. Last sync completed 2 hours ago.
          </p>
        </div>

        <div className="demo-card">
          <p className="demo-card-title">
            <CalendarDays size={14} /> Due this week
          </p>
          {DUE_THIS_WEEK.map((d) => (
            <div className="demo-row" key={d.title}>
              <span className="demo-dot" style={{ background: d.color }} />
              <div className="demo-row-main">
                <div className="demo-row-title">{d.title}</div>
                <div className="demo-row-sub">
                  {d.course} · {d.due}
                </div>
              </div>
              {d.urgent && <span className="demo-chip accent">urgent</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DemoCalendar() {
  return (
    <div className="demo-page">
      <div className="demo-col">
        <div>
          <h1 className="demo-page-title">Calendar</h1>
          <p className="demo-page-sub">Week of February 9</p>
        </div>
        <div className="demo-card">
          {UPCOMING_EVENTS.map((g) => (
            <div className="demo-row" key={g.day}>
              <div className="demo-row-main">
                <div className="demo-row-title">{g.day}</div>
                {g.items.map((it) => (
                  <div className="demo-row-sub" key={it}>
                    {it}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DemoCourses() {
  return (
    <div className="demo-page">
      <div className="demo-col">
        <div>
          <h1 className="demo-page-title">Courses</h1>
          <p className="demo-page-sub">Winter 2026 · 4 enrolled</p>
        </div>
        {COURSES.map((c) => (
          <div className="demo-card" key={c.code}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="demo-dot" style={{ background: c.color }} />
              <div className="demo-row-main">
                <div className="demo-row-title">{c.code}</div>
                <div className="demo-row-sub">{c.name}</div>
              </div>
              <span className="demo-chip">synced</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DemoMore({ onSync }: { onSync: () => void }) {
  const rows = [
    { icon: RefreshCw, label: 'Sync', sub: 'Last run 2h ago · success', action: onSync },
    { icon: Settings, label: 'Settings', sub: 'Appearance, courses, memory', action: () => {} },
    { icon: Info, label: 'About', sub: 'HippoCampus · Phase 3 demo', action: () => {} },
  ]
  return (
    <div className="demo-page">
      <div className="demo-col">
        <div>
          <h1 className="demo-page-title">More</h1>
        </div>
        <div className="demo-card">
          {rows.map(({ icon: Icon, label, sub, action }) => (
            <button
              key={label}
              className="demo-row"
              onClick={action}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                borderTop: '1px solid var(--glass-border)',
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={17} style={{ color: 'var(--text-2)' }} />
              <div className="demo-row-main">
                <div className="demo-row-title">{label}</div>
                <div className="demo-row-sub">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
