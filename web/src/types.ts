export interface Course {
  id: number
  code: string
  name: string
  term: string
  instructor?: string | null
  color?: string | null
  is_pilot?: number
  is_active?: number
  file_count?: number
  assignment_count?: number
  last_sync_at?: string | null
}

export interface Announcement {
  id: number
  course_id: number
  course_code?: string
  title: string
  body?: string | null
  author?: string | null
  posted_at?: string | null
}

export interface Assignment {
  id: number
  course_id: number
  title: string
  description?: string | null
  due_at?: string | null
  weight?: number | null
  status: string
  url?: string | null
  rubrics?: Rubric[]
  category?: string | null
  group_category?: string | null
  points?: number | null
  attachments?: { FileId: number; FileName: string; Size: number }[] | null
  availability?: { StartDate?: string; EndDate?: string } | null
  notes?: string | null
}

export interface RubricLevel {
  Id: number
  Name: string
  Points?: number
}

export interface RubricCell {
  Feedback?: { Text?: string; Html?: string }
  Description?: { Text?: string; Html?: string }
}

export interface RubricCriterion {
  Id: number
  Name: string
  Cells?: RubricCell[]
}

export interface RubricGroup {
  Name?: string
  Levels?: RubricLevel[]
  Criteria?: RubricCriterion[]
}

export interface Rubric {
  RubricId: number
  Name: string
  ScoringMethod?: number
  CriteriaGroups?: RubricGroup[]
}

export interface ContentNode {
  id: number
  course_id: number
  parent_id: number | null
  node_type: 'module' | 'topic'
  topic_type?: string | null
  title: string
  /** Modules carry Brightspace landing-page HTML; link topics carry the external URL. */
  description?: string | null
  url?: string | null
  sort_order: number
  is_hidden?: number
  is_locked?: number
}

export type FileFormat = 'markdown' | 'html' | 'code' | 'pdf' | 'download'

export interface FileContent {
  content: string
  format: FileFormat
  rawUrl: string | null
}

export interface FileRecord {
  id: number
  course_id: number
  content_node_id?: number | null
  path: string
  kind: string
  processed: number
}

export interface Event {
  id: number
  course_id?: number | null
  course_code?: string
  kind: string
  title: string
  starts_at: string
  ends_at?: string | null
  notes?: string | null
}

export interface SyncRun {
  id: number
  started_at: string
  finished_at?: string | null
  status: string
  trigger: string
  courses_processed: number
  files_new: number
  files_changed: number
  announcements_new: number
  facts_added: number
  log_path?: string | null
  error?: string | null
}

export interface CourseHub {
  course: Course
  announcements: Announcement[]
  events: Event[]
  assignments_upcoming: Assignment[]
  memory_facts: { id: number; fact: string; category: string }[]
  recent_files: FileRecord[]
  stats: { file_count: number; assignment_count: number; processed_files: number }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool?: string
  toolResult?: string
}
