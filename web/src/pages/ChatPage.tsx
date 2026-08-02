import { useLocation } from 'react-router-dom'
import { ChatPanel } from '../components/ChatPanel'
import { PageHeader } from '../components/ui/PageHeader'

export function ChatPage() {
  const location = useLocation()
  const match = location.pathname.match(/\/courses\/(\d+)/)
  const courseId = match ? Number(match[1]) : null

  return (
    <div className="page page--chat">
      <PageHeader title="Chat" />
      <div className="chat-page-panel">
        <ChatPanel courseId={courseId} fullScreen />
      </div>
    </div>
  )
}
