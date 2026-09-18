import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { CourseLayout, CourseHubPage } from "./CourseHubPage";
import { ContentPage } from "./ContentPage";
import { AssignmentsPage } from "@/pages/AssignmentsPage";
import { AssignmentDetailPage } from "@/pages/AssignmentDetailPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { useChat } from "@/chat/ChatContext";
import { KeyNavContext, useKeyNav } from "@/lib/keynav";
import { touchTab, writeLastRoute, TAB_CAP } from "@/lib/courseTabs";

/**
 * Nested course routes, shared by the browser tree (App.tsx) and the
 * hidden-tab frozen-location trees below. Single definition — add sections here.
 */
export const CourseNestedRoutes = (
	<>
		<Route index element={<CourseHubPage />} />
		<Route path="content" element={<ContentPage />} />
		<Route path="content/:nodeId" element={<ContentPage />} />
		<Route path="assignments" element={<AssignmentsPage />} />
		<Route path="assignments/:assignmentId" element={<AssignmentDetailPage />} />
		<Route path="workspace" element={<WorkspacePage />} />
	</>
);

/** Course id from a pathname (`/courses/6/content…` → 6, NaN elsewhere). */
function courseIdFromPath(pathname: string): number {
	const m = /^\/courses\/(\d+)/.exec(pathname);
	return m ? Number(m[1]) : NaN;
}

/**
 * Root-level keep-alive widget (rendered inside AppShell, under path `/`).
 *
 * The ACTIVE course renders exactly as before via the normal Outlet under
 * `courses/:courseId` — this component renders ONLY hidden replicas, one
 * per inactive visited course, so switching back is a visibility toggle
 * with zero reload (iframe/PDF, scroll and selection all survive).
 *
 * Placement is load-bearing. The previous design sat at `courses/:courseId`
 * and gave hidden tabs `<Routes location={snapshot}>`, which crashes by
 * React Router invariant whenever the snapshot leaves the parent match:
 * parent base is the LIVE course (`/courses/5`) while a hidden snapshot is
 * another course (`/courses/6/content`) — "pathname must begin with the
 * portion matched by all parent routes". Here the parent chain is
 * BrowserRouter → Routes → Route `/` → AppShell → keeper, so the parent
 * base is `/`, which prefixes EVERY snapshot. That is what makes the
 * override legal.
 *
 * Hooks inside hidden replicas resolve from the snapshot: useParams comes
 * from the matched `courses/:courseId` branch (the snapshot's course),
 * while useNavigate stays the outer BrowserRouter's (hidden trees can't be
 * interacted with — visibility-hidden, pointer-events:none, aria-hidden,
 * blurred focus, neutered keys — so they never navigate). useLocation in a
 * hidden tree reads the LIVE url (outer context); course components key on
 * params, so this is inert in practice — noted, not solved.
 *
 * Hiding MUST be visibility-preserving (see .keeper-tab-hidden): the PDF
 * lives in an iframe whose browsing context browsers may unload under
 * display:none — visibility:hidden keeps it alive.
 */
export function CourseKeeper() {
	const location = useLocation();
	const { setLastCourse } = useChat();
	const realNav = useKeyNav();
	const activeCid = courseIdFromPath(location.pathname);
	const locKey = location.pathname + location.search;
	const [tabs, setTabs] = useState<number[]>(() =>
		Number.isFinite(activeCid) ? [activeCid] : [],
	);
	// Frozen entry locations for hidden tabs (set at deactivation; hidden
	// trees match this snapshot via the Routes `location` prop — no nested
	// Router (React Router forbids <Router> inside <Router>: blank screen).
	// The single top-level BrowserRouter stays the only Router provider.
	const snaps = useRef<Record<number, string>>({});
	const wrapRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const prevCid = useRef(activeCid);

	// Track the active tab: touch LRU, snapshot its live location (state +
	// route memory), stamp the chat's last-course. Skipped off-course so
	// visiting Home never evicts or overwrites a tab's snapshot.
	useEffect(() => {
		if (!Number.isFinite(activeCid)) return;
		snaps.current[activeCid] = locKey;
		writeLastRoute(activeCid, locKey);
		setTabs((t) => touchTab(t, activeCid, TAB_CAP));
		setLastCourse(activeCid);
	}, [activeCid, locKey, setLastCourse]);

	// Deactivation: blur focus out of the outgoing tab so hidden content
	// (e.g. a focused PDF iframe) can't keep keyboard focus invisibly.
	useEffect(() => {
		if (prevCid.current !== activeCid) {
			const el = wrapRefs.current[prevCid.current];
			if (el?.contains(document.activeElement)) {
				(document.activeElement as HTMLElement).blur();
			}
			prevCid.current = activeCid;
		}
	}, [activeCid]);

	const neutered = useMemo(
		() => ({ ...realNav, register: () => () => {} }),
		[realNav],
	);

	if (tabs.length === 0) return null;
	return (
		<div className="keeper" aria-hidden="true">
			{tabs
				.filter((id) => id !== activeCid)
				.map((id) => (
					<div
						key={id}
						className="keeper-tab keeper-tab-hidden"
						data-tab={id}
						ref={(el) => {
							wrapRefs.current[id] = el;
						}}
					>
						<KeyNavContext.Provider value={neutered}>
							<Routes
								location={snaps.current[id] ?? `/courses/${id}`}
							>
								<Route path="courses/:courseId" element={<CourseLayout />}>
									{CourseNestedRoutes}
								</Route>
							</Routes>
						</KeyNavContext.Provider>
					</div>
				))}
		</div>
	);
}
