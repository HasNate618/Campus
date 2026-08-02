import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../api/client'
import { Button } from './ui/Button'
import type { ChatMessage } from '../types'

interface Props {
  courseId: number | null
  fullScreen?: boolean
}

export function ChatPanel({ courseId, fullScreen }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const userMsg = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: userMsg }])
    setStreaming(true)

    let assistantText = ''
    setMessages((m) => [...m, { role: 'assistant', content: '' }])

    try {
      await streamChat(userMsg, courseId, (event, data) => {
        const d = data as Record<string, string>
        if (event === 'tool_start') {
          setMessages((m) => [...m, { role: 'tool', content: d.tool, tool: d.tool }])
        } else if (event === 'tool_end') {
          setMessages((m) => [...m, { role: 'tool', content: `${d.tool} → ${d.result}`, toolResult: d.result }])
        } else if (event === 'token') {
          assistantText += d.text ?? ''
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = assistantText
            return [...copy]
          })
        }
      })
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e}` }])
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className={`chat-panel${fullScreen ? ' chat-panel--fullscreen' : ''}`}>
      <div className="chat-panel__header">
        <div>
          <div className="chat-panel__title">Chat</div>
          <div className="chat-panel__scope">
            {courseId ? `Course ${courseId}` : 'All courses'}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
          Clear
        </Button>
      </div>
      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <p className="chat-panel__empty">
            Ask about syllabus, deadlines, or course content. Conversations aren&apos;t saved.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble chat-bubble--${m.role}`}>
            {m.role === 'tool' ? (
              <code className="chat-tool">{m.content}</code>
            ) : (
              <div className="chat-bubble__text">{m.content}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-panel__input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask anything…"
          disabled={streaming}
        />
        <Button onClick={send} disabled={streaming || !input.trim()} size="md">
          {streaming ? '…' : 'Send'}
        </Button>
      </div>
    </div>
  )
}
