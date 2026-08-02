import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { ChatView } from '@/chat/ChatView'
import { useChat } from '@/chat/ChatContext'
import type { Course } from '@/types'

export function ChatTabPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const { lastCourseId, setLastCourse } = useChat()

  useEffect(() => {
    api.courses().then(setCourses).catch(console.error)
  }, [])

  const course = courses.find((c) => c.id === lastCourseId) ?? courses[0] ?? null

  if (!course) {
    return (
      <div className="page">
        <div className="page-col">
          <h1 className="page-title">Chat</h1>
          <div className="card">
            <div className="empty">No courses synced yet — run a sync, then chat with a course.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ChatView
      courseId={course.id}
      course={course}
      courses={courses}
      onPickCourse={setLastCourse}
    />
  )
}
