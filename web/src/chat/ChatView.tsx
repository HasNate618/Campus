import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  MessageSquare,
  Paperclip,
  RefreshCw,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react'
import { courseColor } from '@/lib/courses'
import { fmtRelative } from '@/lib/format'
import { api } from '@/api/client'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { useChat, pathFor, type MsgNode, type StepItem } from './ChatContext'
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

/** Chat markdown is the same unified ZenMarkdown renderer as the content
 *  pages. Renders are rAF-throttled so token-by-token streaming stays
 *  smooth (content updates coalesce to one re-render per frame instead of
 *  one per token). memo() keeps finished messages from re-rendering when
 *  the composer re-renders the chat (typing previously wiped every
 *  message's innerHTML — code headers and images flickered). */
const ChatMd = memo(function ChatMd({ content }: { content: string }) {
  const [rendered, setRendered] = useState(content)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setRendered(content))
    return () => cancelAnimationFrame(raf)
  }, [content])
  return <ZenMarkdown content={rendered} />
})

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
  const [modelQuery, setModelQuery] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [contexts, setContexts] = useState<Record<string, number>>({})
  const filteredModels = useMemo(
    () =>
      modelQuery.trim()
        ? models.filter((m) => m.toLowerCase().includes(modelQuery.trim().toLowerCase()))
        : models,
    [models, modelQuery],
  )
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({})
  const [expandedStepDetail, setExpandedStepDetail] = useState<Record<string, boolean>>({})
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .models()
      .then((d) => {
        if (d.models?.length) setModels(d.models)
        if (d.contexts) setContexts(d.contexts)
      })
      .catch(() => {})
  }, [])

  const session = activeFor(courseId)
  const courseSessions = sessionsFor(courseId)
  const path = session ? pathFor(session) : []
  const lastAssistant = [...path].reverse().find((n) => n.role === 'assistant' && !n.intermediate)
  // real context window of the selected model (bifrost reports context_length);
  // fall back to the configured default model's window when none is selected
  const ctxMax = model
    ? (contexts[model] ?? null)
    : (contexts['opencode-go/deepseek-v4-flash'] ?? contexts['DeepSeek/deepseek-v4-flash'] ?? null)
  const ctxText =
    lastAssistant?.tokens?.prompt_tokens != null
      ? `${fmtTokens(lastAssistant.tokens.prompt_tokens)}${ctxMax ? `/${fmtTokens(ctxMax)}` : ''}`
      : ''

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (busy || nearBottom) el.scrollTop = el.scrollHeight
  }, [session?.nodes, session?.activeNodeId, session?.id, busy])

  /** Tool children of an assistant node (fallback + tree semantics). */
  const toolChildren = (assistantId: string): MsgNode[] =>
    session?.nodes.filter((n) => n.parentId === assistantId && n.role === 'tool') ?? []

  /** A short humanized purpose for a tool call, from its most meaningful
   *  argument (the "to do thing" in "Using some_tool to do thing"). */
  const toolPurpose = (tool: string, args?: unknown): string => {
    const a = (args ?? {}) as Record<string, unknown>
    const pick = (...keys: string[]): string => {
      for (const k of keys) {
        const v = a[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
        if (typeof v === 'number') return String(v)
      }
      return ''
    }
    const trunc = (s: string) => (s.length > 72 ? `${s.slice(0, 69)}…` : s)
    switch (tool) {
      case 'content_read_file':
        return trunc(pick('path'))
      case 'content_grep':
      case 'web_search':
        return `search '${trunc(pick('query'))}'`
      case 'web_read':
        return trunc(pick('url'))
      case 'course_map':
      case 'content_list_files':
      case 'harness_list_assignments':
      case 'harness_get_announcements':
      case 'harness_get_facts':
        return pick('course')
      case 'terminal_run':
        return trunc(pick('command'))
      case 'file_write':
        return trunc(pick('path'))
      case 'mutate_add_fact':
        return trunc(pick('fact'))
      case 'mutate_add_event':
        return trunc(pick('title'))
      case 'mutate_update_assignment': {
        const id = pick('id')
        const due = pick('due_at')
        if (due) return `#${id} due ${trunc(due)}`
        return id ? `#${id}` : ''
      }
      default:
        return ''
    }
  }

  /** Ordered steps of an assistant turn: the recorded list, or (for chats
   *  saved before steps existed) synthesized from thinking + tool children. */
  const stepsFor = (node: MsgNode): StepItem[] => {
    if (node.steps?.length) return node.steps
    const out: StepItem[] = []
    if (node.thinking) out.push({ kind: 'thought', text: node.thinking })
    for (const t of toolChildren(node.id)) {
      out.push({ kind: 'tool', tool: t.tool, args: t.args, done: t.done, result: t.result })
    }
    return out
  }

  const toggleSteps = (assistantId: string) =>
    setExpandedSteps((s) => ({ ...s, [assistantId]: !s[assistantId] }))

  const toggleStepDetail = (key: string) =>
    setExpandedStepDetail((s) => ({ ...s, [key]: !s[key] }))

  const startEdit = (node: MsgNode) => {
    setEditingNodeId(node.id)
    setEditText(node.content)
  }

  const saveEdit = (node: MsgNode) => {
    if (!session) return
    editMessage(session.id, node.id, editText)
    setEditingNodeId(null)
  }

  /** One step row of an assistant turn — thought (expandable thinking text),
   *  narration (visible text the model said between tool batches), or tool
   *  (expandable args/result). */
  const renderStepRow = (node: MsgNode, s: StepItem, i: number, key: string): ReactNode => {
    const detailKey = `${node.id}:${i}`
    const open = !!expandedStepDetail[detailKey]
    if (s.kind === 'thought') {
      return (
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <button
            className="tool-chip"
            onClick={() => toggleStepDetail(detailKey)}
            title={node.thinkingDone ? 'Show chain-of-thought' : 'Chain-of-thought streaming'}
          >
            {node.thinkingDone ? <Brain size={13} /> : <Loader2 size={13} className="animate-spin" />}
            <span>{node.thinkingDone ? 'Thought' : 'Thinking…'}</span>
            <ChevronDown
              size={12}
              style={{
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 120ms ease',
                opacity: 0.6,
              }}
            />
          </button>
          {open && (
            <div
              className="tool-detail"
              style={{ fontStyle: 'italic', maxHeight: 'min(40vh, 320px)', overflowY: 'auto' }}
            >
              {s.text ?? node.thinking ?? ''}
            </div>
          )}
        </motion.div>
      )
    }
    if (s.kind === 'narration') {
      const short = (s.text ?? '').replace(/\s+/g, ' ').trim()
      const label = short.length > 64 ? `${short.slice(0, 61)}…` : short
      return (
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <button className="tool-chip" onClick={() => toggleStepDetail(detailKey)} title="Show narration">
            <MessageSquare size={13} />
            <span>{label || '(narration)'}</span>
            <ChevronDown
              size={12}
              style={{
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 120ms ease',
                opacity: 0.6,
              }}
            />
          </button>
          {open && (
            <div className="tool-detail" style={{ maxHeight: 'min(40vh, 320px)', overflowY: 'auto' }}>
              {s.text}
            </div>
          )}
        </motion.div>
      )
    }
    const purpose = toolPurpose(s.tool ?? '', s.args)
    return (
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <button className="tool-chip" onClick={() => toggleStepDetail(detailKey)}>
          {s.done ? <Check size={13} /> : <Loader2 size={13} className="animate-spin" />}
          <Wrench size={13} />
          <span>{s.tool}</span>
          {purpose && <span style={{ opacity: 0.6 }}>· {purpose}</span>}
          <span style={{ opacity: 0.6 }}>{s.done ? '· done' : '· running'}</span>
          <ChevronDown
            size={12}
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms ease',
              opacity: 0.6,
            }}
          />
        </button>
        {open && (
          <div className="tool-detail">
            {s.args != null && `args:   ${formatDetail(s.args)}\n`}
            {s.done ? `result: ${formatDetail(s.result) || '—'}` : 'running…'}
          </div>
        )}
      </motion.div>
    )
  }

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
        const steps = stepsFor(node)
        // live while streaming; collapsed into one pill once done (expandable)
        const stepsOpen = !!node.streaming || !!expandedSteps[node.id]
        const nThoughts = steps.filter((s) => s.kind === 'thought').length
        const nTools = steps.length - nThoughts
        out.push(
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
              {steps.length > 0 && (
                <div className="msg-steps">
                  <button
                    className="tool-chip"
                    onClick={() => {
                      if (!node.streaming) toggleSteps(node.id)
                    }}
                    title={node.streaming ? undefined : stepsOpen ? 'Collapse steps' : 'Expand steps'}
                    style={{ color: 'var(--text-3)' }}
                  >
                    <Brain size={13} />
                    <Wrench size={13} />
                    <span>
                      {steps.length} step{steps.length === 1 ? '' : 's'}
                      {nTools > 0 ? ` · ${nTools} tool call${nTools === 1 ? '' : 's'}` : ''}
                      {nThoughts > 0 ? ` · ${nThoughts} thought${nThoughts === 1 ? '' : 's'}` : ''}
                    </span>
                    <ChevronDown
                      size={12}
                      style={{
                        transform: stepsOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 120ms ease',
                        opacity: 0.6,
                      }}
                    />
                  </button>
                  {stepsOpen &&
                    steps.map((s, i) => renderStepRow(node, s, i, `${session.id}-step-${node.id}-${i}`))}
                </div>
              )}
              <div className={`msg-assistant${node.streaming ? ' streaming' : ''}`}>
                <ChatMd content={node.content} />
                {node.streaming && <span className="stream-cursor" />}
              </div>

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

  // Workspace "Ask AI" button → prefilled prompt lands here and sends
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined
      const text = detail?.text
      if (text && send(courseId, text)) {
        setInput('')
        resetInputHeight()
      }
    }
    window.addEventListener('campus:ask-ai', h)
    return () => window.removeEventListener('campus:ask-ai', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (send(courseId, input)) {
        setInput('')
        resetInputHeight()
      }
    }
  }

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  /** Collapse the textarea back to one line after a send (autoGrow leaves
   *  it at the grown height, so the box stays tall after sending). */
  const resetInputHeight = () => {
    if (inputRef.current) inputRef.current.style.height = 'auto'
  }

  const submit = () => {
    if (send(courseId, input)) {
      setInput('')
      resetInputHeight()
    }
  }

  const answerStreaming =
    !!lastAssistant && lastAssistant.streaming && !lastAssistant.intermediate

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

        {session && path.length > 0 && (
          <button className="icon-btn" onClick={() => newChat(courseId)} title="New chat">
            <SquarePen size={15} />
          </button>
        )}
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
        <div className="chat-input">
          <div className="chat-input-main">
            <textarea
              ref={inputRef}
              value={input}
              onChange={autoGrow}
              onKeyDown={onKeyDown}
              placeholder={`Ask ${course ? course.code : 'about this course'}…`}
              rows={1}
              disabled={busy}
            />
            <div className="input-toolbar">
              <button className="attach-btn" disabled title="File upload coming soon" aria-label="Attach file">
                <Paperclip size={15} />
              </button>
              <span className="ctx-meter" title="Context used so far vs the selected model's window">
                {ctxText}
              </span>
              <div style={{ flex: 1 }} />
              <div ref={modelRef} style={{ position: 'relative' }}>
                <button
                  className="scope-pill"
                  onClick={() => {
                    setModelOpen((o) => !o)
                    setModelQuery('')
                  }}
                  title={model ?? 'Default model'}
                >
                  <Cpu size={12} />
                  <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {model ? shortModel(model) : 'Default'}
                  </span>
                  <ChevronDown size={11} />
                </button>
                {modelOpen && (
                  <div
                    className="popover course-picker"
                    style={{ bottom: 'calc(100% + 8px)', top: 'auto', width: 280, maxHeight: 330, display: 'flex', flexDirection: 'column' }}
                  >
                    <input
                      autoFocus
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder="Search models…"
                      className="model-search"
                    />
                    <div style={{ overflowY: 'auto', flex: 1 }}>
                      <button
                        className={`popover-item${!model ? ' selected' : ''}`}
                        onClick={() => {
                          setModel(null)
                          setModelOpen(false)
                        }}
                      >
                        <span className="popover-title">Default (config)</span>
                      </button>
                      {filteredModels.length === 0 && (
                        <p style={{ margin: '6px 10px', fontSize: 12, color: 'var(--text-3)' }}>No matching models.</p>
                      )}
                      {filteredModels.map((m) => (
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
                          {model === m && <Check size={13} style={{ flexShrink: 0 }} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
