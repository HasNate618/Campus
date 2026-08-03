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
import { streamChat, api, type ChatServerSession } from '@/api/client'

/** Chat message tree (Open WebUI-style): a flat node store linked by
 *  parentId/children. The visible conversation is the path from the root
 *  node to activeNodeId. Regenerating an assistant message forks the tree
 *  (new sibling); editing a user message rewinds (subtree deleted, re-sent).
 */
export interface MsgNode {
  id: string
  parentId: string | null
  children: string[]
  role: 'user' | 'assistant' | 'tool'
  content: string
  streaming?: boolean
  thinking?: string
  thinkingDone?: boolean
  /** Mid-turn narration hidden from the UI + branch chips. */
  intermediate?: boolean
  model?: string
  tokens?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  tool?: string
  args?: unknown
  result?: unknown
  done?: boolean
  open?: boolean
  createdAt: number
}

export interface ChatSession {
  id: string
  /** Server row id once persisted (the client id NEVER changes — the stream
   *  callbacks target it, so an id swap mid-stream would silently drop
   *  every event that arrives after the swap). */
  serverId?: number
  courseId: number
  title: string
  createdAt: number
  updatedAt: number
  nodes: MsgNode[]
  activeNodeId: string | null
}

export type ChatMsg = MsgNode

export interface ChatSessionV2 {
  id: string
  courseId: number
  title: string
  createdAt: number
  updatedAt: number
  messages: {
    role: 'user' | 'assistant' | 'tool'
    content: string
    streaming?: boolean
    thinking?: string
    thinkingDone?: boolean
    intermediate?: boolean
    tool?: string
    args?: unknown
    result?: unknown
    done?: boolean
    open?: boolean
  }[]
}

interface ChatContextValue {
  sessions: ChatSession[]
  busy: boolean
  lastCourseId: number | null
  model: string | null
  setModel: (m: string | null) => void
  setLastCourse: (c: number) => void
  sessionsFor: (courseId: number) => ChatSession[]
  activeFor: (courseId: number) => ChatSession | null
  openSession: (courseId: number, sessionId: string) => void
  newChat: (courseId: number) => void
  deleteSession: (sessionId: string) => void
  send: (courseId: number, text: string) => boolean
  regenerate: (sessionId: string, nodeId: string) => void
  editMessage: (sessionId: string, nodeId: string, newText: string) => void
  deleteMessage: (sessionId: string, nodeId: string) => void
  setActiveBranch: (sessionId: string, nodeId: string) => void
}

const STORAGE_KEY = 'hc.chat.sessions.v3'
const V2_KEY = 'hc.chat.sessions.v2'
const ACTIVE_KEY = 'hc.chat.active'
const LAST_COURSE_KEY = 'hc.chat.lastCourse'
const MODEL_KEY = 'hc.chat.model'
const MAX_SESSIONS = 50

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // secure-context-only; campus.local is plain HTTP
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function makeSession(courseId: number): ChatSession {
  const id = makeUuid()
  return { id, courseId, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), nodes: [], activeNodeId: null }
}

/** Path from the root to activeNodeId (the displayed conversation). */
export function pathFor(session: ChatSession): MsgNode[] {
  const out: MsgNode[] = []
  let cur = session.nodes.find((n) => n.id === session.activeNodeId) ?? null
  const guard = new Set<string>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    out.push(cur)
    cur = session.nodes.find((n) => n.id === cur!.parentId) ?? null
  }
  return out.reverse()
}

function migrateV2(raw: ChatSessionV2[]): ChatSession[] {
  return raw.map((s) => {
    const nodes: MsgNode[] = []
    let lastUserOrAssistant: string | null = null
    let lastAssistant: string | null = null
    for (const m of s.messages) {
      const id = makeUuid()
      if (m.role === 'user') {
        nodes.push({ id, parentId: lastUserOrAssistant, children: [], role: 'user', content: m.content, createdAt: Date.now() })
        lastUserOrAssistant = id
      } else if (m.role === 'assistant') {
        nodes.push({
          id, parentId: lastUserOrAssistant, children: [], role: 'assistant',
          content: m.content, thinking: m.thinking, thinkingDone: m.thinkingDone,
          intermediate: m.intermediate, createdAt: Date.now(),
        })
        lastUserOrAssistant = id
        lastAssistant = id
      } else if (m.role === 'tool' && lastAssistant) {
        nodes.push({
          id, parentId: lastAssistant, children: [], role: 'tool', content: '',
          tool: m.tool, args: m.args, result: m.result, done: m.done, open: m.open,
          createdAt: Date.now(),
        })
        const a = nodes.find((n) => n.id === lastAssistant)
        if (a) a.children.push(id)
      }
    }
    return {
      ...s,
      nodes,
      activeNodeId: lastUserOrAssistant ?? null,
    }
  })
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ChatSession[]
    const v2 = localStorage.getItem(V2_KEY)
    if (v2) {
      const migrated = migrateV2(JSON.parse(v2) as ChatSessionV2[])
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.map(stripUiFlags)))
      return migrated
    }
  } catch {
    /* ignore corrupt storage */
  }
  return []
}

