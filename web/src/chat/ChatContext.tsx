import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { streamChat } from '@/api/client'

export type ChatMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming: boolean }
  | { role: 'tool'; tool: string; args?: string; result?: string; done: boolean; open: boolean }

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
const MAX_SESSIONS = 50

function stripUiFlags(m: ChatMsg): ChatMsg {
  if (m.role === 'assistant') return { ...m, streaming: false }
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

function makeSession(courseId: number): ChatSession {
  return {
    id: crypto.randomUUID(),
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

      try {
        await streamChat(text, courseId, (event, data) => {
          const d = data as Record<string, string>
          if (event === 'tool_start') {
            updateSession(sid, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                {
                  role: 'tool',
                  tool: d.tool ?? 'tool',
                  args: d.args ? JSON.stringify(d.args) : undefined,
                  done: false,
                  open: false,
                },
              ],
            }))
          } else if (event === 'tool_end') {
            updateSession(sid, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.role === 'tool' && !m.done && m.tool === (d.tool ?? m.tool)
                  ? { ...m, done: true, result: d.result }
                  : m,
              ),
            }))
          } else if (event === 'token') {
            updateSession(sid, (s) => {
              const last = s.messages[s.messages.length - 1]
              if (last?.role === 'assistant' && last.streaming) {
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    { ...last, content: last.content + (d.text ?? '') },
                  ],
                }
              }
              return {
                ...s,
                messages: [...s.messages, { role: 'assistant', content: d.text ?? '', streaming: true }],
              }
            })
          }
        })
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
          messages: s.messages.map((m) =>
            m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m,
          ),
        }))
        setBusy(false)
      }
    },
    [busy, activeMap, sessions, updateSession, setLastCourse],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      sessions,
      busy,
      lastCourseId,
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
