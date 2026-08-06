import type {
  Announcement,
  Assignment,
  ContentNode,
  Course,
  CourseHub,
  Event,
  FileContent,
  FileRecord,
  SyncRun,
  WorkspaceTree,
} from '../types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const api = {
  health: () => get<{ status: string; db: boolean }>('/health'),
  courses: (activeOnly = true) => get<Course[]>(`/courses?active_only=${activeOnly}`),
  course: (id: number) => get<Course>(`/courses/${id}`),
  courseHub: (id: number) => get<CourseHub>(`/courses/${id}/hub`),
  contentTree: (id: number) =>
    get<{ nodes: ContentNode[]; files: FileRecord[]; file_topics: { file_id: number; topic_id: number }[] }>(`/courses/${id}/content-tree`),
  assignments: (id: number, upcoming = false) =>
    get<Assignment[]>(`/courses/${id}/assignments?upcoming=${upcoming}`),
  assignment: (courseId: number, id: number) => get<Assignment>(`/courses/${courseId}/assignments/${id}`),
  workspaceTree: (courseId: number) => get<WorkspaceTree>(`/courses/${courseId}/workspace/tree`),
  workspaceRead: (courseId: number, path: string) =>
    get<{ text: string | null; viewable: boolean; asset: string | null }>(`/courses/${courseId}/workspace/file?path=${encodeURIComponent(path)}`),
  workspaceWrite: (courseId: number, path: string, content: string) =>
    request<{ path: string; size: number }>(`/courses/${courseId}/workspace/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  workspaceDelete: (courseId: number, path: string) =>
    request<{ path: string }>(`/courses/${courseId}/workspace/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  workspaceMkdir: (courseId: number, path: string) =>
    post<{ path: string }>(`/courses/${courseId}/workspace/dir?path=${encodeURIComponent(path)}`),
  announcements: (courseId?: number, limit = 20) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (courseId != null) q.set('course_id', String(courseId))
    return get<Announcement[]>(`/announcements?${q}`)
  },
  events: (params?: { course_id?: number; from_dt?: string; to_dt?: string }) => {
    const q = new URLSearchParams()
    if (params?.course_id != null) q.set('course_id', String(params.course_id))
    if (params?.from_dt) q.set('from_dt', params.from_dt)
    if (params?.to_dt) q.set('to_dt', params.to_dt)
    return get<Event[]>(`/events?${q}`)
  },
  eventsNext7: (courseId?: number) => {
    const q = courseId != null ? `?course_id=${courseId}` : ''
    return get<Event[]>(`/events/next-7-days${q}`)
  },
  fileContent: (id: number) => get<FileContent>(`/files/${id}/content`),
  memoryCard: (courseId: number) => get<{ markdown: string }>(`/courses/${courseId}/memory`),
  syncStatus: () => get<{ status: string; last_run: SyncRun | null; token_valid?: boolean }>('/sync/status'),
  syncRuns: (limit = 20) => get<SyncRun[]>(`/sync/runs?limit=${limit}`),
  syncLog: (runId: number) => get<{ markdown: string }>(`/sync/runs/${runId}/log`),
  triggerSync: (courseId?: number) =>
    post<{ run_id: number; status: string; message: string }>(
      `/sync/trigger${courseId != null ? `?course_id=${courseId}` : ''}`,
    ),
  digest: () => get<{ generated_at: string; markdown: string; source: string }>('/digest/latest'),
  models: () => get<{ models: string[]; contexts?: Record<string, number>; error?: string }>('/chat/models'),
  // server-side chat sessions (the message tree lives in the DB)
  chatSessions: (courseId?: number) =>
    get<ChatServerSession[]>(`/chat/sessions${courseId != null ? `?course_id=${courseId}` : ''}`),
  chatSessionCreate: (courseId: number | null, title: string) =>
    post<ChatServerSession>('/chat/sessions', { course_id: courseId, title }),
  chatSessionGet: (id: number) => get<ChatServerSession>(`/chat/sessions/${id}`),
  chatSessionSave: (id: number, body: { title?: string; nodes: unknown[]; activeNodeId: string | null; updatedAt?: number }) =>
    put(`/chat/sessions/${id}`, body),
  chatSessionDelete: (id: number) => del(`/chat/sessions/${id}`),
}

export interface ChatServerSession {
  id: number
  courseId: number | null
  title: string
  updatedAt: string
  nodes?: unknown[]
  activeNodeId?: string | null
}

async function put(path: string, body: unknown): Promise<{ ok: boolean; id: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function del(path: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export async function streamChat(
  message: string,
  courseId: number | null,
  onEvent: (event: string, data: unknown) => void,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  model?: string,
  branch?: string,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message, course_id: courseId, history, model, branch }),
  })
  if (!res.ok || !res.body) throw new Error('Chat stream failed')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch (e) {
      console.error('[chat-stream] read failed:', e)
      throw e
    }
    const { done, value } = chunk
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // sse-starlette frames are CRLF-separated (\r\n\r\n) — a plain '\n\n'
    // split never matches, so normalize first.
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) dataLines.push(line.slice(5))
      }
      const data = dataLines.join('\n').trim()
      if (data) {
        try {
          onEvent(event, JSON.parse(data))
        } catch {
          onEvent(event, data)
        }
      }
    }
  }
}
