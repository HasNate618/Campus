import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, Check, ChevronDown, GraduationCap, Loader2, Wrench } from 'lucide-react'
import { api, streamChat } from '@/api/client'
import { courseColor } from '@/lib/courses'
import type { Course } from '@/types'

type ChatMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming: boolean }
  | { role: 'tool'; tool: string; args?: string; result?: string; done: boolean; open: boolean }

const SUGGESTIONS = [
  "What's due this week?",
  'Summarize recent announcements',
  'Explain a concept from my course content',
  'When is my next exam?',
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function ChatPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [scope, setScope] = useState<number | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!scopeOpen) return
    const close = (e: MouseEvent) => {
      if (!headRef.current?.contains(e.target as Node)) setScopeOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [scopeOpen])

  const pickScope = (id: number | null) => {
    setScope(id)
    setScopeOpen(false)
    setMessages([])
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setBusy(true)
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])

    try {
      await streamChat(text, scope, (event, data) => {
        const d = data as Record<string, string>
        if (event === 'tool_start') {
          setMessages((m) => [
            ...m,
            {
              role: 'tool',
              tool: d.tool ?? 'tool',
              args: d.args ? JSON.stringify(d.args) : undefined,
              done: false,
              open: false,
            },
          ])
        } else if (event === 'tool_end') {
          setMessages((m) =>
            m.map((msg) =>
              msg.role === 'tool' && !msg.done && msg.tool === (d.tool ?? msg.tool)
                ? { ...msg, done: true, result: d.result }
                : msg,
            ),
          )
        } else if (event === 'token') {
          setMessages((m) => {
            const last = m[m.length - 1]
            if (last?.role === 'assistant' && last.streaming) {
              return [...m.slice(0, -1), { ...last, content: last.content + (d.text ?? '') }]
            }
            return [...m, { role: 'assistant', content: d.text ?? '', streaming: true }]
          })
        }
      })
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
          streaming: false,
        },
      ])
    } finally {
      setMessages((m) =>
        m.map((msg) =>
          msg.role === 'assistant' && msg.streaming ? { ...msg, streaming: false } : msg,
        ),
      )
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  const scopeCourse = courses.find((c) => c.id === scope)

  return (
    <div className="chat-wrap">
      <div className="chat-head" ref={headRef}>
        <button className="scope-pill" onClick={() => setScopeOpen((o) => !o)}>
          {scopeCourse && (
            <span className="dot" style={{ background: courseColor(scopeCourse) }} />
          )}
          {scopeCourse ? scopeCourse.code : 'All courses'}
          <ChevronDown size={13} />
        </button>
        {scopeOpen && (
          <div className="popover">
            <button
              className={`popover-item${scope === null ? ' selected' : ''}`}
              onClick={() => pickScope(null)}
            >
              All courses
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                className={`popover-item${scope === c.id ? ' selected' : ''}`}
                onClick={() => pickScope(c.id)}
              >
                <span className="dot" style={{ background: courseColor(c) }} />
                {c.code} — {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-col">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="logo-mark">
                <GraduationCap size={24} />
              </div>
              <p className="greeting">{greeting()}, Nate</p>
              <p className="page-sub" style={{ margin: 0 }}>
                Ask about deadlines, course content, or what's on this week.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                {m.role === 'user' && <div className="msg-user">{m.content}</div>}
                {m.role === 'assistant' && (
                  <div className="msg-assistant">
                    <div className="md" style={{ display: 'inline' }}>
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                    {m.streaming && <span className="stream-cursor" />}
                  </div>
                )}
                {m.role === 'tool' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <button
                      className="tool-chip"
                      onClick={() =>
                        setMessages((msgs) =>
                          msgs.map((msg, j) =>
                            j === i && msg.role === 'tool' ? { ...msg, open: !msg.open } : msg,
                          ),
                        )
                      }
                    >
                      {m.done ? (
                        <Check size={13} />
                      ) : (
                        <Loader2 size={13} className="animate-spin" />
                      )}
                      <Wrench size={13} />
                      {m.tool}
                      <span style={{ opacity: 0.6 }}>{m.done ? '· done' : '· running'}</span>
                    </button>
                    {m.open && (
                      <div className="tool-detail">
                        {m.args && `args:   ${m.args}\n`}
                        {m.done ? `result: ${m.result ?? '—'}` : 'running…'}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>
      </div>

      <div className="input-dock">
        <div className="chat-input">
          <textarea
            value={input}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
            placeholder="Ask anything…"
            rows={1}
            disabled={busy}
          />
          <button
            className="send-btn"
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