function stripUiFlags(s: ChatSession): ChatSession {
  return {
    ...s,
    nodes: s.nodes.map(({ streaming: _s, open: _o, ...rest }) => rest),
  }
}

function persist(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.map(stripUiFlags)))
  } catch {
    /* quota — keep in-memory */
  }
}

/** Collect a node's id + all descendant ids. */
function collectSubtree(nodes: MsgNode[], rootId: string): Set<string> {
  const out = new Set<string>([rootId])
  const queue: (string | undefined)[] = [rootId]
  while (queue.length) {
    const cur = nodes.find((n) => n.id === queue.shift())
    for (const c of cur?.children ?? []) {
      if (!out.has(c)) {
        out.add(c)
        queue.push(c)
      }
    }
  }
  return out
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [activeMap, setActiveMap] = useState<Record<number, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(ACTIVE_KEY) || '{}') as Record<number, string>
    } catch {
      return {}
    }
  })
  const [busy, setBusy] = useState(false)
  const [lastCourseId, setLastCourseId] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(LAST_COURSE_KEY))
      return Number.isFinite(v) && v > 0 ? v : null
    } catch {
      return null
    }
  })
  const [model, setModelState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MODEL_KEY)
    } catch {
      return null
    }
  })
  const busyRef = useRef(false)
  const modelRef = useRef(model)
  modelRef.current = model
  const serverReadyRef = useRef(false)
  const savingRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  function toLocalSession(srv: ChatServerSession): ChatSession {
    const ts = new Date(srv.updatedAt.replace(' ', 'T')).getTime()
    return {
      id: makeUuid(), // fresh client id — server id lives in serverId
      serverId: srv.id,
      courseId: srv.courseId ?? 0,
      title: srv.title,
      createdAt: Number.isFinite(ts) ? ts : Date.now(),
      updatedAt: Number.isFinite(ts) ? ts : Date.now(),
      nodes: (srv.nodes ?? []) as MsgNode[],
      activeNodeId: srv.activeNodeId ?? null,
    }
  }

  // Load server-side sessions once on mount (source of truth; localStorage is
  // only an offline cache now).
  useEffect(() => {
    let cancelled = false
    api
      .chatSessions()
      .then((list) => {
        if (cancelled) return
        setSessions((prev) => {
          const byId = new Map(list.map((s) => [String(s.id), s]))
          const merged = prev.map((local) => {
            const srv = byId.get(local.id)
            if (!srv) return local
            byId.delete(local.id)
            return toLocalSession(srv)
          })
          for (const srv of byId.values()) merged.push(toLocalSession(srv))
          return merged
        })
      })
      .catch((e) => console.error('[chat-sync] load failed:', e))
      .finally(() => {
        if (!cancelled) serverReadyRef.current = true
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced save: every change pushes the tree to the server.
  useEffect(() => {
    if (!serverReadyRef.current) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveSessions()
    }, 900)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  async function saveSessions(): Promise<void> {
    if (savingRef.current) return
    savingRef.current = true
    try {
      for (const s of sessionsRef.current) {
        if (s.nodes.length === 0) continue // never persist empty drafts
        const payload = {
          title: s.title,
          nodes: stripUiFlags(s).nodes,
          activeNodeId: s.activeNodeId,
        }
        if (s.serverId != null) {
          await api.chatSessionSave(s.serverId, payload)
        } else {
          const created = await api.chatSessionCreate(s.courseId, s.title)
          // only set serverId — the client id stays put so in-flight streams
          // keep targeting the right session
          setSessions((ss) =>
            ss.map((x) => (x.id === s.id ? { ...x, serverId: created.id } : x)),
          )
          await api.chatSessionSave(created.id, payload)
        }
      }
    } catch (e) {
      console.error('[chat-sync] save failed:', e)
    } finally {
      savingRef.current = false
    }
  }

  useEffect(() => persist(sessions), [sessions])

  // Persist the active session per course so a reload reopens the same chat
  // instead of starting a fresh one.
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeMap))
    } catch {
      /* ignore */
    }
  }, [activeMap])

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
    (courseId: number) => sessions.filter((s) => s.courseId === courseId),
    [sessions],
  )

  const activeFor = useCallback(
    (courseId: number) => {
      const id = activeMap[courseId]
      const found = id ? sessions.find((s) => s.id === id) : undefined
      if (found) return found
      // stale/missing active (e.g. after an id promotion) — fall back to the
      // most recently updated session for the course instead of a blank chat
      return (
        sessions
          .filter((s) => s.courseId === courseId)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
      )
    },
    [sessions, activeMap],
  )

  const openSession = useCallback((courseId: number, sessionId: string) => {
    setActiveMap((m) => ({ ...m, [courseId]: sessionId }))
  }, [])

  const newChat = useCallback((courseId: number) => {
    const s = makeSession(courseId)
    setSessions((ss) => [s, ...ss].slice(0, MAX_SESSIONS))
    setActiveMap((m) => ({ ...m, [courseId]: s.id }))
  }, [])

  const deleteSession = useCallback((sessionId: string) => {
    const srv = sessionsRef.current.find((s) => s.id === sessionId)
    if (srv?.serverId != null) {
      api.chatSessionDelete(srv.serverId).catch((e) => console.error('[chat-sync] delete failed:', e))
    }
    setSessions((ss) => ss.filter((s) => s.id !== sessionId))
    setActiveMap((m) => {
      const next: Record<number, string> = {}
      for (const [k, v] of Object.entries(m)) if (v !== sessionId) next[Number(k)] = v
      return next
    })
  }, [])

  const patchNode = useCallback((sid: string, nid: string, fn: (n: MsgNode) => MsgNode) => {
    setSessions((ss) =>
      ss.map((s) =>
        s.id !== sid
          ? s
          : { ...s, updatedAt: Date.now(), nodes: s.nodes.map((n) => (n.id === nid ? fn(n) : n)) },
      ),
    )
  }, [])

  const setActiveNode = useCallback((sid: string, nid: string) => {
    setSessions((ss) =>
      ss.map((s) => (s.id !== sid ? s : { ...s, updatedAt: Date.now(), activeNodeId: nid })),
    )
  }, [])

  /** Stream one turn into a new assistant child of userNodeId. */
  const streamTurn = useCallback(
    (sid: string, userNodeId: string, message: string, courseId: number | null, history: { role: 'user' | 'assistant'; content: string }[]) => {
      let assistantId: string | null = null
      let turnThinking = ''
      let receivedDone = false
      const ensureAssistant = (seedThinking?: string): string => {
        if (assistantId) return assistantId
        assistantId = makeUuid()
        appendNode(sid, {
          id: assistantId, parentId: userNodeId, children: [], role: 'assistant',
          content: '', streaming: true, thinking: seedThinking ?? '', thinkingDone: false,
          createdAt: Date.now(),
        })
        setActiveNode(sid, assistantId)
        return assistantId
      }
      const appendNode = (s: string, node: MsgNode) => {
        setSessions((ss) =>
          ss.map((x) => {
            if (x.id !== s) return x
            const nodes = node.parentId
              ? x.nodes.map((n) => (n.id === node.parentId ? { ...n, children: [...n.children, node.id] } : n))
              : x.nodes
            return { ...x, updatedAt: Date.now(), nodes: [...nodes, node] }
          }),
        )
      }
      void streamChat(
        message,
        courseId,
        (event, data) => {
          const d = data as Record<string, unknown>
          if (event === 'reasoning') {
            turnThinking += (d.text as string) ?? ''
            const id = ensureAssistant()
            patchNode(sid, id, (n) => ({ ...n, thinking: (n.thinking ?? '') + ((d.text as string) ?? '') }))
          } else if (event === 'token') {
            const id = ensureAssistant(turnThinking || undefined)
            patchNode(sid, id, (n) => ({
              ...n,
              content: n.content + ((d.text as string) ?? ''),
              thinking: turnThinking || n.thinking,
              thinkingDone: n.thinking ? true : n.thinkingDone,
            }))
          } else if (event === 'tool_start') {
            if (assistantId) patchNode(sid, assistantId, (n) => ({ ...n, intermediate: true, streaming: false }))
            const toolId = makeUuid()
            appendNode(sid, {
              id: toolId, parentId: assistantId ?? userNodeId, children: [], role: 'tool',
              content: '', tool: (d.tool as string) ?? 'tool', args: d.args, done: false,
              open: false, createdAt: Date.now(),
            })
          } else if (event === 'tool_end') {
            setSessions((ss) =>
              ss.map((s) =>
                s.id !== sid
                  ? s
                  : {
                      ...s,
                      updatedAt: Date.now(),
                      nodes: s.nodes.map((n) =>
                        n.role === 'tool' && n.tool === (d.tool as string) && !n.done
                          ? { ...n, done: true, result: d.result }
                          : n,
                      ),
                    },
              ),
            )
          } else if (event === 'done') {
            receivedDone = true
            if (!assistantId) {
              // nothing streamed at all — surface the final answer directly
              const id = makeUuid()
              appendNode(sid, {
                id, parentId: userNodeId, children: [], role: 'assistant',
                content: (d.answer as string) ?? '', streaming: false, thinkingDone: true,
                thinking: turnThinking || undefined, createdAt: Date.now(),
              })
              setActiveNode(sid, id)
            } else {
              patchNode(sid, assistantId, (n) => ({
                ...n,
                streaming: false,
                thinkingDone: true,
                thinking: n.thinking || turnThinking || undefined,
                model: (d.model as string) || undefined,
                tokens: (d.usage as MsgNode['tokens']) || undefined,
              }))
            }
          }
        },
        history,
        modelRef.current ?? undefined,
        userNodeId,
      )
        .catch((err) => {
          // surface stream failures IN the chat — never silent
          const errMsg = String(err?.message ?? err) || 'unknown stream error'
          if (assistantId) {
            patchNode(sid, assistantId, (n) => ({
              ...n,
              streaming: false,
              thinkingDone: true,
              content: n.content || `⚠ Stream failed: ${errMsg}`,
            }))
          } else {
            const eid = makeUuid()
            appendNode(sid, {
              id: eid, parentId: userNodeId, children: [], role: 'assistant',
              content: `⚠ Stream failed: ${errMsg}`, streaming: false, thinkingDone: true,
              createdAt: Date.now(),
            })
            setActiveNode(sid, eid)
          }
        })
        .finally(() => {
          // stream ended without a done event → the response was cut short
          if (!receivedDone && !assistantId) {
            const eid = makeUuid()
            appendNode(sid, {
              id: eid, parentId: userNodeId, children: [], role: 'assistant',
              content: '⚠ The response ended before completing (no done event). Try again.',
              streaming: false, thinkingDone: true, createdAt: Date.now(),
            })
            setActiveNode(sid, eid)
          } else if (!receivedDone && assistantId) {
            patchNode(sid, assistantId, (n) => ({
              ...n,
              streaming: false,
              thinkingDone: true,
              content: n.content || '⚠ The response ended before completing. Try again.',
            }))
          }
          busyRef.current = false
          setBusy(false)
        })
    },
    [sessions, patchNode, setActiveNode],
  )

  const send = useCallback(
    (courseId: number, text: string): boolean => {
      if (busyRef.current || !text.trim()) return false
      let sid = activeFor(courseId)?.id
      if (!sid) {
        // first message of a new session — create it inline (async newChat
        // would drop the message)
        const s = makeSession(courseId)
        sid = s.id
        setSessions((ss) => [s, ...ss].slice(0, MAX_SESSIONS))
        setActiveMap((m) => ({ ...m, [courseId]: s.id }))
      }
      const session = sessions.find((x) => x.id === sid) ?? { id: sid!, courseId, title: '', createdAt: 0, updatedAt: 0, nodes: [], activeNodeId: null }
      const history = pathFor(session)
        .filter((n) => n.role !== 'tool' && !(n.role === 'assistant' && n.intermediate))
        .map((n) => ({ role: n.role as 'user' | 'assistant', content: n.content }))

      const userNodeId = makeUuid()
      const isNew = session.nodes.length === 0
      setSessions((ss) =>
        ss.map((s) => {
          if (s.id !== sid) return s
          const userNode: MsgNode = {
            id: userNodeId, parentId: s.activeNodeId, children: [], role: 'user',
            content: text, createdAt: Date.now(),
          }
          const nodes = s.activeNodeId
            ? s.nodes.map((n) => (n.id === s.activeNodeId ? { ...n, children: [...n.children, userNodeId] } : n))
            : s.nodes
          return {
            ...s,
            title: isNew ? text.slice(0, 42) : s.title,
            updatedAt: Date.now(),
            activeNodeId: userNodeId,
            nodes: [...nodes, userNode],
          }
        }),
      )
      busyRef.current = true
      setBusy(true)
      setLastCourse(courseId)
      streamTurn(sid, userNodeId, text, courseId, history)
      return true
    },
    [activeFor, sessions, setLastCourse, streamTurn],
  )

  const regenerate = useCallback(
    (sessionId: string, nodeId: string) => {
      if (busyRef.current) return
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const target = session.nodes.find((n) => n.id === nodeId)
      if (!target || target.role !== 'assistant') return
      const parentId = target.parentId
      const userNode = session.nodes.find((n) => n.id === parentId)
      if (!userNode) return
      const history = pathFor(session)
        .filter((n) => n.id !== parentId && n.role !== 'tool' && !(n.role === 'assistant' && n.intermediate))
        .map((n) => ({ role: n.role as 'user' | 'assistant', content: n.content }))
      busyRef.current = true
      setBusy(true)
      streamTurn(sessionId, userNode.id, userNode.content, session.courseId, history)
    },
    [sessions, streamTurn],
  )

  const editMessage = useCallback(
    (sessionId: string, nodeId: string, newText: string) => {
      if (busyRef.current || !newText.trim()) return
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const target = session.nodes.find((n) => n.id === nodeId)
      if (!target || target.role !== 'user') return
      const doomed = collectSubtree(session.nodes, nodeId)
      const history = pathFor(session)
        .filter((n) => n.id !== nodeId && !doomed.has(n.id) && n.role !== 'tool' && !(n.role === 'assistant' && n.intermediate))
        .map((n) => ({ role: n.role as 'user' | 'assistant', content: n.content }))
      setSessions((ss) =>
        ss.map((s) => {
          if (s.id !== sessionId) return s
          return {
            ...s,
            updatedAt: Date.now(),
            activeNodeId: nodeId,
            nodes: s.nodes
              .filter((n) => !doomed.has(n.id))
              .map((n) =>
                n.children.some((c) => doomed.has(c))
                  ? { ...n, children: n.children.filter((c) => !doomed.has(c)) }
                  : n,
              )
              .map((n) => (n.id === nodeId ? { ...n, content: newText } : n)),
          }
        }),
      )
      busyRef.current = true
      setBusy(true)
      streamTurn(sessionId, nodeId, newText, session.courseId, history)
    },
    [sessions, streamTurn],
  )

  const deleteMessage = useCallback((sessionId: string, nodeId: string) => {
    setSessions((ss) =>
      ss.map((s) => {
        if (s.id !== sessionId) return s
        const doomed = collectSubtree(s.nodes, nodeId)
        const target = s.nodes.find((n) => n.id === nodeId)
        const activeDoomed = s.activeNodeId ? doomed.has(s.activeNodeId) : false
        const nodes = s.nodes
          .filter((n) => !doomed.has(n.id))
          .map((n) =>
            n.children.some((c) => doomed.has(c))
              ? { ...n, children: n.children.filter((c) => !doomed.has(c)) }
              : n,
          )
        let activeNodeId = activeDoomed ? (target?.parentId ?? null) : s.activeNodeId
        // safety: never leave the path rooted at a missing node
        if (activeNodeId && !nodes.some((n) => n.id === activeNodeId)) {
          activeNodeId = nodes[nodes.length - 1]?.id ?? null
        }
        return { ...s, updatedAt: Date.now(), activeNodeId, nodes }
      }),
    )
  }, [])

  const setActiveBranch = useCallback((sessionId: string, nodeId: string) => {
    setActiveNode(sessionId, nodeId)
  }, [setActiveNode])

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
      send,
      regenerate,
      editMessage,
      deleteMessage,
      setActiveBranch,
    }),
    [
      sessions, busy, lastCourseId, model, setModel, setLastCourse, sessionsFor,
      activeFor, openSession, newChat, deleteSession, send, regenerate,
      editMessage, deleteMessage, setActiveBranch,
    ],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
