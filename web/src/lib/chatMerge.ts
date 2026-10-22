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

export interface MergeCitation {
	id?: number | string;
	fileId?: number | null;
}

export interface MergeNode {
	id: string;
	parentId?: string | null;
	children?: string[];
	role?: string;
	content?: string;
	streaming?: boolean;
	steps?: unknown;
	citations?: MergeCitation[];
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
		// Citations are derived metadata, not user content: the server's copy is
		// authoritative for where a chip points. A citation's file target can be
		// repaired server-side (a deck that gained a PDF now points at the PDF),
		// and a browser holding the old target would otherwise keep opening a file
		// that no longer matches the page number on the chip.
		if (Array.isArray(s.citations) && s.citations.length) {
			const byCiteId = new Map<string, MergeCitation>();
			for (const c of n.citations ?? []) byCiteId.set(String(c?.id), c);
			for (const c of s.citations) byCiteId.set(String(c?.id), c);
			(merged as MergeNode).citations = [...byCiteId.values()];
		}
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

/** Epoch seconds for a "YYYY-MM-DD HH:MM:SS" string, which is what the DB stores
 *  as a NAIVE UTC value (`datetime('now')`).
 *
 *  `Date.parse` has to treat a string with no offset as LOCAL time, which is wrong
 *  here: parsing these as local inflated every session timestamp by the UTC offset,
 *  and the delta sync compares the server's value against what the client last saw,
 *  so a phone could hold a stamp a day in the future and receive nothing back.
 *  Verified against the real database: session 194's `2026-10-22 04:35:38` parses to
 *  2026-10-22T04:35:38Z. */
export function serverTimeToEpochSeconds(s: string | null | undefined): number | null {
	if (!s) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(String(s));
	if (!m) return null;
	const [, y, mo, d, h, mi, se] = m;
	return Math.floor(
		Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) / 1000,
	);
}

/**
 * The `since` value to send when syncing the session list: the newest local change
 * minus a short overlap, in epoch seconds.
 *
 * Without it the server returns every session with its whole tree — ~27 MB once a
 * few long conversations exist. A phone cannot reliably pull that on a mobile
 * connection, so it would fall behind by days while the desktop stayed current.
 * The overlap covers a session the server stamped moments after our newest local
 * timestamp; skipping it would hide that turn until something newer arrived.
 */
export function sinceForSync(
	sessions: { updatedAt?: number }[],
	nowMs: number = Date.now(),
): number | undefined {
	let newest = 0;
	for (const s of sessions) {
		const t = s.updatedAt || 0;
		// Ignore future stamps: a stamp ahead of now would ask the server for
		// nothing, ever again.
		if (t > newest && t <= nowMs) newest = t;
	}
	if (!newest) return undefined;
	return Math.max(0, Math.floor(newest / 1000) - 300);
}
