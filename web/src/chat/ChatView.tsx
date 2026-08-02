import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import {
  ArrowUp,
  Check,
  ChevronDown,
  GraduationCap,
  Loader2,
  SquarePen,
  Wrench,
} from 'lucide-react'
import { api } from '@/api/client'
import { courseColor } from '@/lib/courses'
import { useChat } from './ChatContext'
import type { Course } from '@/types'

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

export function ChatView() {
  const { active, scope, busy, input, setInput, setScope, newChat, toggleTool, send } = useChat()
  const [courses, setCourses] = useState<Course[]>([])
  const [scopeOpen, setScopeOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [active.messages, active.id])

  useEffect(() => {
    if (!scopeOpen) return
    const close = (e: MouseEvent) => {
      if (!headRef.current?.contains(e.target as Node)) setScopeOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [scopeOpen])

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
        <button className="icon-btn" onClick={newChat} title="New chat">
          <SquarePen size={15} />
        </button>
        <button className="scope-pill" onClick={() => setScopeOpen((o) => !o)}>
          {scopeCourse && <span className="dot" style={{ background: courseColor(scopeCourse) }} />}
          {scopeCourse ? scopeCourse.code : 'All courses'}
          <ChevronDown size={13} />
        </button>
        {scopeOpen && (
          <div className="popover">
            <button
              className={`popover-item${scope === null ? ' selected' : ''}`}
              onClick={() => {
                setScope(null)
                setScopeOpen(false)
              }}
            >
              All courses
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                className={`popover-item${scope === c.id ? ' selected' : ''}`}
                onClick={() => {
                  setScope(c.id)
                  setScopeOpen(false)
                }}
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
          {active.messages.length === 0 ? (
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
            active.messages.map((m, i) => (
              <motion.div
                key={`${active.id}-${i}`}
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
                    <button className="tool-chip" onClick={() => toggleTool(i)}>
                      {m.done ? <Check size={13} /> : <Loader2 size={13} className="animate-spin" />}
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
