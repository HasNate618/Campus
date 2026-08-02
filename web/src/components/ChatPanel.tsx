import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../api/client'
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
          setMessages((m) => [...m, { role: 'tool', content: `⚙ ${d.tool}`, tool: d.tool }])
        } else if (event === 'tool_end') {
          setMessages((m) => [...m, { role: 'tool', content: `✓ ${d.tool}: ${d.result}`, toolResult: d.result }])
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
    <div className="chat-rail" style={fullScreen ? { width: '100%', border: 'none' } : undefined}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
        <strong>Chat</strong>
        <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
          {courseId ? `Course ${courseId}` : 'All courses'}
        </span>
        <button
          className="secondary"
          style={{ float: 'right', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
          onClick={() => setMessages([])}
        >
          Clear
        </button>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Chat isn&apos;t saved between visits. Ask about syllabus, deadlines, or course content.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === 'tool' ? (
              <div className="chat-tool">{m.content}</div>
            ) : m.role === 'user' ? (
              <div className="bubble">{m.content}</div>
            ) : (
              <div className="bubble">{m.content}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask anything…"
          disabled={streaming}
        />
        <button onClick={send} disabled={streaming || !input.trim()}>
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
