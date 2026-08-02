import { useLocation } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { PageHeader } from '../components/ui/PageHeader'

export function ChatPage() {
  const location = useLocation()
  const match = location.pathname.match(/\/courses\/(\d+)/)
  const courseId = match ? Number(match[1]) : null

  return (
    <div className="page page--wide" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-height) - 2rem)' }}>
      <PageHeader title="Chat" />
      <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <ChatPanel courseId={courseId} fullScreen />
      </div>
    </div>
  )
}
