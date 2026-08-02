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
  courseId: number | null
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
}

const STORAGE_KEY = 'hc.chat.sessions.v1'
const MAX_SESSIONS = 30

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
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map((s) => ({ ...s, messages: s.messages.map(stripUiFlags) }))
  } catch {
    return []
  }
}

function persistSessions(sessions: ChatSession[], activeId: string | null) {
  const kept = sessions
    .filter((s) => s.messages.length > 0 || s.id === activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
    .map((s) => ({ ...s, messages: s.messages.map(stripUiFlags) }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept))
  } catch {
    // storage full — drop oldest and retry once
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept.slice(0, 10)))
  }
}

interface ChatContextValue {
  sessions: ChatSession[]
  active: ChatSession
  scope: number | null
  busy: boolean
  input: string
  setInput: (v: string) => void
  setScope: (courseId: number | null) => void
  newChat: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  toggleTool: (msgIdx: number) => void
  send: (text: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

function makeSession(courseId: number | null): ChatSession {
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scope, setScopeState] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  const updateSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => {
    setSessions((ss) => ss.map((s) => (s.id === id ? { ...fn(s) } : s)))
  }, [])

  const newChat = useCallback(() => {
    const s = makeSession(scope)
    setSessions((ss) => [s, ...ss])
    setActiveId(s.id)
  }, [scope])

  // Ensure there's always an active session.
  useEffect(() => {
    if (!active) newChat()
  }, [active, newChat])

  useEffect(() => {
    persistSessions(sessions, activeId)
  }, [sessions, activeId])

  const setScope = useCallback(
    (courseId: number | null) => {
      setScopeState(courseId)
      if (activeId) {
        updateSession(activeId, (s) => ({ ...s, courseId }))
      }
    },
    [activeId, updateSession],
  )

  const selectSession = useCallback(
    (id: string) => {
      setActiveId(id)
      const s = sessions.find((x) => x.id === id)
      if (s) setScopeState(s.courseId)
    },
    [sessions],
  )

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((ss) => ss.filter((s) => s.id !== id))
      if (id === activeId) {
        const next = sessions.find((s) => s.id !== id && s.messages.length > 0)
        if (next) {
          setActiveId(next.id)
          setScopeState(next.courseId)
        } else {
          setActiveId(null)
        }
      }
    },
    [activeId, sessions],
  )

  const toggleTool = useCallback(
    (msgIdx: number) => {
      if (!activeId) return
      updateSession(activeId, (s) => ({
        ...s,
        messages: s.messages.map((m, i) =>
          i === msgIdx && m.role === 'tool' ? { ...m, open: !m.open } : m,
        ),
      }))
    },
    [activeId, updateSession],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy || !activeId) return
      const sessionId = activeId
      const courseId = sessions.find((s) => s.id === sessionId)?.courseId ?? null

      setBusy(true)
      setInput('')
      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? text.slice(0, 42) : s.title,
        updatedAt: Date.now(),
        messages: [...s.messages, { role: 'user', content: text }],
      }))

      try {
        await streamChat(text, courseId, (event, data) => {
          const d = data as Record<string, string>
          if (event === 'tool_start') {
            updateSession(sessionId, (s) => ({
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
            updateSession(sessionId, (s) => ({
              ...s,
              messages: s.messages.map((m) =>
                m.role === 'tool' && !m.done && m.tool === (d.tool ?? m.tool)
                  ? { ...m, done: true, result: d.result }
                  : m,
              ),
            }))
          } else if (event === 'token') {
            updateSession(sessionId, (s) => {
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
        updateSession(sessionId, (s) => ({
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
        updateSession(sessionId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) =>
            m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m,
          ),
        }))
        setBusy(false)
      }
    },
    [busy, activeId, sessions, updateSession],
  )

  const value: ChatContextValue = {
    sessions,
    active: active ?? makeSession(scope),
    scope,
    busy,
    input,
    setInput,
    setScope,
    newChat,
    selectSession,
    deleteSession,
    toggleTool,
    send,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
