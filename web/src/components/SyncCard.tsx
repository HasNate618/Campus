import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import { fmtRelative } from '@/lib/format'
import type { SyncRun } from '@/types'

export function SyncCard() {
  const navigate = useNavigate()
  const [lastRun, setLastRun] = useState<SyncRun | null>(null)
  const [tokenValid, setTokenValid] = useState<boolean | undefined>(undefined)
  const [triggering, setTriggering] = useState(false)

  const refresh = useCallback(() => {
    api
      .syncStatus()
      .then((s) => {
        setLastRun(s.last_run)
        setTokenValid(s.token_valid)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  const trigger = async () => {
    setTriggering(true)
    try {
      await api.triggerSync()
      setTimeout(refresh, 1500)
    } catch {
      // surfaced on the sync page
    } finally {
      setTriggering(false)
    }
  }

  const chipCls =
    lastRun?.status === 'success'
      ? 'chip green'
      : lastRun?.status === 'running'
        ? 'chip amber'
        : 'chip red'

  return (
    <div className="card">
      <p className="card-title">
        <RefreshCw size={14} /> Sync
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', padding: '2px 8px' }}
          onClick={() => navigate('/sync')}
        >
          Details
        </button>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="row-main">
          <div className="row-title" style={{ fontSize: 13.5 }}>
            {lastRun ? `Last run ${fmtRelative(lastRun.started_at)}` : 'Never synced'}
          </div>
          {lastRun && (
            <div className="row-sub">
              {lastRun.files_new} new files · {lastRun.announcements_new} announcements
            </div>
          )}
        </div>
        {tokenValid === false && <span className="chip red">token expired</span>}
        {lastRun && <span className={chipCls}>{lastRun.status}</span>}
        <button className="btn btn-outline btn-sm" onClick={trigger} disabled={triggering}>
          {triggering ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Sync
        </button>
      </div>
    </div>
  )
}
