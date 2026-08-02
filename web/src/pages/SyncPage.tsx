import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'
import type { SyncRun } from '../types'

export function SyncPage() {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<{ token_valid?: boolean }>({})
  const [params] = useSearchParams()

  const load = () => {
    api.syncRuns().then((r) => {
      setRuns(r)
      const fromUrl = params.get('run')
      const id = fromUrl ? Number(fromUrl) : r[0]?.id ?? null
      setSelectedId(id)
    }).catch(console.error)
    api.syncStatus().then(setStatus).catch(console.error)
  }

  useEffect(() => { load() }, [params])

  useEffect(() => {
    if (selectedId) {
      api.syncLog(selectedId).then((l) => setLog(l.markdown)).catch(console.error)
    }
  }, [selectedId])

  const trigger = async () => {
    setSyncing(true)
    try {
      const result = await api.triggerSync()
      setSelectedId(result.run_id)
      load()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">Sync Brightspace</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Manual sync · Duo required when session expires
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          Status: {syncing ? 'running' : 'idle'}
          {status.token_valid != null && (
            <span style={{ color: 'var(--text-muted)', marginLeft: '1rem' }}>
              Token: {status.token_valid ? 'valid' : 'expired'}
            </span>
          )}
        </p>
        <button onClick={trigger} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync all courses'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Run history</h3>
        {runs.length === 0 ? (
          <p className="empty-state">No sync runs yet</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Files</th>
                <th>Announcements</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)} style={{ background: selectedId === r.id ? 'var(--bg-hover)' : undefined }}>
                  <td>{new Date(r.started_at).toLocaleString('en-CA')}</td>
                  <td><span className={`badge ${r.status === 'ok' ? 'success' : 'failed'}`}>{r.status}</span></td>
                  <td>{r.files_new} new</td>
                  <td>{r.announcements_new}</td>
                  <td style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{r.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && (
        <div className="card">
          <h3>Log viewer — run #{selectedId}</h3>
          <div className="markdown-body">
            <ReactMarkdown>{log}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
