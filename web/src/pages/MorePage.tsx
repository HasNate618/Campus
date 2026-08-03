import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, RefreshCw, Settings } from 'lucide-react'
import { api } from '@/api/client'
import { fmtRelative } from '@/lib/format'
import type { SyncRun } from '@/types'

export function MorePage() {
  const [lastRun, setLastRun] = useState<SyncRun | null>(null)

  useEffect(() => {
    api
      .syncStatus()
      .then((s) => setLastRun(s.last_run))
      .catch(() => {})
  }, [])

  const rows = [
    {
      to: '/sync',
      icon: RefreshCw,
      label: 'Sync',
      sub: lastRun ? `Last run ${fmtRelative(lastRun.started_at)} · ${lastRun.status}` : 'Never synced',
    },
    { to: '/more', icon: Settings, label: 'Settings', sub: 'Appearance, courses, memory — coming soon' },
    { to: '/more', icon: Info, label: 'About', sub: 'Campus · personal AI study system' },
  ]

  return (
    <div className="page">
      <div className="page-col">
        <div>
          <h1 className="page-title">More</h1>
        </div>
        <div className="card">
          {rows.map(({ to, icon: Icon, label, sub }) => (
            <Link
              key={label}
              to={to}
              className="row"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <Icon size={17} style={{ color: 'var(--text-2)' }} />
              <div className="row-main">
                <div className="row-title">{label}</div>
                <div className="row-sub">{sub}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
