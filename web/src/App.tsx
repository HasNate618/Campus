import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { TodayPage } from './pages/TodayPage'
import { CalendarPage } from './pages/CalendarPage'
import { SyncPage } from './pages/SyncPage'
import { DigestPage } from './pages/DigestPage'
import { CoursesPage } from './pages/CoursesPage'
import { CourseLayout, CourseHubPage } from './pages/CourseHubPage'
import { ContentPage } from './pages/ContentPage'
import { AssignmentsPage } from './pages/AssignmentsPage'
import { ChatPage } from './pages/ChatPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="digest" element={<DigestPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="courses/:courseId" element={<CourseLayout />}>
            <Route index element={<CourseHubPage />} />
            <Route path="content" element={<ContentPage />} />
            <Route path="content/:nodeId" element={<ContentPage />} />
            <Route path="assignments" element={<AssignmentsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
