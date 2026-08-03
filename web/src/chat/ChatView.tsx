import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Cpu,
  GraduationCap,
  History,
  Loader2,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react'
import { marked } from 'marked'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import { api } from '@/api/client'
import { useChat, type ChatMsg } from './ChatContext'
import type { Course } from '@/types'

type ToolMsg = Extract<ChatMsg, { role: 'tool' }>

const SUGGESTIONS = [
  "What's due this week?",
  'Summarize recent announcements',
  'Explain a concept from the course content',
  'What should I study next?',
]

/** Render tool args/results (objects arrive from the API) as readable JSON. */
function formatDetail(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** Chat markdown uses the SITE's .md styling (matches announcements, etc.). */
function ChatMd({ content }: { content: string }) {
  const html = useMemo(() => (marked.parse(content ?? '') as string) || '', [content])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

function shortModel(id: string): string {
  const i = id.lastIndexOf('/')
  return i >= 0 ? id.slice(i + 1) : id
}

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
    model,
    setModel,
  } = useChat()
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  // Per-turn tool-group expansion and per-message thinking-block expansion
  // (ephemeral UI state — deliberately not persisted).
  const [expandedTurns, setExpandedTurns] = useState<Record<number, boolean>>({})
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .models()
      .then((d) => {
        if (d.models?.length) setModels(d.models)
      })
      .catch(() => {})
  }, [])

  const session = activeFor(courseId)
  const courseSessions = sessionsFor(courseId)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Follow the stream while busy; otherwise only keep pinned to the bottom
    // when the user is already near it (don't yank them out of old content).
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (busy || nearBottom) el.scrollTop = el.scrollHeight
  }, [session?.messages, session?.id, busy])

  const toggleTurn = (groupKey: number) =>
    setExpandedTurns((t) => ({ ...t, [groupKey]: !t[groupKey] }))

  const renderMessages = (): ReactNode[] => {
    if (!session) return []
    const msgs = session.messages
    const out: ReactNode[] = []
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i]
      const key = `${session.id}-${i}`
      if (m.role === 'tool') {
        // Group consecutive tool messages of the same turn; once every call
        // in the group finished, collapse them into one summary row.
        let j = i
        const group: { m: ToolMsg; idx: number }[] = []
        while (j < msgs.length && msgs[j].role === 'tool') {
          group.push({ m: msgs[j] as ToolMsg, idx: j })
          j++
        }
        const allDone = group.every((g) => g.m.done)
        const groupKey = group[0].m.turnId ?? group[0].idx
        if (allDone && !expandedTurns[groupKey]) {
          out.push(
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <button
                className="tool-chip"
                onClick={() => toggleTurn(groupKey)}
                title="Expand tool calls"
                style={{ color: 'var(--text-3)' }}
              >
                <Wrench size={13} />
                {group.length} tool call{group.length === 1 ? '' : 's'}
                <ChevronDown size={12} style={{ opacity: 0.6 }} />
              </button>
            </motion.div>,
          )
        } else {
          group.forEach((g) => {
            out.push(
              <motion.div
                key={`${session.id}-${g.idx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                <button className="tool-chip" onClick={() => toggleTool(session.id, g.idx)}>
                  {g.m.done ? <Check size={13} /> : <Loader2 size={13} className="animate-spin" />}
                  <Wrench size={13} />
                  {g.m.tool}
                  <span style={{ opacity: 0.6 }}>{g.m.done ? '· done' : '· running'}</span>
                </button>
                {g.m.open && (
                  <div className="tool-detail">
                    {g.m.args != null && `args:   ${formatDetail(g.m.args)}\n`}
                    {g.m.done ? `result: ${formatDetail(g.m.result) || '—'}` : 'running…'}
                  </div>
                )}
              </motion.div>,
            )
          })
        }
        i = j - 1
        continue
      }

      if (m.role === 'user') {
        out.push(
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
          >
            <div className="msg-user">{m.content}</div>
          </motion.div>,
        )
        continue
      }

      // assistant: skip mid-turn narration (intermediate flag set by the
      // context, or positionally: an assistant message followed by a tool
      // message). The final answer carries the turn's full thinking.
      if (m.role === 'assistant' && (m.intermediate || msgs[i + 1]?.role === 'tool')) continue

      // assistant: chain-of-thought block (collapsed by default; click to
      // expand) + zen-rendered markdown + stream cursor
      const thinkingOpen = !!expandedThinking[key]
      out.push(
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div className="msg-assistant">
            {m.thinking ? (
              <div style={{ marginBottom: 8 }}>
                <button
                  className="tool-chip"
                  onClick={() => setExpandedThinking((t) => ({ ...t, [key]: !t[key] }))}
                  style={{ color: 'var(--text-3)', fontFamily: 'inherit', fontSize: 12 }}
                  title={m.thinkingDone ? 'Show chain-of-thought' : 'Chain-of-thought streaming'}
                >
                  {m.thinkingDone ? (
                    <Brain size={12} />
                  ) : (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  <span>{m.thinkingDone ? 'Thought' : 'Thinking…'}</span>
                  <ChevronDown
                    size={12}
                    style={{
                      transform: thinkingOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 120ms ease',
                      opacity: 0.6,
                    }}
                  />
                </button>
                {thinkingOpen && (
                  <div
                    className="tool-detail"
                    style={{ fontStyle: 'italic', maxHeight: 'min(40vh, 320px)', overflowY: 'auto' }}
                  >
                    {m.thinking}
                  </div>
                )}
              </div>
            ) : null}
            <ChatMd content={m.content} />
            {m.streaming && <span className="stream-cursor" />}
          </div>
        </motion.div>,
      )
    }
    return out
  }

  useEffect(() => {
    if (!historyOpen && !pickerOpen && !modelOpen) return
    const close = (e: MouseEvent) => {
      if (historyOpen && !historyRef.current?.contains(e.target as Node)) setHistoryOpen(false)
      if (pickerOpen && !pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
      if (modelOpen && !modelRef.current?.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [historyOpen, pickerOpen, modelOpen])

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
              <div className="popover course-picker">
                {courses.map((c) => (
                  <button
                    key={c.id}
                    className={`popover-item${c.id === courseId ? ' selected' : ''}`}
                    onClick={() => {
                      onPickCourse(c.id)
                      setPickerOpen(false)
                    }}
                    title={`${c.code} — ${c.name}`}
                  >
                    <span className="dot" style={{ background: courseColor(c) }} />
                    <span className="popover-title">{c.code}</span>
                    {c.term && <span className="popover-time">{c.term}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="chat-head-title">{session?.title ?? 'New chat'}</span>
        )}

        <div ref={modelRef} style={{ position: 'relative' }}>
          <button className="scope-pill" onClick={() => setModelOpen((o) => !o)} title={model ?? 'Default model'}>
            <Cpu size={13} />
            <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model ? shortModel(model) : 'Model'}
            </span>
            <ChevronDown size={12} />
          </button>
          {modelOpen && (
            <div className="popover course-picker" style={{ maxHeight: 340, overflowY: 'auto', width: 280 }}>
              <button
                className={`popover-item${!model ? ' selected' : ''}`}
                onClick={() => {
                  setModel(null)
                  setModelOpen(false)
                }}
              >
                <span className="popover-title">Default (config)</span>
              </button>
              {models.length === 0 && (
                <p style={{ margin: '6px 10px', fontSize: 12, color: 'var(--text-3)' }}>Loading models…</p>
              )}
              {models.map((m) => (
                <button
                  key={m}
                  className={`popover-item${model === m ? ' selected' : ''}`}
                  onClick={() => {
                    setModel(m)
                    setModelOpen(false)
                  }}
                  title={m}
                >
                  <span className="popover-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

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
            <>
              {renderMessages()}
              {busy &&
                (() => {
                  const last = session?.messages[session.messages.length - 1]
                  // Show the processing spinner until the final answer starts
                  // streaming (intermediates/tools are still "thinking").
                  const answerStreaming =
                    last?.role === 'assistant' && !last.intermediate && last.streaming
                  const waiting = !answerStreaming
                  return waiting ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div
                        className="msg-assistant"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 13,
                          color: 'var(--text-2)',
                        }}
                      >
                        <Loader2 size={14} className="animate-spin" style={{ color: 'var(--violet)' }} />
                        Thinking…
                      </div>
                    </motion.div>
                  ) : null
                })()}
            </>
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
