import { useEffect, useMemo, useRef, useState } from "react";
import {
	MemoryRouter,
	Route,
	Routes,
	useLocation,
	useParams,
} from "react-router-dom";
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
 * per-tab MemoryRouter trees below. Single definition — add sections here.
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

/**
 * Keep-alive course tabs (element of `courses/:courseId`).
 *
 * Leaving a course for another course used to unmount its subtree —
 * iframe/PDF, scroll and selection all discarded. The keeper instead keeps
 * the last TAB_CAP visited courses mounted, showing only the active one:
 * switching back is a visibility toggle with zero reload. Beyond the cap
 * the least-recently-used course unmounts; its last deep route persists in
 * localStorage (lib/courseTabs) so re-entry restores it (with reload).
 *
 * Hiding MUST be visibility-preserving (see .keeper-tab-hidden): the PDF
 * lives in an iframe whose browsing context browsers may unload under
 * display:none — visibility:hidden keeps it alive. Hidden trees also get a
 * neutered keynav context (their handlers would otherwise swallow keys
 * meant for the visible tab — dispatch runs every registration in order)
 * and are aria-hidden with focus blurred out on deactivation.
 */
export function CourseKeeper() {
	const { courseId } = useParams();
	const activeCid = Number(courseId);
	const location = useLocation();
	const { setLastCourse } = useChat();
	const realNav = useKeyNav();
	const [tabs, setTabs] = useState<number[]>(() =>
		Number.isFinite(activeCid) ? [activeCid] : [],
	);
	// Frozen entry locations for hidden tabs (set at deactivation; the
	// hidden MemoryRouter trees never receive updates after that).
	const snaps = useRef<Record<number, string>>({});
	const wrapRefs = useRef<Record<number, HTMLDivElement | null>>({});
	const prevCid = useRef(activeCid);
	const locKey = location.pathname + location.search;

	// Track the active tab: touch LRU, snapshot its live location (state +
	// route memory), stamp the chat's last-course.
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

	if (!Number.isFinite(activeCid)) return null;
	return (
		<div className="keeper">
			{tabs.map((id) =>
				id === activeCid ? (
					<div
						key={id}
						className="keeper-tab"
						data-tab={id}
						ref={(el) => {
							wrapRefs.current[id] = el;
						}}
					>
						<CourseLayout key={id} />
					</div>
				) : (
					<div
						key={id}
						className="keeper-tab keeper-tab-hidden"
						aria-hidden="true"
						data-tab={id}
						ref={(el) => {
							wrapRefs.current[id] = el;
						}}
					>
						<KeyNavContext.Provider value={neutered}>
							<MemoryRouter
								key={snaps.current[id] ?? `/courses/${id}`}
								initialEntries={[snaps.current[id] ?? `/courses/${id}`]}
							>
								<Routes>
									<Route path="/courses/:courseId" element={<CourseLayout />}>
										{CourseNestedRoutes}
									</Route>
								</Routes>
							</MemoryRouter>
						</KeyNavContext.Provider>
					</div>
				),
			)}
		</div>
	);
}
