import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { streamChat } from '@/api/client'

export type ChatMsg =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      streaming: boolean
      /** Chain-of-thought streamed via the SSE 'reasoning' event. */
      thinking?: string
      /** True once the turn's answer started streaming or finished. */
      thinkingDone?: boolean
      /** Mid-turn narration before a tool call — hidden from the UI. */
      intermediate?: boolean
    }
  | {
      role: 'tool'
      tool: string
      args?: unknown
      result?: unknown
      done: boolean
      open: boolean
      /** Groups consecutive tool calls of one turn for collapse. */
      turnId?: number
    }

export interface ChatSession {
  id: string
  courseId: number
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
}

const STORAGE_KEY = 'hc.chat.sessions.v2'
const LAST_COURSE_KEY = 'hc.chat.lastCourse'
const MODEL_KEY = 'hc.chat.model'
const MAX_SESSIONS = 50

function stripUiFlags(m: ChatMsg): ChatMsg {
  if (m.role === 'assistant') return { ...m, streaming: false, thinkingDone: true }
  if (m.role === 'tool') return { ...m, open: false }
  return m
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s) => s && typeof s.id === 'string' && typeof s.courseId === 'number' && Array.isArray(s.messages))
      .map((s) => ({ ...s, messages: s.messages.map(stripUiFlags) }))
  } catch {
    return []
  }
}

