import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import {
  ArrowUp,
  Check,
  ChevronDown,
  GraduationCap,
  History,
  Loader2,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import { useChat } from './ChatContext'
import type { Course } from '@/types'

const SUGGESTIONS = [
  "What's due this week?",
  'Summarize recent announcements',
  'Explain a concept from the course content',
  'What should I study next?',
]

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

interface Props {
  courseId: number
  course?: Course
  /** Show a course-switcher pill in the header (mobile chat tab). */
  courses?: Course[]
  onPickCourse?: (courseId: number) => void
}

export function ChatView({ courseId, course, courses, onPickCourse }: Props) {
  const {
    busy,
    sessionsFor,
    activeFor,
    openSession,
    newChat,
    deleteSession,
    toggleTool,
    send,
  } = useChat()
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const session = activeFor(courseId)
  const courseSessions = sessionsFor(courseId)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session?.messages, session?.id])

  useEffect(() => {
    if (!historyOpen && !pickerOpen) return
    const close = (e: MouseEvent) => {
      if (historyOpen && !historyRef.current?.contains(e.target as Node)) setHistoryOpen(false)
      if (pickerOpen && !pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [historyOpen, pickerOpen])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      setInput('')
      void send(courseId, input)
    }
  }

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  const submit = () => {
    setInput('')
    void send(courseId, input)
  }

  return (
    <div className="chat-wrap">
      <div className="chat-head">
        <div ref={historyRef} style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setHistoryOpen((o) => !o)} title="Chat history">
            <History size={15} />
          </button>
          {historyOpen && (
            <div className="popover left">
              <button
                className="popover-item"
                onClick={() => {
                  newChat(courseId)
                  setHistoryOpen(false)
                }}
              >
                <SquarePen size={13} style={{ flexShrink: 0 }} />
                New chat
              </button>
              {courseSessions.length > 0 && <div className="popover-divider" />}
              {courseSessions.map((s) => (
                <div key={s.id} className="popover-row">
                  <button
                    className={`popover-item${session?.id === s.id ? ' selected' : ''}`}
                    onClick={() => {
                      openSession(courseId, s.id)
                      setHistoryOpen(false)
                    }}
                  >
                    <span className="popover-title">{s.title}</span>
                    <span className="popover-time">{fmtRelative(new Date(s.updatedAt).toISOString())}</span>
                  </button>
                  <button
                    className="icon-btn popover-delete"
                    onClick={() => deleteSession(s.id)}
                    title="Delete chat"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {courseSessions.length === 0 && (
                <p style={{ margin: '6px 10px', fontSize: 12, color: 'var(--text-3)' }}>
                  No chats yet
                </p>
              )}
            </div>
          )}
        </div>

        {courses && onPickCourse ? (
          <div ref={pickerRef} style={{ position: 'relative' }}>
            <button className="scope-pill" onClick={() => setPickerOpen((o) => !o)}>
              {course && <span className="dot" style={{ background: courseColor(course) }} />}
              {course ? course.code : 'Select course'}
              <ChevronDown size={13} />
            </button>
            {pickerOpen && (
              <div className="popover">
                {courses.map((c) => (
                  <button
                    key={c.id}
                    className={`popover-item${c.id === courseId ? ' selected' : ''}`}
                    onClick={() => {
                      onPickCourse(c.id)
                      setPickerOpen(false)
                    }}
                  >
                    <span className="dot" style={{ background: courseColor(c) }} />
                    {c.code} — {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="chat-head-title">{session?.title ?? 'New chat'}</span>
        )}

        <button className="icon-btn" onClick={() => newChat(courseId)} title="New chat">
          <SquarePen size={15} />
        </button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-col">
          {!session || session.messages.length === 0 ? (
            <div className="chat-empty">
              <div className="logo-mark">
                <GraduationCap size={24} />
              </div>
              <p className="greeting">{greeting()}, Nate</p>
              <p className="page-sub" style={{ margin: 0 }}>
                Ask about {course ? course.code : 'this course'} — deadlines, content, or what to
                study next.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => void send(courseId, s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            session.messages.map((m, i) => (
              <motion.div
                key={`${session.id}-${i}`}
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
                    <button className="tool-chip" onClick={() => toggleTool(session.id, i)}>
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
            placeholder={`Ask ${course ? course.code : 'about this course'}…`}
            rows={1}
            disabled={busy}
          />
          <button
            className="send-btn"
            onClick={submit}
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
