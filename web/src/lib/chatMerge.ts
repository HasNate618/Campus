/**
 * Two devices, one conversation — the client half.
 *
 * The server keeps message nodes as rows now, so a save can only add or update
 * the nodes it names (see api/chat_nodes.py). These helpers do the client side
 * of the same idea:
 *
 *  - `unionNodes` never lets one side's copy of the conversation replace the
 *    other's. Local keeps its richer nodes (steps, tokens, live flags) and the
 *    server contributes whatever this device has never seen, which is how two
 *    devices converge instead of overwriting each other.
 *  - `sessionSignature` lets the save loop skip sessions that did not change.
 *    It used to re-upload every session on every tick, which is how a phone
 *    with a stale copy rewrote chats it had not touched in days.
 *  - `capForCache` keeps the browser cache inside its quota. All sessions came
 *    to ~22 MB against a ~5 MB limit, so setItem threw, the catch swallowed it,
 *    and the cache silently froze at some old snapshot.
 */

export interface MergeNode {
	id: string;
	parentId?: string | null;
	children?: string[];
	role?: string;
	content?: string;
	streaming?: boolean;
	steps?: unknown;
}

export interface CacheSession {
	updatedAt?: number;
	nodes: MergeNode[];
}

/** Union of two copies of one conversation, keyed by node id. */
export function unionNodes<T extends MergeNode>(
	local: T[],
	server: MergeNode[],
): T[] {
	const byId = new Map<string, MergeNode>();
	for (const n of server) {
		if (n && typeof n.id === "string") byId.set(n.id, n);
	}
	const out: T[] = [];
	const seen = new Set<string>();
	for (const n of local) {
		if (!n || typeof n.id !== "string") continue;
		seen.add(n.id);
		const s = byId.get(n.id);
		if (!s) {
			out.push(n);
			continue;
		}
		const merged: T = { ...n };
		// Local keeps its richer copy (steps, tokens, live flags) — but not when
		// the server's is further along. An assistant message only ever GROWS
		// while it streams, so a longer server copy is the same turn finished by
		// the server after this browser lost the stream. For any other role a
		// longer local copy is an edit and keeps priority.
		const localLen = (n.content ?? "").length;
		const serverLen = (s.content ?? "").length;
		const serverMoreComplete =
			!n.streaming &&
			(n.role === "assistant"
				? serverLen > localLen
				: localLen === 0 && serverLen > 0);
		if (serverMoreComplete) {
			merged.content = s.content;
			if (s.steps && !n.steps) merged.steps = s.steps;
		}
		const kids = Array.isArray(n.children) ? [...n.children] : [];
		for (const k of Array.isArray(s.children) ? s.children : []) {
			if (!kids.includes(k)) kids.push(k);
		}
		if (kids.length || n.children) merged.children = kids;
		out.push(merged);
	}
	for (const [id, s] of byId) {
		if (!seen.has(id)) out.push(s as T);
	}
	return out;
}

/**
 * A cheap fingerprint of what a save would write. No JSON.stringify: this runs
 * on every change for every session, and the trees are megabytes.
 */
export function sessionSignature(s: {
	nodes: MergeNode[];
	title?: string;
	activeNodeId?: string | null;
	model?: string | null;
}): string {
	let chars = 0;
	for (const n of s.nodes) chars += n.content ? String(n.content).length : 0;
	return [
		s.nodes.length,
		chars,
		s.title ?? "",
		s.activeNodeId ?? "",
		s.model ?? "",
	].join("|");
}

/** Node ids present in `before` and gone from `after` — the explicit deletions. */
export function removedIds(before: Iterable<string>, after: Set<string>): string[] {
	const gone: string[] = [];
	for (const id of before) if (!after.has(id)) gone.push(id);
	return gone;
}

/**
 * Newest first, until the byte budget is spent. Anything left out simply comes
 * from the server on load, which is where it came from anyway.
 */
export function capForCache<T extends CacheSession>(
	sessions: T[],
	budget = 2_500_000,
): T[] {
	const sorted = [...sessions].sort(
		(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
	);
	const kept: T[] = [];
	let used = 0;
	for (const s of sorted) {
		let size = 0;
		try {
			size = JSON.stringify(s).length;
		} catch {
			continue; // unserializable session: not cacheable, not fatal
		}
		if (kept.length > 0 && used + size > budget) continue;
		kept.push(s);
		used += size;
		if (used > budget) break;
	}
	return kept;
}
