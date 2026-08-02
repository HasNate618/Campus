import type {
  Announcement,
  Assignment,
  ContentNode,
  Course,
  CourseHub,
  Event,
  FileRecord,
  SyncRun,
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

export const api = {
  health: () => get<{ status: string; db: boolean }>('/health'),
  courses: (activeOnly = true) => get<Course[]>(`/courses?active_only=${activeOnly}`),
  course: (id: number) => get<Course>(`/courses/${id}`),
  courseHub: (id: number) => get<CourseHub>(`/courses/${id}/hub`),
  contentTree: (id: number) => get<{ nodes: ContentNode[]; files: FileRecord[] }>(`/courses/${id}/content-tree`),
  assignments: (id: number, upcoming = false) =>
    get<Assignment[]>(`/courses/${id}/assignments?upcoming=${upcoming}`),
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
  fileContent: (id: number) => get<{ content: string; format: string }>(`/files/${id}/content`),
  memoryCard: (courseId: number) => get<{ markdown: string }>(`/courses/${courseId}/memory`),
  syncStatus: () => get<{ status: string; last_run: SyncRun | null; token_valid?: boolean }>('/sync/status'),
  syncRuns: (limit = 20) => get<SyncRun[]>(`/sync/runs?limit=${limit}`),
  syncLog: (runId: number) => get<{ markdown: string }>(`/sync/runs/${runId}/log`),
  triggerSync: (courseId?: number) =>
    post<{ run_id: number; status: string; message: string }>(
      `/sync/trigger${courseId != null ? `?course_id=${courseId}` : ''}`,
    ),
  digest: () => get<{ generated_at: string; markdown: string; source: string }>('/digest/latest'),
}

export async function streamChat(
  message: string,
  courseId: number | null,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message, course_id: courseId, history: [] }),
  })
  if (!res.ok || !res.body) throw new Error('Chat stream failed')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      let event = 'message'
      let data = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data = line.slice(5).trim()
      }
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
