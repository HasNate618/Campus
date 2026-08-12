import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell/AppShell'
import { ChatTabPage } from './pages/ChatTabPage'
import { TodayPage } from './pages/TodayPage'
import { CalendarPage } from './pages/CalendarPage'
import { SchedulePage } from './pages/SchedulePage'
import { SyncPage } from './pages/SyncPage'
import { MorePage } from './pages/MorePage'
import { CoursesPage } from './pages/CoursesPage'
import { CourseHubPage, CourseLayout } from './pages/CourseHubPage'
import { ContentPage } from './pages/ContentPage'
import { AssignmentsPage } from '@/pages/AssignmentsPage'
import { AssignmentDetailPage } from '@/pages/AssignmentDetailPage'
import { WorkspacePage } from '@/pages/WorkspacePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<TodayPage />} />
          <Route path="today" element={<Navigate to="/" replace />} />
          <Route path="chat" element={<ChatTabPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="digest" element={<Navigate to="/today" replace />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseLayout />}>
            <Route index element={<CourseHubPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route path="content/:nodeId" element={<ContentPage />} />
            <Route path="assignments" element={<AssignmentsPage />} />
            <Route path="assignments/:assignmentId" element={<AssignmentDetailPage />} />
            <Route path="workspace" element={<WorkspacePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
