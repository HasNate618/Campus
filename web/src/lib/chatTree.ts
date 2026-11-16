/**
 * The conversation tree, as pure functions.
 *
 * One conversation is a tree: nodes carry a `parentId`, and a regenerated turn
 * hangs beside the one it replaced. `activeNodeId` names the node the reader is
 * looking at — the TIP of a branch, not the fork it starts at — and the visible
 * transcript is that node's ancestor chain.
 *
 * Every branch bug came from confusing those two: a fork child is a one-message
 * stub with the rest of the branch hanging BELOW it, so pointing the reader at
 * the fork child hides every later turn on that branch. These live outside the
 * provider so the rule can be tested without React.
 */

export interface TreeNode {
	id: string;
	parentId: string | null;
	children: string[];
	role: string;
	/** Mid-turn narration: hidden from the transcript and from branch chips. */
	intermediate?: boolean;
}

/** Path from the root to activeNodeId (the displayed conversation). */
export function pathFor<T extends TreeNode>(session: {
	nodes: T[];
	activeNodeId: string | null;
}): T[] {
	// Index once (O(nodes)) so walking the active path is O(depth) instead of
	// O(nodes × depth). This runs on every render — including every streamed
	// token — so the repeated find() was quadratic in long conversations.
	const byId = new Map(session.nodes.map((n) => [n.id, n]));
	const out: T[] = [];
	let cur = session.activeNodeId ? byId.get(session.activeNodeId) : undefined;
	const guard = new Set<string>();
	while (cur && !guard.has(cur.id)) {
		guard.add(cur.id);
		out.push(cur);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return out.reverse();
}

/** The deepest node reachable from `startId` — the tip of the branch it begins.
 *
 *  Switching branches must land on a tip. Pointing activeNodeId at the fork
 *  child itself truncates the conversation: the path only walks UP from the
 *  active node, so every turn below `startId` disappears from the screen while
 *  it is still in the tree (and the truncated pointer is saved, so a reload
 *  keeps the conversation shortened).
 *
 *  `prefer` is where the reader was last. When it lies inside this branch, they
 *  are returned exactly there instead of to the newest leaf — switching away
 *  and back should not lose your place.
 */
export function tipOf<T extends TreeNode>(
	nodes: T[],
	startId: string,
	prefer?: string | null,
): string {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const start = byId.get(startId);
	if (!start) return startId;
	if (prefer && prefer !== startId) {
		// Is `prefer` on the chain that runs from startId downward?
		let cur = byId.get(prefer);
		const guard = new Set<string>();
		while (cur && cur.id !== startId && !guard.has(cur.id)) {
			guard.add(cur.id);
			cur = cur.parentId ? byId.get(cur.parentId) : undefined;
		}
		if (cur?.id === startId) return prefer;
	}
	let cur = start;
	const seen = new Set<string>([cur.id]);
	for (;;) {
		// A tool node is an artifact of a turn, never a branch a reader picks:
		// a turn whose only child is a tool call is the end of its branch.
		const next = cur.children
			.map((id) => byId.get(id))
			.filter((k): k is T => k !== undefined && k.role !== "tool" && !seen.has(k.id))
			.at(-1);
		if (!next) return cur.id;
		seen.add(next.id);
		cur = next;
	}
}

/** Root-level branches: the nodes a conversation starts from.
 *
 *  Normally there is exactly one. Deleting the first message rejoins its
 *  children to the parent (null), so a forked conversation ends up with several
 *  roots — and chips only render under a parent, which would leave the other
 *  root unreachable with no way to switch back to it.
 */
export function rootBranches<T extends TreeNode>(nodes: T[]): T[] {
	return nodes.filter(
		(n) => !n.parentId && n.role !== "tool" && !n.intermediate,
	);
}