function persistSessions(sessions: ChatSession[], activeIds: Set<string>) {
  const kept = sessions
    .filter((s) => s.messages.length > 0 || activeIds.has(s.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map((s) => ({ ...s, messages: s.messages.map(stripUiFlags) }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept.slice(0, 10)))
  }
}

interface ChatContextValue {
  sessions: ChatSession[]
  busy: boolean
  lastCourseId: number | null
  model: string | null
  setModel: (model: string | null) => void
  setLastCourse: (courseId: number) => void
  sessionsFor: (courseId: number) => ChatSession[]
  activeFor: (courseId: number) => ChatSession | null
  openSession: (courseId: number, sessionId: string) => void
  newChat: (courseId: number) => void
  deleteSession: (sessionId: string) => void
  toggleTool: (sessionId: string, msgIdx: number) => void
  send: (courseId: number, text: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

// crypto.randomUUID is only available in secure contexts (HTTPS/localhost);
// the homelab serves plain HTTP, so fall back to a v4-style uuid.
function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function makeSession(courseId: number): ChatSession {
  return {
    id: makeUuid(),
    courseId,
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [activeMap, setActiveMap] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [model, setModelState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MODEL_KEY)
    } catch {
      return null
    }
  })
  // Monotonic per-turn id so consecutive tool calls of one turn can be
  // grouped and collapsed together.
  const turnRef = useRef(0)
  const [lastCourseId, setLastCourseId] = useState<number | null>(() => {
    const raw = localStorage.getItem(LAST_COURSE_KEY)
    return raw ? Number(raw) : null
  })

  useEffect(() => {
    persistSessions(sessions, new Set(Object.values(activeMap)))
  }, [sessions, activeMap])

  const setLastCourse = useCallback((courseId: number) => {
    setLastCourseId(courseId)
    localStorage.setItem(LAST_COURSE_KEY, String(courseId))
  }, [])

  const setModel = useCallback((m: string | null) => {
    setModelState(m)
    try {
      if (m) localStorage.setItem(MODEL_KEY, m)
      else localStorage.removeItem(MODEL_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const sessionsFor = useCallback(
    (courseId: number) =>
      sessions.filter((s) => s.courseId === courseId).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  )

  const activeFor = useCallback(
    (courseId: number): ChatSession | null => {
      const id = activeMap[courseId]
      const found = id ? sessions.find((s) => s.id === id) : undefined
      if (found) return found
      return sessionsFor(courseId)[0] ?? null
    },
    [activeMap, sessions, sessionsFor],
  )

  const updateSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...fn(s) } : s)))
  }, [])

  const openSession = useCallback((courseId: number, sessionId: string) => {
    setActiveMap((m) => ({ ...m, [courseId]: sessionId }))
    setLastCourse(courseId)
  }, [setLastCourse])

  const newChat = useCallback(
    (courseId: number) => {
      const s = makeSession(courseId)
      setSessions((ss) => [s, ...ss])
      setActiveMap((m) => ({ ...m, [courseId]: s.id }))
      setLastCourse(courseId)
    },
    [setLastCourse],
  )

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((ss) => ss.filter((s) => s.id !== sessionId))
    setActiveMap((m) => {
      const next = { ...m }
      for (const [k, v] of Object.entries(next)) {
        if (v === sessionId) delete next[Number(k)]
      }
      return next
    })
  }, [])

  const toggleTool = useCallback(
    (sessionId: string, msgIdx: number) => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m, i) =>
          i === msgIdx && m.role === 'tool' ? { ...m, open: !m.open } : m,
        ),
      }))
    },
    [updateSession],
  )

  const send = useCallback(
    async (courseId: number, raw: string) => {
      const text = raw.trim()
      if (!text || busy) return

      let sessionId = activeMap[courseId]
      const existing = sessionId ? sessions.find((s) => s.id === sessionId) : undefined
      if (!existing) {
        const s = makeSession(courseId)
        sessionId = s.id
        setSessions((ss) => [s, ...ss])
        setActiveMap((m) => ({ ...m, [courseId]: s.id }))
      }
      const sid = sessionId

      setBusy(true)
      setLastCourse(courseId)
      updateSession(sid, (s) => ({
        ...s,
        title: s.messages.length === 0 ? text.slice(0, 42) : s.title,
        updatedAt: Date.now(),
        messages: [...s.messages, { role: 'user', content: text }],
      }))

      const turnId = turnRef.current + 1
      turnRef.current = turnId
      let turnThinking = ''

      try {
        const history = (sessions.find((s) => s.id === sid)?.messages ?? [])
          .filter(
            (m): m is Extract<ChatMsg, { role: 'user' | 'assistant' }> =>
              m.role !== 'tool' && !(m.role === 'assistant' && m.streaming),
          )
          .map((m) => ({ role: m.role, content: m.content }))
        await streamChat(text, courseId, (event, data) => {
          const d = data as Record<string, string>
          if (event === 'reasoning') {
            // Aggregated chain-of-thought for THIS turn — the final answer's
            // thinking block carries all of it (intermediate rounds are hidden).
            turnThinking += (d.text ?? '')
          }
          if (event === 'tool_start') {
            updateSession(sid, (s) => {
              // Any in-flight assistant message (mid-turn narration before a
              // tool call) is intermediate — hidden from the UI. Only the
              // final answer after the last tool call is shown.
              const msgs = s.messages.map((m) =>
                m.role === 'assistant' && !m.thinkingDone
                  ? { ...m, intermediate: true, streaming: false }
                  : m,
              )
              return {
                ...s,
                messages: [
                  ...msgs,
                  {
                    role: 'tool',
                    tool: d.tool ?? 'tool',
                    args: d.args ?? undefined,
                    done: false,
                    open: false,
                    turnId,
                  },
                ],
              }
            })
          } else if (event === 'tool_end') {
            updateSession(sid, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.role === 'tool' && !m.done && m.tool === (d.tool ?? m.tool)
                  ? { ...m, done: true, result: d.result }
                  : m,
              ),
            }))
          } else if (event === 'reasoning') {
            updateSession(sid, (s) => {
              const last = s.messages[s.messages.length - 1]
              // Append to the in-flight assistant message of this turn (the
              // previous turn's answer has thinkingDone=true, so it starts a
              // fresh placeholder).
              if (last?.role === 'assistant' && !last.thinkingDone) {
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    { ...last, thinking: (last.thinking ?? '') + (d.text ?? '') },
                  ],
                }
              }
              return {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant',
                    content: '',
                    streaming: true,
                    thinking: d.text ?? '',
                    thinkingDone: false,
                  },
                ],
              }
            })
          } else if (event === 'token') {
            updateSession(sid, (s) => {
              const last = s.messages[s.messages.length - 1]
              if (last?.role === 'assistant' && last.streaming) {
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    {
                      ...last,
                      content: last.content + (d.text ?? ''),
                      thinking: turnThinking || last.thinking,
                      // The answer is streaming — the thinking phase is over.
                      thinkingDone: last.thinking ? true : last.thinkingDone,
                    },
                  ],
                }
              }
              return {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant',
                    content: d.text ?? '',
                    streaming: true,
                    thinkingDone: false,
                    thinking: turnThinking || undefined,
                  },
                ],
              }
            })
          } else if (event === 'done') {
            updateSession(sid, (s) => {
              const msgs = s.messages.map((m) =>
                m.role === 'tool'
                  ? { ...m, done: true }
                  : m.role === 'assistant' && m.streaming
                    ? { ...m, streaming: false, thinkingDone: true }
                    : m,
              )
              const last = msgs[msgs.length - 1]
              if (last?.role === 'assistant') {
                msgs[msgs.length - 1] = {
                  ...last,
                  thinkingDone: true,
                  thinking: last.thinking || turnThinking || undefined,
                }
              } else {
                // Nothing streamed at all — surface the final answer directly.
                msgs.push({
                  role: 'assistant',
                  content: (d.answer ?? '') as string,
                  streaming: false,
                  thinkingDone: true,
                })
              }
              return { ...s, messages: msgs }
            })
          }
        }, history, model ?? undefined)
      } catch (err) {
        updateSession(sid, (s) => ({
          ...s,
          messages: [
            ...s.messages,
            {
              role: 'assistant',
              content: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
              streaming: false,
            },
          ],
        }))
      } finally {
        updateSession(sid, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) => {
            if (m.role === 'assistant') return { ...m, streaming: false, thinkingDone: true }
            if (m.role === 'tool' && !m.done) return { ...m, done: true }
            return m
          }),
        }))
        setBusy(false)
      }
    },
    [busy, activeMap, sessions, updateSession, setLastCourse, model],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      sessions,
      busy,
      lastCourseId,
      model,
      setModel,
      setLastCourse,
      sessionsFor,
      activeFor,
      openSession,
      newChat,
      deleteSession,
      toggleTool,
      send,
    }),
    [
      sessions,
      busy,
      lastCourseId,
      model,
      setModel,
      setLastCourse,
      sessionsFor,
      activeFor,
      openSession,
      newChat,
      deleteSession,
      toggleTool,
      send,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
