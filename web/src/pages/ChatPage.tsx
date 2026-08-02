import { useLocation } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'

export function ChatPage() {
  const location = useLocation()
  const match = location.pathname.match(/\/courses\/(\d+)/)
  const courseId = match ? Number(match[1]) : null

  return (
    <div style={{ height: 'calc(100vh - var(--header-height) - 3rem)', display: 'flex', flexDirection: 'column' }}>
      <h1 className="page-title">Chat</h1>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel courseId={courseId} fullScreen />
      </div>
    </div>
  )
}
