import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, CalendarDays, Home, MessageSquare } from "lucide-react";
import { ChatProvider } from "@/chat/ChatContext";
import { KeyNavProvider } from "@/lib/keynav";
import { Sidebar } from "./Sidebar";
import { CourseKeeper } from "@/pages/CourseKeeper";

const MOBILE_TABS = [
	{ to: "/", label: "Home", icon: Home, end: true },
	{ to: "/chat", label: "Chat", icon: MessageSquare, end: true },
	{ to: "/courses", label: "Courses", icon: BookOpen, end: false },
	{ to: "/schedule", label: "Schedule", icon: CalendarDays, end: true },
];

function ShellInner({ onLogout }: { onLogout: () => void }) {
	const location = useLocation();
	// Animate TOP-LEVEL navigation only: slice(0,2) keeps '/courses' stable
	// across course switches — REQUIRED for keep-alive tabs (CourseKeeper):
	// remounting this wrapper would unmount every live tab (iframes/PDFs
	// reloaded, defeating instant return). Course switches are now an
	// instant visibility toggle by design; entering/leaving the courses
	// area still animates. (CourseHubPage animates its own content pane
	// for in-course section switches, so header/tabs never replay.)
	const transitionKey = location.pathname.split("/").slice(0, 2).join("/");

	return (
		<ChatProvider>
			<div className="shell">
				<Sidebar onLogout={onLogout} />
				<main className="main" data-kbd-zone="course">
					{/* Keyed remount → exactly ONE entrance animation per navigation.
              Deliberately no AnimatePresence/exit animation: exit + enter
              back-to-back read as the slide-in playing twice (and course
              pages used to stack a second animated wrapper on top). */}
					<motion.div
						key={transitionKey}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.16 }}
						style={{
							flex: 1,
							display: "flex",
							flexDirection: "column",
							minHeight: 0,
						}}
					>
						<Outlet />
					</motion.div>
				</main>

				{/* Keep-alive course tabs: hidden replicas of inactive visited
					courses. MUST sit outside the keyed motion.div above — that
					wrapper remounts on top-level navigation, which would unmount
					every live tab (iframes/PDFs reloaded, defeating instant return).
					See CourseKeeper for the placement invariant. */}
				<CourseKeeper />

				<nav className="tabbar">
					{MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
						<NavLink
							key={to}
							to={to}
							end={end}
							className={({ isActive }) =>
								`tabbar-tab${isActive ? " active" : ""}`
							}
						>
							<Icon size={19} />
							{label}
						</NavLink>
					))}
				</nav>
			</div>
		</ChatProvider>
	);
}

export function AppShell({ onLogout }: { onLogout: () => void }) {
	return (
		<KeyNavProvider>
			<ShellInner onLogout={onLogout} />
		</KeyNavProvider>
	);
}
