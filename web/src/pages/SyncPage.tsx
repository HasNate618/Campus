import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import type { SyncRun } from '../types'

export function SyncPage() {
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [log, setLog] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [params] = useSearchParams()

  const load = () => {
    api.syncRuns().then((r) => {
      setRuns(r)
      const fromUrl = params.get('run')
      const id = fromUrl ? Number(fromUrl) : r[0]?.id ?? null
      setSelectedId(id)
    }).catch(console.error)
    api.syncStatus().then((s) => setTokenValid(s.token_valid ?? null)).catch(console.error)
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
    <div className="page page--wide">
      <PageHeader
        title="Sync"
        subtitle="Manual Brightspace sync · Duo required when session expires"
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {syncing ? 'Syncing…' : 'Ready'}
            </p>
            {tokenValid != null && (
              <p className="list-item__meta" style={{ marginTop: '0.25rem' }}>
                Token {tokenValid ? 'valid' : 'expired'}
              </p>
            )}
          </div>
          <Button onClick={trigger} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync all courses'}
          </Button>
        </div>
      </Card>

      <Card title="Run history">
        {runs.length === 0 ? (
          <EmptyState>No sync runs yet</EmptyState>
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
                <tr
                  key={r.id}
                  className={selectedId === r.id ? 'selected' : ''}
                  onClick={() => setSelectedId(r.id)}
                >
                  <td>{new Date(r.started_at).toLocaleString('en-CA')}</td>
                  <td>
                    <Badge variant={r.status === 'ok' ? 'success' : 'danger'}>{r.status}</Badge>
                  </td>
                  <td>{r.files_new} new</td>
                  <td>{r.announcements_new}</td>
                  <td style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>{r.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selectedId && (
        <Card title={`Log — run #${selectedId}`}>
          <div className="markdown-body">
            <ReactMarkdown>{log}</ReactMarkdown>
          </div>
        </Card>
      )}
    </div>
  )
}
