import { api } from "@/api/client";
import { useSWR } from "@/lib/useSWR";
import { ChatView } from "@/chat/ChatView";
import { useChat } from "@/chat/ChatContext";
import type { Course } from "@/types";

export function ChatTabPage() {
	// SWR-cached (shared 'courses' key with CoursesPage): without it every tab
	// revisit flashed the "No courses synced yet" empty state while refetching
	const [courses, loading] = useSWR<Course[]>(
		"courses",
		() => api.courses(),
		[],
	);
	const { lastCourseId, setLastCourse } = useChat();

	const course =
		courses.find((c) => c.id === lastCourseId) ?? courses[0] ?? null;

	if (!course) {
		return (
			<div className="page">
				<div className="page-col">
					<h1 className="page-title">Chat</h1>
					<div className="card">
						<div className="empty">
							{loading
								? "Loading…"
								: "No courses synced yet — run a sync, then chat with a course."}
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<ChatView
			courseId={course.id}
			course={course}
			courses={courses}
			onPickCourse={setLastCourse}
		/>
	);
}
