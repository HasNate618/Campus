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

/** Self-reporting stream/sync status — the chat UI renders this so the next
 *  failure is diagnosable at a glance ('connecting' stuck = the POST never
 *  fired; 'streaming' but no text = render issue; 'error' = exact message). */
export interface StreamStatus {
  phase: 'idle' | 'loading' | 'connecting' | 'streaming' | 'done' | 'error'
  /** Most recent SSE event type seen (token / reasoning / tool_start / …). */
  lastEvent?: string
  /** Count of the most recent event type (e.g. 'token × 142'). */
  eventCount?: number
  /** Exact error text for phase === 'error'. */
  error?: string
}

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
  streamStatus: StreamStatus
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
  // secure-context-only; school.home.lab is plain HTTP
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

/** Zombie nodes are assistant messages whose stream died mid-turn (page
 *  reload/close before done) — they were persisted as 'Thinking…' forever.
 *  Normalize them so a reloaded chat never shows a spinner that never ends. */
function normalizeZombies(s: ChatSession): ChatSession {
  let changed = false
  const nodes = s.nodes.map((n) => {
    if (n.role !== 'assistant') return n
    if (n.streaming || (n.thinking && !n.thinkingDone)) {
      changed = true
      return {
        ...n,
        streaming: false,
        thinkingDone: true,
        intermediate: false,
        content: n.content || '⚠ The response was cut short (the page reloaded mid-turn). Try again.',
      }
    }
    return n
  })
  return changed ? { ...s, nodes } : s
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return (JSON.parse(raw) as ChatSession[])
        .filter((s) => s.nodes.some((n) => n.role !== 'tool'))
        .map(normalizeZombies)
    }
    const v2 = localStorage.getItem(V2_KEY)
    if (v2) {
      const migrated = migrateV2(JSON.parse(v2) as ChatSessionV2[])
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.map(stripUiFlags)))
      return migrated.map(normalizeZombies)
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
    // only sessions with actual messages survive — 'New chat' drafts are
    // in-memory only and vanish on reload
    const real = sessions.filter((s) => s.nodes.some((n) => n.role !== 'tool'))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(real.map(stripUiFlags)))
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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({ phase: 'idle' })
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
    return normalizeZombies({
      id: makeUuid(), // fresh client id — server id lives in serverId
      serverId: srv.id,
      courseId: srv.courseId ?? 0,
      title: srv.title,
      createdAt: Number.isFinite(ts) ? ts : Date.now(),
      updatedAt: Number.isFinite(ts) ? ts : Date.now(),
      nodes: (srv.nodes ?? []) as MsgNode[],
      activeNodeId: srv.activeNodeId ?? null,
    })
  }

  // Load server-side sessions once on mount (source of truth; localStorage is
  // only an offline cache now).
  useEffect(() => {
    let cancelled = false
    setStreamStatus({ phase: 'loading' })
    api
      .chatSessions()
      .then((list) => {
        if (cancelled) return
        setSessions((prev) => {
          // Keyed by SERVER id. The old code matched `byId.get(local.id)`
          // against these keys — local.id is a client uuid, never equal to a
          // numeric server id — so NO local session ever matched, and every
          // server session got appended as a fresh duplicate on EVERY reload.
          const byId = new Map(list.map((s) => [String(s.id), s]))
          const merged = prev.map((local) => {
            const key = local.serverId != null ? String(local.serverId) : local.id
            const srv = byId.get(key)
            if (!srv) return local
            byId.delete(key)
            const refreshed = toLocalSession(srv)
            // Keep a real client uuid stable (activeMap + in-flight streams
            // target it); reconcile numeric-id leftovers from the old
            // uuid→server-id promotion to a fresh uuid + serverId.
            const id = /^[0-9]+$/.test(local.id) ? makeUuid() : local.id
            return { ...refreshed, id }
          })
          for (const srv of byId.values()) merged.push(toLocalSession(srv))
          return merged
        })
        setStreamStatus({ phase: 'idle' })
      })
      .catch((e) => {
        console.error('[chat-sync] load failed:', e)
        const msg = e instanceof Error ? e.message : String(e)
        setStreamStatus({
          phase: 'error',
          error: `session load failed: ${msg}`,
        })
      })
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
      const msg = e instanceof Error ? e.message : String(e)
      setStreamStatus({
        phase: 'error',
        error: `session save failed: ${msg}`,
      })
    } finally {
      savingRef.current = false
    }
  }

  useEffect(() => {
    // localStorage is a cache now; don't hammer it on every token while a
    // stream is running (the server gets the live tree instead)
    if (busyRef.current) return
    persist(sessions)
  }, [sessions])

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
    try {
      localStorage.setItem(LAST_COURSE_KEY, String(courseId))
    } catch {
      /* quota/security — non-fatal */
    }
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
      // '' = explicit empty-chat state (New chat pressed) — show the blank
      // screen instead of falling back to the most recent session
      if (id === '') return null
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
    // Reset to the EMPTY chat state without creating a session — the session
    // materializes on the first message (send creates it inline). Empty
    // 'New chat' drafts no longer accumulate in memory or the session list.
    setActiveMap((m) => ({ ...m, [courseId]: '' }))
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
      // per-stream event ticker for the self-reporting status line
      let lastEvent: string | undefined
      const eventCounts: Record<string, number> = {}
      setStreamStatus({ phase: 'connecting' })
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
          // event ticker → status line ('token × 142')
          eventCounts[event] = (eventCounts[event] ?? 0) + 1
          lastEvent = event
          setStreamStatus({ phase: 'streaming', lastEvent: event, eventCount: eventCounts[event] })
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
              // tool_start hid this node as mid-turn narration — real content
              // tokens mean the answer is back, so show it again
              intermediate: false,
            }))
          } else if (event === 'tool_start') {
            // keep the assistant node VISIBLE (its tool chips render live as
            // each tool starts: running → done) — hiding it made every tool
            // call invisible until the final answer began
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
            setStreamStatus({ phase: 'done', lastEvent: 'done', eventCount: eventCounts.token })
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
                intermediate: false,
                thinking: n.thinking || turnThinking || undefined,
                model: (d.model as string) || undefined,
                tokens: (d.usage as MsgNode['tokens']) || undefined,
              }))
            }
          } else if (event === 'error') {
            // backend runner failed (run_turn raised) — the stream closes
            // right after, so surface the exact message AS A VISIBLE NODE
            // (a status line alone is invisible — the user saw thinking +
            // tools then nothing)
            setStreamStatus({
              phase: 'error',
              lastEvent: 'error',
              error: String(d?.message ?? 'stream error'),
            })
            const errText = `⚠ Stream failed: ${String(d?.message ?? 'stream error')}`
            if (assistantId) {
              patchNode(sid, assistantId, (n) => ({
                ...n,
                streaming: false,
                intermediate: false,
                content: (n.content || '') + '\n\n' + errText,
              }))
            } else {
              const id = makeUuid()
              appendNode(sid, {
                id,
                parentId: userNodeId,
                children: [],
                role: 'assistant',
                content: errText,
                streaming: false,
                thinkingDone: true,
                createdAt: Date.now(),
              })
              setActiveNode(sid, id)
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
          setStreamStatus({ phase: 'error', lastEvent: 'error', error: errMsg })
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
          if (!receivedDone) {
            setStreamStatus((prev) =>
              prev.phase === 'error' ? prev : {
                phase: 'error',
                lastEvent: prev.lastEvent,
                error: `stream ended without a done event (last: ${lastEvent ?? 'none'})`,
              },
            )
          }
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
            title: s.nodes.length === 0 ? text.slice(0, 42) : s.title,
            updatedAt: Date.now(),
            activeNodeId: userNodeId,
            nodes: [...nodes, userNode],
          }
        }),
      )
      busyRef.current = true
      setBusy(true)
      try {
        setLastCourse(courseId)
      } catch {
        /* never let a non-critical write kill the stream */
      }
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
      // the user message itself survives (rewritten) — only its DESCENDANTS
      // are deleted. Removing the node too left the re-sent turn streaming
      // into a ghost parent: the user message vanished and only the new
      // assistant response rendered.
      doomed.delete(nodeId)
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

  const deleteMessage = useCallback(
    (sessionId: string, nodeId: string) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const target = session.nodes.find((n) => n.id === nodeId)
      if (!target) return
      const parentId = target.parentId
      // Delete JUST this message and REJOIN the conversation: direct
      // user/assistant children re-parent to the deleted node's parent, so
      // deleting a middle user message no longer wipes every later message
      // (the old behavior forced deleting the assistant reply first).
      // Tool/intermediate nodes are artifacts and die with their parent.
      const kids = session.nodes.filter((n) => n.parentId === nodeId)
      const rejoin = kids.filter((k) => k.role !== 'tool' && !(k.role === 'assistant' && k.intermediate))
      const artifactIds = new Set(kids.filter((k) => !rejoin.some((r) => r.id === k.id)).map((k) => k.id))
      const nodes = session.nodes
        .filter((n) => n.id !== nodeId && !artifactIds.has(n.id))
        .map((n) => {
          if (n.id === parentId) {
            const keep = n.children.filter((c) => c !== nodeId && !artifactIds.has(c))
            return { ...n, children: [...keep, ...rejoin.map((k) => k.id)] }
          }
          return rejoin.some((k) => k.id === n.id) ? { ...n, parentId } : n
        })
      // active node: if we deleted the active message, fall back to a
      // remaining sibling branch first (deleting a regenerated v2 shows v1),
      // then to the parent
      let activeNodeId = session.activeNodeId
      if (activeNodeId === nodeId) {
        const parent = nodes.find((n) => n.id === parentId)
        const siblings = (parent?.children ?? [])
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is MsgNode => !!n && n.role !== 'tool')
        activeNodeId = siblings.length ? siblings[siblings.length - 1]!.id : parentId
      }
      // safety: never leave the path rooted at a missing node
      if (activeNodeId && !nodes.some((n) => n.id === activeNodeId)) {
        activeNodeId = nodes[nodes.length - 1]?.id ?? null
      }
      if (nodes.length === 0) {
        // the last message is gone → the session is empty → drop it entirely
        if (session.serverId != null) {
          api.chatSessionDelete(session.serverId).catch((e) => console.error('[chat-sync] delete failed:', e))
        }
        setSessions((ss) => ss.filter((s) => s.id !== sessionId))
        return
      }
      setSessions((ss) =>
        ss.map((s) => (s.id === sessionId ? { ...s, updatedAt: Date.now(), activeNodeId, nodes } : s)),
      )
    },
    [sessions],
  )

  const setActiveBranch = useCallback((sessionId: string, nodeId: string) => {
    setActiveNode(sessionId, nodeId)
  }, [setActiveNode])

  const value = useMemo<ChatContextValue>(
    () => ({
      sessions,
      busy,
      streamStatus,
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
      sessions, busy, streamStatus, lastCourseId, model, setModel, setLastCourse, sessionsFor,
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
