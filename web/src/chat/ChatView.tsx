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
  RefreshCw,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react'
import { marked } from 'marked'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import { api } from '@/api/client'
import { useZenPostProcess } from '@/lib/zenMd'
import { useChat, pathFor, type MsgNode } from './ChatContext'
import type { Course } from '@/types'

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

/** Chat markdown uses the SITE's .md styling (matches announcements, etc.)
 *  + the shared zen post-process (mermaid, copy buttons). */
function ChatMd({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => (marked.parse(content ?? '') as string) || '', [content])
  useZenPostProcess(ref, [html])
  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

function shortModel(id: string): string {
  const i = id.lastIndexOf('/')
  return i >= 0 ? id.slice(i + 1) : id
}

function fmtTokens(n?: number): string {
  if (!n) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
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
    send,
    regenerate,
    editMessage,
    deleteMessage,
    setActiveBranch,
    model,
    setModel,
  } = useChat()
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
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
  const path = session ? pathFor(session) : []
  const lastAssistant = [...path].reverse().find((n) => n.role === 'assistant' && !n.intermediate)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (busy || nearBottom) el.scrollTop = el.scrollHeight
  }, [session?.nodes, session?.activeNodeId, session?.id, busy])

  /** Tool children of an assistant node. */
  const toolChildren = (assistantId: string): MsgNode[] =>
    session?.nodes.filter((n) => n.parentId === assistantId && n.role === 'tool') ?? []

  const toggleTools = (assistantId: string) =>
    setExpandedTools((t) => ({ ...t, [assistantId]: !t[assistantId] }))

  const toggleThinking = (nodeId: string) =>
    setExpandedThinking((t) => ({ ...t, [nodeId]: !t[nodeId] }))

  const startEdit = (node: MsgNode) => {
    setEditingNodeId(node.id)
    setEditText(node.content)
  }

  const saveEdit = (node: MsgNode) => {
    if (!session) return
    editMessage(session.id, node.id, editText)
    setEditingNodeId(null)
  }

  const renderToolRow = (node: MsgNode, key: string): ReactNode => (
    <motion.div
      key={key}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <button
        className="tool-chip"
        onClick={() => toggleTools(node.parentId ?? '')}
        style={{ cursor: 'default' }}
      >
        {node.done ? <Check size={13} /> : <Loader2 size={13} className="animate-spin" />}
        <Wrench size={13} />
        {node.tool}
        <span style={{ opacity: 0.6 }}>{node.done ? '· done' : '· running'}</span>
      </button>
      {expandedTools[node.parentId ?? ''] && (
        <div className="tool-detail">
          {node.args != null && `args:   ${formatDetail(node.args)}\n`}
          {node.done ? `result: ${formatDetail(node.result) || '—'}` : 'running…'}
        </div>
      )}
    </motion.div>
  )

  const renderBranchChips = (node: MsgNode): ReactNode => {
    const kids =
      session?.nodes.filter((n) => n.parentId === node.id && n.role !== 'tool' && !n.intermediate) ?? []
    if (kids.length < 2) return null
    return (
      <div key={`br-${node.id}`} className="branch-chips">
        {kids.map((k, i) => (
          <button
            key={k.id}
            className={`branch-chip${session?.activeNodeId === k.id ? ' active' : ''}`}
            onClick={() => setActiveBranch(session!.id, k.id)}
            title="Switch to this branch"
          >
            v{i + 1}
          </button>
        ))}
      </div>
    )
  }

  const renderMessages = (): ReactNode[] => {
    if (!session) return []
    const out: ReactNode[] = []
    for (const node of path) {
      const key = `${session.id}-${node.id}`
      if (node.role === 'user') {
        out.push(
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
          >
            {editingNodeId === node.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 560 }}>
                <textarea
                  className="chat-input-area"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditingNodeId(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--violet)', color: '#fff' }}
                    onClick={() => saveEdit(node)}
                    disabled={!editText.trim()}
                  >
                    Save & re-send
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="msg-user">{node.content}</div>
                <div className="msg-actions">
                  <button className="icon-btn" title="Edit (rewind)" onClick={() => startEdit(node)}>
                    <SquarePen size={12} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete message"
                    onClick={() => deleteMessage(session.id, node.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </>
            )}
          </motion.div>,
        )
        out.push(renderBranchChips(node))
        continue
      }

      // assistant — skip mid-turn narration
      if (node.role === 'assistant' && node.intermediate) continue

      if (node.role === 'assistant') {
        const tools = toolChildren(node.id)
        const toolsDone = tools.every((t) => t.done)
        const thinkingOpen = !!expandedThinking[node.id]
        out.push(
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div className="msg-assistant">
              {node.thinking ? (
                <div style={{ marginBottom: 8 }}>
                  <button
                    className="tool-chip"
                    onClick={() => toggleThinking(node.id)}
                    style={{ color: 'var(--text-3)', fontFamily: 'inherit', fontSize: 12 }}
                    title={node.thinkingDone ? 'Show chain-of-thought' : 'Chain-of-thought streaming'}
                  >
                    {node.thinkingDone ? (
                      <Brain size={12} />
                    ) : (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    <span>{node.thinkingDone ? 'Thought' : 'Thinking…'}</span>
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
                      {node.thinking}
                    </div>
                  )}
                </div>
              ) : null}
              <ChatMd content={node.content} />
              {node.streaming && <span className="stream-cursor" />}
            </div>

            {tools.length > 0 &&
              (toolsDone && !expandedTools[node.id] ? (
                <button className="tool-chip" onClick={() => toggleTools(node.id)} title="Expand tool calls" style={{ color: 'var(--text-3)' }}>
                  <Wrench size={13} />
                  {tools.length} tool call{tools.length === 1 ? '' : 's'}
                  <ChevronDown size={12} style={{ opacity: 0.6 }} />
                </button>
              ) : (
                tools.map((t) => renderToolRow(t, `${session.id}-tool-${t.id}`))
              ))}

            <div className="msg-actions">
              {!busy && node.thinkingDone && (
                <button
                  className="icon-btn"
                  title="Regenerate (forks the conversation)"
                  onClick={() => regenerate(session.id, node.id)}
                >
                  <RefreshCw size={12} />
                </button>
              )}
              <button
                className="icon-btn"
                title="Delete message"
                onClick={() => deleteMessage(session.id, node.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </motion.div>,
        )
        out.push(renderBranchChips(node))
        continue
      }
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

  const answerStreaming =
    !!lastAssistant && lastAssistant.streaming

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
          {!session || path.length === 0 ? (
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
              {busy && !answerStreaming && (
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
              )}
            </>
          )}
        </div>
      </div>

      <div className="input-dock">
        {lastAssistant?.model && (
          <div className="context-bar">
            <span>{shortModel(lastAssistant.model)}</span>
            {lastAssistant.tokens?.total_tokens ? (
              <span>
                · {fmtTokens(lastAssistant.tokens.completion_tokens)} out ·{' '}
                {fmtTokens(lastAssistant.tokens.total_tokens)} this turn
              </span>
            ) : null}
          </div>
        )}
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
