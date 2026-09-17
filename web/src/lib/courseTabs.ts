/**
 * Keep-alive course tabs + route-memory fallback.
 *
 * Course IDs restart nothing — but React Router unmounts a course subtree
 * the moment you navigate to another course, discarding iframe/PDF, scroll
 * and selection state. CourseKeeper (pages/CourseKeeper.tsx) keeps the last
 * few visited courses mounted-but-hidden so switching back is instant; this
 * module holds the framework-free pieces: the LRU tab list and the
 * localStorage route memory used when a course has no live tab (evicted or
 * never visited) or when the keeper itself remounts (e.g. coming from Home).
 */

/** Max live (mounted) course tabs — each holds a PDF.js iframe. */
export const TAB_CAP = 3;

/** localStorage key for a course's last deep route. */
export function routeKey(cid: number): string {
	return `ct.lastRoute.${cid}`;
}

/**
 * MRU-first tab list with dedup + cap. Pure — safe to unit-test.
 * touchTab([10, 11], 11) === [11, 10]; touchTab([10,11,12], 13) evicts 10.
 */
export function touchTab(tabs: number[], cid: number, cap = TAB_CAP): number[] {
	const rest = tabs.filter((t) => t !== cid);
	return [cid, ...rest].slice(0, Math.max(1, cap));
}

/** Is `path` a plausible in-course route for `cid`? Guards hand-edited storage. */
export function validCourseRoute(cid: number, path: string): boolean {
	if (!path || path.length > 500) return false;
	return path === `/courses/${cid}` || path.startsWith(`/courses/${cid}/`);
}

/** Last deep route (path + query) for a course, or null. Never throws. */
export function readLastRoute(cid: number): string | null {
	try {
		const v = localStorage.getItem(routeKey(cid));
		return v && validCourseRoute(cid, v) ? v : null;
	} catch {
		return null;
	}
}

/** Persist last deep route. Never throws (private-mode quota, etc.). */
export function writeLastRoute(cid: number, path: string): void {
	if (!validCourseRoute(cid, path)) return;
	try {
		localStorage.setItem(routeKey(cid), path);
	} catch {
		// storage unavailable — keep-alive still works for this session
	}
}

/** Entry route for activating a course: remembered deep link or hub. */
export function entryRoute(cid: number): string {
	return readLastRoute(cid) ?? `/courses/${cid}`;
}
