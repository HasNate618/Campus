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
  const [progress, setProgress] = useState<string | null>(null)

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

  // While a run is in flight, poll faster and surface its latest progress
  // line so the dashboard reflects what the sync is doing right now.
  const running = lastRun?.status === 'running'
  useEffect(() => {
    if (!running) {
      setProgress(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      refresh()
      try {
        const lg = await api.syncLog(lastRun!.id)
        if (cancelled) return
        const lines = lg.markdown.split('\n').map((l) => l.trim()).filter(Boolean)
        setProgress(lines.length ? lines[lines.length - 1] : null)
      } catch { /* keep last known line */ }
    }
    void tick()
    const t = setInterval(tick, 3000)
    return () => { cancelled = true; clearInterval(t) }
  }, [running, lastRun?.id, refresh])

  const trigger = async () => {
    setTriggering(true)
    try {
      // if token expired, auth first
      if (tokenValid === false) {
        await api.triggerAuth()
        // poll until token valid (max 60s)
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const s = await api.syncStatus()
          if (s.token_valid) break
        }
      }
      await api.triggerSync()
      setTimeout(refresh, 1500)
    } catch {
      // surfaced on the sync page
    } finally {
      setTriggering(false)
    }
  }

  const chipCls =
    // 'ok' is what the server writes; 'success' never arrives, so a healthy
    // sync used to fall through to red.
    lastRun?.status === 'ok' || lastRun?.status === 'success'
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
          {running && progress && (
            <div className="row-sub" style={{ opacity: 0.85, fontStyle: 'italic' }}>
              {progress.length > 110 ? progress.slice(0, 110) + '…' : progress}
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
