import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw } from 'lucide-react'
import { api } from '@/api/client'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import type { SyncRun } from '@/types'

function statusChip(status: string) {
  if (status === 'success') return 'chip green'
  if (status === 'running') return 'chip amber'
  return 'chip red'
}

export function SyncPage() {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [tokenValid, setTokenValid] = useState<boolean | undefined>(undefined)
  const [autoSync, setAutoSync] = useState<{
    enabled: boolean; time: string; catch_up: boolean; timezone: string;
    last_attempt_date: string | null;
  } | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState<string | null>(null)
  const [openRun, setOpenRun] = useState<number | null>(null)
  const [log, setLog] = useState<string>('')
  const [logLoading, setLogLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const openRunRef = useRef<number | null>(null)
  const openStatusRef = useRef<string | null>(null)

  const refresh = useCallback(() => {
    api.syncRuns(25).then(setRuns).catch(console.error)
    api
      .syncStatus()
      .then((s) => {
        setTokenValid(s.token_valid)
        setAutoSync(s.auto_sync ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (logPollRef.current) clearInterval(logPollRef.current)
    }
  }, [refresh])

  // Keep the open run's log fresh while it is running: the backend streams
  // progress lines into the log endpoint, so re-fetch it on the same cadence
  // as the run list instead of showing a stale snapshot.
  useEffect(() => {
    openRunRef.current = openRun
    const open = runs.find((r) => r.id === openRun)
    openStatusRef.current = open?.status ?? null
    const running = open?.status === 'running'
    if (running && !logPollRef.current) {
      logPollRef.current = setInterval(() => {
        const id = openRunRef.current
        if (id == null) return
        api.syncLog(id).then((res) => setLog(res.markdown)).catch(() => {})
      }, 2500)
    } else if (!running && logPollRef.current) {
      clearInterval(logPollRef.current)
      logPollRef.current = null
      // One final fetch so the finished log replaces the live stream.
      if (openRun != null && open && open.status !== 'running') {
        api.syncLog(openRun).then((res) => setLog(res.markdown)).catch(() => {})
      }
    }
  }, [runs, openRun])

  // Poll while any run is in flight.
  useEffect(() => {
    const anyRunning = runs.some((r) => r.status === 'running')
    if (anyRunning && !pollRef.current) {
      pollRef.current = setInterval(refresh, 2500)
    } else if (!anyRunning && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [runs, refresh])

  const trigger = async () => {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      // if token expired, auth first then sync
      if (tokenValid === false) {
        setTriggerMsg("Authenticating... approve Duo push on your device")
        await api.triggerAuth()
        // poll until token is valid (max 60s)
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const s = await api.syncStatus()
          if (s.token_valid) break
        }
        const final = await api.syncStatus()
        if (!final.token_valid) {
          setTriggerMsg("Auth timed out — try again")
          setTriggering(false)
          return
        }
      }
      const res = await api.triggerSync()
      setTriggerMsg(res.message)
      refresh()
      // Open the new run's log right away so progress is visible while it runs.
      setTimeout(async () => {
        try {
          const latest = await api.syncRuns(1)
          const r = latest[0]
          if (r && r.status === 'running') {
            setOpenRun(r.id)
            const lg = await api.syncLog(r.id)
            setLog(lg.markdown)
          }
        } catch { /* surfaced by the normal refresh */ }
      }, 800)
    } catch (err) {
      setTriggerMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setTriggering(false)
    }
  }

  const toggleLog = async (runId: number) => {
    if (openRun === runId) {
      setOpenRun(null)
      return
    }
    setOpenRun(runId)
    setLog('')
    setLogLoading(true)
    try {
      const res = await api.syncLog(runId)
      setLog(res.markdown)
    } catch {
      setLog('Log unavailable.')
    } finally {
      setLogLoading(false)
    }
  }

  const lastRun = runs[0] ?? null

  return (
    <div className="page">
      <div className="page-col">
        <div>
          <h1 className="page-title">Sync</h1>
          <p className="page-sub">Brightspace → local database</p>
          {autoSync?.enabled && (
            <p className="row-sub">
              Auto sync: daily at {autoSync.time} · catch-up{' '}
              {autoSync.catch_up ? 'on' : 'off'} · {autoSync.timezone}
              {autoSync.last_attempt_date
                ? ` · last ${autoSync.last_attempt_date}`
                : ''}
            </p>
          )}
        </div>

        <div className="card">
          <div className="sync-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="row-main">
              <div className="row-title">
                {lastRun ? `Last run ${fmtRelative(lastRun.started_at)}` : 'Never synced'}
              </div>
              <div className="row-sub">
                {lastRun
                  ? `${lastRun.courses_processed} courses · ${lastRun.files_new} new files · ${lastRun.announcements_new} new announcements`
                  : 'Run a sync to pull course content, announcements, and deadlines.'}
              </div>
            </div>
            <div className="sync-tags">
              {tokenValid === false && <span className="chip red">token expired</span>}
              {lastRun && <span className={statusChip(lastRun.status)}>{lastRun.status}</span>}
              <button className="btn btn-primary" onClick={trigger} disabled={triggering}>
                {triggering ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                Sync now
              </button>
            </div>
          </div>
          {triggerMsg && (
            <p className="row-sub" style={{ marginTop: 10, marginBottom: 0 }}>
              {triggerMsg}
            </p>
          )}
        </div>

        <div className="card">
          <p className="card-title">
            <RefreshCw size={14} /> Run history
          </p>
          {runs.length === 0 && <div className="empty compact">No sync runs yet.</div>}
          {runs.map((r) => (
            <div key={r.id}>
              <button
                className="row"
                onClick={() => void toggleLog(r.id)}
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
                {openRun === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div className="row-main">
                  <div className="row-title">{fmtDateTime(r.started_at)}</div>
                  <div className="row-sub">
                    {r.trigger} · {r.files_new}+{r.files_changed}~ files · {r.announcements_new} announcements
                    {r.error ? ` · ${r.error}` : ''}
                  </div>
                </div>
                <span className={statusChip(r.status)}>{r.status}</span>
              </button>
              {openRun === r.id && (
                <div style={{ padding: '4px 0 12px' }}>
                  {logLoading ? (
                    <div className="empty compact">
                      <Loader2 size={15} className="animate-spin" style={{ display: 'inline' }} />
                    </div>
                  ) : log ? (
                    <div className="log-view"><ZenMarkdown content={log} /></div>
                  ) : (
                    <div className="log-view">Empty log.</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
