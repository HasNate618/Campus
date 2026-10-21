import { useOutletContext } from "react-router-dom";
import { api } from "@/api/client";
import { useSWR } from "@/lib/useSWR";
import { ChatView } from "@/chat/ChatView";
import { useChat } from "@/chat/ChatContext";
import type { Course } from "@/types";

export function ChatTabPage() {
	// Set at boot from /api/health. Undefined (older server, or the probe
	// failed) means "assume configured" so the panel behaves as it always did.
	const boot = useOutletContext<{ chatReady?: boolean } | undefined>();
	const chatReady = boot?.chatReady !== false;

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

	// No endpoint means the first message would fail in the network layer with
	// nothing useful on screen. Say what is missing and what still works.
	if (!chatReady) {
		return (
			<div className="page">
				<div className="page-col">
					<h1 className="page-title">Chat</h1>
					<div className="card">
						<div className="empty">
							Chat needs an OpenAI-compatible endpoint with tool
							calling. Set <code>OPENAI_ENDPOINT</code> and{" "}
							<code>OPENAI_MODEL</code> in{" "}
							<code>docker-compose.yml</code> (plus{" "}
							<code>OPENAI_API_KEY</code> if your endpoint needs one),
							or <code>llm_url</code> and <code>llm_model</code> in{" "}
							<code>config.yaml</code>, then reload. Browsing, search,
							citations on search results, and the timetable work without
							one.
						</div>
					</div>
				</div>
			</div>
		);
	}

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
