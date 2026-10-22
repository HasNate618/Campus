import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	streamChat,
	api,
	type ChatAttachment,
	type ChatServerSession,
} from "@/api/client";
import type { ViewContext } from "@/types";
import {
	capForCache,
	removedIds,
	sessionSignature,
	sinceForSync,
	unionNodes,
} from "@/lib/chatMerge";

/** Chat message tree (Open WebUI-style): a flat node store linked by
 *  parentId/children. The visible conversation is the path from the root
 *  node to activeNodeId. Regenerating an assistant message forks the tree
 *  (new sibling); editing a user message rewinds (subtree deleted, re-sent).
 */
/** One step of an assistant turn, in canonical order: each contiguous
 *  reasoning run is a thought step; visible narration the model speaks
 *  between tool batches ("I'll check the assignments first") is a narration
 *  step; each tool call is a tool step. The final response content lives on
 *  the node itself, not in steps. */
export interface StepItem {
	kind: "thought" | "narration" | "tool";
	/** thought/narration: accumulated text for this segment */
	text?: string;
	/** tool: the tool name */
	tool?: string;
	args?: unknown;
	done?: boolean;
	result?: unknown;
}

export interface Citation {
	id: number;
	ref: string;
	label: string;
	excerpt?: string;
	page?: number | null;
	line?: number | null;
	courseId?: number | null;
	fileId?: number | null;
	nodeId?: number | null;
	kind?: string;
}

export interface MsgNode {
	id: string;
	parentId: string | null;
	children: string[];
	role: "user" | "assistant" | "tool";
	content: string;
	streaming?: boolean;
	thinking?: string;
	thinkingDone?: boolean;
	/** Mid-turn narration hidden from the UI + branch chips. */
	intermediate?: boolean;
	/** Ordered thought/tool steps of this turn (absent on pre-steps chats). */
	steps?: StepItem[];
	model?: string;
	tokens?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	tool?: string;
	args?: unknown;
	result?: unknown;
	done?: boolean;
	open?: boolean;
	attachments?: ChatAttachment[];
	citations?: Citation[];
	createdAt: number;
}

export interface ChatSession {
	id: string;
	/** Server row id once persisted (the client id NEVER changes — the stream
	 *  callbacks target it, so an id swap mid-stream would silently drop
	 *  every event that arrives after the swap). */
	serverId?: number;
	courseId: number;
	title: string;
	/** Per-session LLM model. NULL/undefined = inherit the current selection
	 *  (the model the user last picked). Stamped on first send. */
	model?: string | null;
	createdAt: number;
	updatedAt: number;
	nodes: MsgNode[];
	activeNodeId: string | null;
}

export type ChatMsg = MsgNode;

export interface ChatSessionV2 {
	id: string;
	courseId: number;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: {
		role: "user" | "assistant" | "tool";
		content: string;
		streaming?: boolean;
		thinking?: string;
		thinkingDone?: boolean;
		intermediate?: boolean;
		tool?: string;
		args?: unknown;
		result?: unknown;
		done?: boolean;
		open?: boolean;
	}[];
}

interface ChatContextValue {
	sessions: ChatSession[];
	busy: boolean;
	lastCourseId: number | null;
	model: string | null;
	setModel: (m: string | null) => void;
	models: string[];
	contexts: Record<string, number>;
	pinned: string[];
	setPinned: (p: string[]) => void;
	setLastCourse: (c: number) => void;
	/** The content pages announce what the user is looking at, so a deictic
	 *  question ("explain this") can resolve to it. */
	publishView: (view: ViewContext) => void;
	sessionsFor: (courseId: number) => ChatSession[];
	activeFor: (courseId: number) => ChatSession | null;
	/** True once the server session list has loaded (or failed). Until then the
	 *  local cache is incomplete and callers should not guess. */
	serverReady: boolean;
	openSession: (courseId: number, sessionId: string) => void;
	setSessionModel: (sessionId: string, model: string | null) => void;
	newChat: (courseId: number) => void;
	renameSession: (sessionId: string, title: string) => void;
	deleteSession: (sessionId: string) => void;
	send: (
		courseId: number,
		text: string,
		attachments?: ChatAttachment[],
	) => boolean;
	/**
	 * Send typed text into the turn that is already running instead of starting
	 * a new one. Returns false when there is nothing to steer into.
	 */
	steer: (text: string) => boolean;
	/** What has been steered into the current turn, for the composer to show. */
	steers: { text: string; delivered: boolean }[];
	stop: () => void;
	regenerate: (sessionId: string, nodeId: string) => void;
	editMessage: (sessionId: string, nodeId: string, newText: string) => void;
	deleteMessage: (sessionId: string, nodeId: string) => void;
	setActiveBranch: (sessionId: string, nodeId: string) => void;
}

const STORAGE_KEY = "hc.chat.sessions.v3";
const V2_KEY = "hc.chat.sessions.v2";
const ACTIVE_KEY = "hc.chat.active";
const LAST_COURSE_KEY = "hc.chat.lastCourse";
const MODEL_KEY = "hc.chat.model";
const MAX_SESSIONS = 50;

function makeUuid(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID)
		return crypto.randomUUID();
	// secure-context-only; plain-HTTP LAN hosts skip SW registration
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
	});
}

function makeSession(courseId: number): ChatSession {
	const id = makeUuid();
	return {
		id,
		courseId,
		title: "New chat",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		nodes: [],
		activeNodeId: null,
	};
}

/** Path from the root to activeNodeId (the displayed conversation). */
export function pathFor(session: ChatSession): MsgNode[] {
	// Index once (O(nodes)) so walking the active path is O(depth) instead of
	// O(nodes × depth). This runs on every render — including every streamed
	// token — so the repeated find() was quadratic in long conversations.
	const byId = new Map(session.nodes.map((n) => [n.id, n]));
	const out: MsgNode[] = [];
	let cur = session.activeNodeId ? byId.get(session.activeNodeId) : undefined;
	const guard = new Set<string>();
	while (cur && !guard.has(cur.id)) {
		guard.add(cur.id);
		out.push(cur);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return out.reverse();
}

/**
 * Resolve the model to use for a turn. Preference order:
 *   1. the session's own stored model (stamped on first send),
 *   2. the currently-selected model in the picker,
 *   3. the first model the provider currently offers.
 * If the chosen model is no longer in the live list (removed/renamed by the
 * provider), fall back to the first available so we never 402.
 */
export function resolveTurnModel(
	session: ChatSession,
	selectedModel: string | null,
	live: string[],
): string | null {
	let effective = session.model || selectedModel || (live[0] ?? null);
	if (effective && live.length && !live.includes(effective)) {
		effective = live[0] ?? null;
	}
	return effective;
}

function migrateV2(raw: ChatSessionV2[]): ChatSession[] {
	return raw.map((s) => {
		const nodes: MsgNode[] = [];
		let lastUserOrAssistant: string | null = null;
		let lastAssistant: string | null = null;
		for (const m of s.messages) {
			const id = makeUuid();
			if (m.role === "user") {
				nodes.push({
					id,
					parentId: lastUserOrAssistant,
					children: [],
					role: "user",
					content: m.content,
					createdAt: Date.now(),
				});
				lastUserOrAssistant = id;
			} else if (m.role === "assistant") {
				nodes.push({
					id,
					parentId: lastUserOrAssistant,
					children: [],
					role: "assistant",
					content: m.content,
					thinking: m.thinking,
					thinkingDone: m.thinkingDone,
					intermediate: m.intermediate,
					createdAt: Date.now(),
				});
				lastUserOrAssistant = id;
				lastAssistant = id;
			} else if (m.role === "tool" && lastAssistant) {
				nodes.push({
					id,
					parentId: lastAssistant,
					children: [],
					role: "tool",
					content: "",
					tool: m.tool,
					args: m.args,
					result: m.result,
					done: m.done,
					open: m.open,
					createdAt: Date.now(),
				});
				const a = nodes.find((n) => n.id === lastAssistant);
				if (a) a.children.push(id);
			}
		}
		return {
			...s,
			nodes,
			activeNodeId: lastUserOrAssistant ?? null,
		};
	});
}

/** Zombie nodes are assistant messages whose stream died mid-turn (page
 *  reload/close before done) — they were persisted as 'Thinking…' forever.
 *  Normalize them so a reloaded chat never shows a spinner that never ends.
 *  A PARTIAL answer is flagged too: previously only an empty one got the
 *  warning, so a half-streamed reply was silently presented as complete. */
function normalizeZombies(s: ChatSession): ChatSession {
	let changed = false;
	const nodes = s.nodes.map((n) => {
		if (n.role !== "assistant") return n;
		if (n.streaming || (n.thinking && !n.thinkingDone)) {
			changed = true;
			const mark =
				"⚠ The response was interrupted before it finished — the page was " +
				"reloaded or closed mid-turn, so the stream never completed.";
			return {
				...n,
				streaming: false,
				thinkingDone: true,
				intermediate: false,
				content: n.content
					? `${n.content}\n\n---\n_${mark} The answer above is incomplete._`
					: `${mark} Try again.`,
			};
		}
		return n;
	});
	return changed ? { ...s, nodes } : s;
}

/** Clamp timestamps that were inflated into the future while the UTC-parse bug
 *  compounded (+one UTC offset per load/save round trip). Without this, cached
 *  sessions keep reading as "just now" on every load; the next save then writes
 *  the corrected value back to the server. */
function clampTimes(s: ChatSession): ChatSession {
	const now = Date.now();
	if (s.updatedAt <= now && s.createdAt <= now) return s;
	return {
		...s,
		updatedAt: Math.min(s.updatedAt, now),
		createdAt: Math.min(s.createdAt, now),
	};
}

function loadSessions(): ChatSession[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			return (JSON.parse(raw) as ChatSession[])
				.filter((s) => s.nodes.some((n) => n.role !== "tool"))
				.map(clampTimes)
				.map(normalizeZombies);
		}
		const v2 = localStorage.getItem(V2_KEY);
		if (v2) {
			const migrated = migrateV2(JSON.parse(v2) as ChatSessionV2[]);
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(migrated.map(stripUiFlags)),
			);
			return migrated.map(normalizeZombies);
		}
	} catch {
		/* ignore corrupt storage */
	}
	return [];
}

function stripUiFlags(s: ChatSession): ChatSession {
	return {
		...s,
		nodes: s.nodes.map(({ streaming: _s, open: _o, ...rest }) => rest),
	};
}

function persist(sessions: ChatSession[]): void {
	try {
		// only sessions with actual messages survive — 'New chat' drafts are
		// in-memory only and vanish on reload
		const real = sessions.filter((s) => s.nodes.some((n) => n.role !== "tool"));
		// Capped: all 86 sessions came to ~22 MB against a ~5 MB origin limit,
		// so setItem threw and the catch below swallowed it — the cache froze at
		// whatever snapshot last fit. Newest sessions are kept; the rest come
		// from the server on load anyway.
		const capped = capForCache(real.map(stripUiFlags));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
	} catch {
		/* quota — keep in-memory */
	}
}

/** Collect a node's id + all descendant ids. */
function collectSubtree(nodes: MsgNode[], rootId: string): Set<string> {
	const out = new Set<string>([rootId]);
	const queue: (string | undefined)[] = [rootId];
	while (queue.length) {
		const cur = nodes.find((n) => n.id === queue.shift());
		for (const c of cur?.children ?? []) {
			if (!out.has(c)) {
				out.add(c);
				queue.push(c);
			}
		}
	}
	return out;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
	const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
	const [activeMap, setActiveMap] = useState<Record<number, string>>(() => {
		try {
			return JSON.parse(localStorage.getItem(ACTIVE_KEY) || "{}") as Record<
				number,
				string
			>;
		} catch {
			return {};
		}
	});
	const [busy, setBusy] = useState(false);
	// Messages steered into the running turn. `delivered` flips when the server
	// echoes the steering event back, which means the model has actually read it.
	const [steers, setSteers] = useState<{ text: string; delivered: boolean }[]>([]);
	// Server id of the turn currently streaming: a steer has to reach that exact
	// conversation, and it is the only handle the server needs.
	const liveTurnServerId = useRef<number | null>(null);
	const [lastCourseId, setLastCourseId] = useState<number | null>(() => {
		try {
			const v = Number(localStorage.getItem(LAST_COURSE_KEY));
			return Number.isFinite(v) && v > 0 ? v : null;
		} catch {
			return null;
		}
	});
	const [model, setModelState] = useState<string | null>(() => {
		try {
			return localStorage.getItem(MODEL_KEY);
		} catch {
			return null;
		}
	});
	const [pinned, setPinnedState] = useState<string[]>([]);
	// Load pinned models from the server (cross-device) once on mount.
	useEffect(() => {
		api
			.chatPinnedGet()
			.then((d) => {
				if (d?.pinned?.length) setPinnedState(d.pinned);
			})
			.catch(() => {});
	}, []);
	// Live model list (for validation: a session's stored model may have been
	// removed from the provider — fall back to the first available before send).
	const [models, setModels] = useState<string[]>([]);
	const [contexts, setContexts] = useState<Record<string, number>>({});
	const modelsRef = useRef<string[]>([]);
	modelsRef.current = models;
	const modelRef = useRef<string | null>(model);
	modelRef.current = model;
	useEffect(() => {
		api
			.models()
			.then((d) => {
				if (d.models?.length) {
					setModels(d.models);
					if (d.contexts) setContexts(d.contexts);
					const cur = localStorage.getItem(MODEL_KEY);
					if (cur && !d.models.includes(cur)) {
						// selected model removed → reseed to first available (not null)
						setModelState(d.models[0] ?? null);
					} else if (!cur) {
						// Initial state: nothing selected yet → pick first available
						setModelState(d.models[0]);
					}
				} else if (d.contexts) {
					setContexts(d.contexts);
				}
			})
			.catch(() => {});
	}, []);
	const busyRef = useRef(false);
	// What the user has open, keyed by course. A ref, not state: this is
	// written on scroll and must never re-render the chat tree. It lives in
	// the provider — above the routes — because the content pane UNMOUNTS when
	// the chat goes fullscreen, which is exactly when "explain this" gets
	// asked. Keying by course means a hidden course tab (CourseKeeper keeps
	// them mounted) writes only its own slot and can never claim another
	// course's view.
	const viewRef = useRef<Map<number, ViewContext>>(new Map());
	// abort handle for the in-flight turn — stop() trips it
	const turnAbortRef = useRef<AbortController | null>(null);
	const serverReadyRef = useRef(false);
	// State twin of the ref: activeFor must RE-RENDER once the server list has
	// landed, so it can stop withholding the fallback.
	const [serverReady, setServerReady] = useState(false);
	const savingRef = useRef(false);
	const saveTimer = useRef<number | null>(null);
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;

	/** Parse a server datetime.
	 *
	 * The server stores `datetime('now')` — UTC with NO timezone suffix, e.g.
	 * "2026-09-24 22:39:42". `new Date("2026-09-24T22:39:42")` is read as
	 * LOCAL time, so this added a whole UTC offset (4h in Toronto) of error.
	 * Worse, the client sends the same value back in the next save and the
	 * server stores it verbatim, so the error COMPOUNDED on every load/save
	 * cycle — timestamps marched into the future until every session read as
	 * "just now" (and sidebar ordering by time became meaningless). Treat a
	 * suffix-less value as UTC, and clamp anything still in the future so
	 * already-inflated values heal instead of persisting. */
	function parseServerTime(s: string | null | undefined): number {
		if (!s) return NaN;
		const iso = String(s).replace(" ", "T");
		const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
		const t = Date.parse(zoned);
		if (!Number.isFinite(t)) return NaN;
		return Math.min(t, Date.now());
	}

	/** Stable client id for a server-backed session.
	 *
	 * Must be DERIVED from the server id, not minted fresh. The active-session
	 * map (`activeMap`, persisted per course in localStorage) stores these ids,
	 * and a fresh uuid on every load never matched what was saved — so a reload
	 * lost your place and fell through to "most recently updated", which is how
	 * it reopened a DIFFERENT chat than the one you were reading. Deterministic
	 * here means a reload resolves to the same session.
	 *
	 * Deliberately not all-digits: mergeServerSessions treats a purely numeric
	 * client id as a legacy uuid→server-id leftover and replaces it. */
	const serverClientId = (serverId: number) => `server-${serverId}`;

	function toLocalSession(srv: ChatServerSession): ChatSession {
		const ts = parseServerTime(srv.updatedAt);
		return normalizeZombies({
			id: serverClientId(srv.id),
			serverId: srv.id,
			courseId: srv.courseId ?? 0,
			title: srv.title,
			model: srv.model ?? null,
			createdAt: Number.isFinite(ts) ? ts : Date.now(),
			updatedAt: Number.isFinite(ts) ? ts : Date.now(),
			nodes: (srv.nodes ?? []) as MsgNode[],
			activeNodeId: srv.activeNodeId ?? null,
		});
	}

	// Merge server sessions into local state. Nodes are UNIONED by id, so a
	// conversation never loses a turn to whichever device synced last; unknown
	// server sessions are adopted; client uuids stay stable; per-session title
	// and time follow the newer side, while the open branch stays local (it is
	// this device's UI state).
	// Keyed by SERVER id. The old code matched `byId.get(local.id)`
	// against these keys — local.id is a client uuid, never equal to a
	// numeric server id — so NO local session ever matched, and every
	// server session got appended as a fresh duplicate on EVERY reload.
	function mergeServerSessions(
		prev: ChatSession[],
		list: ChatServerSession[],
	): ChatSession[] {
		const byId = new Map(list.map((s) => [String(s.id), s]));
		const merged = prev.map((local) => {
			const key = local.serverId != null ? String(local.serverId) : local.id;
			const srv = byId.get(key);
			if (!srv) return local;
			byId.delete(key);
			// Never replace a session with a live stream in flight — its
			// streaming tree is newer than anything the server has.
			// (Belt-and-braces alongside the busyRef skip in the refetch
			// trigger: busyRef covers whole-turn streaming; this covers a
			// node still flagged streaming after the turn flag drops.)
			if (local.nodes.some((n) => n.streaming)) return local;
			const refreshed = toLocalSession(srv);
			// UNION, not a winner. This used to pick one whole copy — newer
			// timestamp first, then the node-count heuristic — so whichever
			// device looked newer replaced the other's tree and its turns
			// vanished from that screen. Each side now contributes the nodes
			// the other has never seen, so the two converge instead of fight.
			const serverNewer =
				(refreshed.updatedAt || 0) > (local.updatedAt || 0);
			// Keep a real client uuid stable (activeMap + in-flight streams
			// target it); reconcile numeric-id leftovers from the old
			// uuid→server-id promotion to a fresh uuid + serverId.
			const id = /^[0-9]+$/.test(local.id) ? makeUuid() : local.id;
			return {
				...local,
				id,
				title: serverNewer ? refreshed.title || local.title : local.title,
				model: local.model ?? refreshed.model ?? null,
				createdAt: local.createdAt || refreshed.createdAt,
				updatedAt: Math.max(local.updatedAt || 0, refreshed.updatedAt || 0),
				nodes: unionNodes(local.nodes, refreshed.nodes),
				// The open branch is this device's UI state: never adopt the
				// other device's and jump the reader somewhere else.
				activeNodeId: local.activeNodeId ?? refreshed.activeNodeId ?? null,
			};
		});
		for (const srv of byId.values()) merged.push(toLocalSession(srv));
		return merged;
	}

	// Load server-side sessions once on mount (source of truth; localStorage is
	// only an offline cache now).
	useEffect(() => {
		let cancelled = false;
		api
			// NO `since` here. The localStorage mirror is capped by size, so a reload
			// restores only the newest conversations; this request is the only thing
			// that brings the rest back. Asking for a delta on mount made every chat
			// that had been evicted from the cache vanish from the list.
			.chatSessions()
			.then((list) => {
				if (cancelled) return;
				setSessions((prev) => mergeServerSessions(prev, list));
			})
			.catch((e) => {
				console.error("[chat-sync] load failed:", e);
			})
			.finally(() => {
				if (!cancelled) {
					serverReadyRef.current = true;
					setServerReady(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const refetchInFlight = useRef(false);
	const lastRefetchRef = useRef(0);

	// Cross-device refetch: server sessions otherwise load once on mount, so
	// progress made on another device is invisible until full page reload
	// (and the local debounced save can PUT a stale tree over newer server
	// work). Re-merge on return to the tab, throttled and never mid-stream.
	// Background refresh: failures log only, never a user-facing banner.
	useEffect(() => {
		const maybeRefetch = () => {
			if (document.hidden) return;
			if (!serverReadyRef.current) return;
			if (busyRef.current) return;
			if (refetchInFlight.current) return;
			if (Date.now() - lastRefetchRef.current < 30_000) return;
			lastRefetchRef.current = Date.now();
			refetchInFlight.current = true;
			api
				.chatSessions(undefined, sinceForSync(sessionsRef.current))
				.then((list) => {
					setSessions((prev) => mergeServerSessions(prev, list));
				})
				.catch((e) => {
					console.error("[chat-sync] refetch failed:", e);
				})
				.finally(() => {
					refetchInFlight.current = false;
				});
		};
		const onVis = () => {
			if (!document.hidden) maybeRefetch();
		};
		document.addEventListener("visibilitychange", onVis);
		window.addEventListener("focus", maybeRefetch);
		return () => {
			document.removeEventListener("visibilitychange", onVis);
			window.removeEventListener("focus", maybeRefetch);
		};
	}, []);

	// Once the turn is over the steered texts live on the answer node, so the
	// composer's transient list has done its job.
	useEffect(() => {
		if (!busy) {
			liveTurnServerId.current = null;
			if (steers.length) setSteers([]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [busy]);

	// Debounced save: every change pushes the tree to the server.
	useEffect(() => {
		if (!serverReadyRef.current) return;
		// Max wait, not just a debounce. Every token changes `sessions`, and
		// clearing then re-arming a 900 ms timer on each change meant the save
		// never fired while an answer was arriving — so a mid-answer reload lost
		// the question and the partial answer with it. Past MAX_SAVE_WAIT the
		// pending save goes out regardless of the incoming stream.
		const MAX_SAVE_WAIT = 4000;
		const now = Date.now();
		if (!dirtySinceRef.current) dirtySinceRef.current = now;
		const waited = now - dirtySinceRef.current;
		const delay = waited >= MAX_SAVE_WAIT ? 0 : Math.min(900, MAX_SAVE_WAIT - waited);
		if (saveTimer.current) window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => {
			dirtySinceRef.current = 0;
			void saveSessions();
		}, delay);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessions]);

	// What this device last pushed, per server session: a cheap fingerprint for
	// "did anything change" and the node ids it had, so a prune can be named.
	const syncedRef = useRef(new Map<number, { sig: string; ids: Set<string> }>());
	// When the oldest unsaved change happened, for the max-wait save below.
	const dirtySinceRef = useRef(0);

	async function saveSessions(): Promise<void> {
		if (savingRef.current) return;
		savingRef.current = true;
		const markSynced = (serverId: number, s: ChatSession) => {
			syncedRef.current.set(serverId, {
				sig: sessionSignature(s),
				ids: new Set(s.nodes.map((n) => n.id)),
			});
		};
		try {
			for (const s of sessionsRef.current) {
				if (s.nodes.length === 0) continue; // never persist empty drafts
				// Only what actually changed goes up. This loop used to re-PUT
				// every session on every tick, which is how a phone holding a
				// nine-day-old copy rewrote chats it had never opened — five
				// sessions in this database still share one identical
				// updated_at because of it.
				const sig = sessionSignature(s);
				const prev = s.serverId != null ? syncedRef.current.get(s.serverId) : undefined;
				const ids = new Set(s.nodes.map((n) => n.id));
				const gone = prev ? removedIds(prev.ids, ids) : [];
				if (prev && prev.sig === sig && gone.length === 0) continue;
				const payload = {
					title: s.title,
					nodes: stripUiFlags(s).nodes,
					activeNodeId: s.activeNodeId,
					model: s.model ?? null,
					// Node ids this device deliberately dropped (edit-and-resend
					// prunes the old descendants). The server removes ONLY these,
					// so an unchanged save can never shrink a tree.
					deletedNodeIds: gone,
					// the true per-session activity time — the server adopts it as
					// updated_at instead of stamping its own (bulk re-saves used to
					// clobber every session's time with the same value). Clamped:
					// a future value would be written verbatim and feed the drift
					// that made everything read as "just now".
					updatedAt: Math.min(s.updatedAt || Date.now(), Date.now()),
				};
				if (s.serverId != null) {
					try {
						await api.chatSessionSave(s.serverId, payload);
						markSynced(s.serverId, s);
					} catch (e) {
						if (e instanceof Error && e.message.startsWith("404")) {
							// server forgot this session (DB reset, deleted
							// elsewhere, stale cache) — drop the dead id so the
							// next tick re-creates it, and keep saving the rest
							// of the batch instead of 404-spamming every tick.
							syncedRef.current.delete(s.serverId);
							setSessions((ss) =>
								ss.map((x) =>
									x.id === s.id ? { ...x, serverId: undefined } : x,
								),
							);
							continue;
						}
						throw e;
					}
				} else {
					// Create ONCE, then remember it immediately — including on
					// the loop's own object and on sessionsRef, which is what
					// the NEXT save tick reads. Relying on setSessions alone
					// left a window where the id existed in React state but not
					// in the ref, so a later tick saw no serverId and created
					// ANOTHER server session; one chat accumulated ten identical
					// rows that way. `courseId || null` also stops a no-course
					// chat sending 0, which is not a valid course foreign key.
					const created = await api.chatSessionCreate(s.courseId || null, s.title);
					s.serverId = created.id;
					sessionsRef.current = sessionsRef.current.map((x) =>
						x.id === s.id ? { ...x, serverId: created.id } : x,
					);
					setSessions((ss) =>
						ss.map((x) => (x.id === s.id ? { ...x, serverId: created.id } : x)),
					);
					await api.chatSessionSave(created.id, payload);
					markSynced(created.id, s);
				}
			}
		} catch (e) {
			console.error("[chat-sync] save failed:", e);
		} finally {
			savingRef.current = false;
		}
	}

	useEffect(() => {
		// localStorage is a cache now; don't hammer it on every token while a
		// stream is running (the server gets the live tree instead).
		//
		// `busy` is a DEPENDENCY, not just a guard. A turn's final state change
		// lands while busy is still true, so it was skipped by the ref check and
		// never re-persisted — `sessions` doesn't change again afterwards. The
		// cache was therefore systematically one turn behind, so a reload
		// rendered a chat that stopped partway and then filled in the rest.
		if (busy) return;
		persist(sessions);
	}, [sessions, busy]);

	// Persist the active session per course so a reload reopens the same chat
	// instead of starting a fresh one.
	useEffect(() => {
		try {
			localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeMap));
		} catch {
			/* ignore */
		}
	}, [activeMap]);

	const setLastCourse = useCallback((courseId: number) => {
		setLastCourseId(courseId);
		try {
			localStorage.setItem(LAST_COURSE_KEY, String(courseId));
		} catch {
			/* quota/security — non-fatal */
		}
	}, []);

	/** Publish what is on screen. Called by the content pages; the value is read
	 *  at send time, so it must survive the publisher unmounting. */
	const publishView = useCallback((view: ViewContext) => {
		viewRef.current.set(view.courseId, view);
	}, []);

	const setModel = useCallback((m: string | null) => {
		setModelState(m);
		try {
			if (m) localStorage.setItem(MODEL_KEY, m);
			else localStorage.removeItem(MODEL_KEY);
		} catch {
			/* ignore */
		}
	}, []);

	const setSessionModel = useCallback(
		(sessionId: string, m: string | null) => {
			setSessions((ss) =>
				ss.map((s) =>
					s.id === sessionId ? { ...s, model: m, updatedAt: Date.now() } : s,
				),
			);
			// keep global picker in sync so pill reflects what will be used next
			setModel(m);
		},
		[setModel],
	);

	const setPinned = useCallback((p: string[]) => {
		const next = [...new Set(p)];
		setPinnedState(next);
		api
			.chatPinnedPut(next)
			.catch((e) => console.error("[chat-pinned] save failed:", e));
	}, []);

	const sessionsFor = useCallback(
		(courseId: number) => sessions.filter((s) => s.courseId === courseId),
		[sessions],
	);

	const activeFor = useCallback(
		(courseId: number) => {
			const id = activeMap[courseId];
			// '' = explicit empty-chat state (New chat pressed) — show the blank
			// screen instead of falling back to the most recent session
			if (id === "") return null;
			// Match the stored id against the client id AND the server id.
			// activeMap is persisted per course in localStorage, so it can hold an
			// id written by an older build: a bare uuid (which matches no session,
			// ever) or a legacy all-digits server id. Matching only `s.id` made
			// those fall through to the "most recently updated" guess below — the
			// exact path that reopened a DIFFERENT chat on reload and then
			// corrected itself a moment later.
			const found = id
				? (sessions.find((s) => s.id === id) ??
					sessions.find((s) => String(s.serverId) === id))
				: undefined;
			if (found) return found;
			// Before the server list lands, `sessions` is only this device's
			// localStorage cache — a fallback guess here picked the wrong chat,
			// painted it, and then jumped to the right one when the server
			// replied. Wait instead of guessing.
			if (!serverReady) return null;
			// stale/missing active (e.g. after an id promotion) — fall back to the
			// most recently updated session for the course instead of a blank chat
			return (
				sessions
					.filter((s) => s.courseId === courseId)
					.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
			);
		},
		[sessions, activeMap, serverReady],
	);

	const openSession = useCallback((courseId: number, sessionId: string) => {
		setActiveMap((m) => ({ ...m, [courseId]: sessionId }));
		// Seed the selector with this session's stored model (or keep the
		// current selection if it has none yet). Picking a different model
		// updates the selector immediately but only writes to the session on
		// send — so reopening a chat restores the model it was last sent with.
		const s = sessionsRef.current.find((x) => x.id === sessionId);
		if (s?.model) setModelState(s.model);
		else if (s && s.model === null) setModelState((cur) => cur); // no-op; inherit current
	}, []);

	const newChat = useCallback((courseId: number) => {
		// Reset to the EMPTY chat state without creating a session — the session
		// materializes on the first message (send creates it inline). Empty
		// 'New chat' drafts no longer accumulate in memory or the session list.
		setActiveMap((m) => ({ ...m, [courseId]: "" }));
	}, []);

	const deleteSession = useCallback((sessionId: string) => {
		const srv = sessionsRef.current.find((s) => s.id === sessionId);
		if (srv?.serverId != null) {
			api
				.chatSessionDelete(srv.serverId)
				.catch((e) => console.error("[chat-sync] delete failed:", e));
		}
		setSessions((ss) => ss.filter((s) => s.id !== sessionId));
		setActiveMap((m) => {
			const next: Record<number, string> = {};
			for (const [k, v] of Object.entries(m))
				if (v !== sessionId) next[Number(k)] = v;
			return next;
		});
	}, []);

	const renameSession = useCallback((sessionId: string, title: string) => {
		const clean = title.trim().slice(0, 80) || "New chat";
		setSessions((ss) =>
			ss.map((s) =>
				s.id === sessionId ? { ...s, title: clean, updatedAt: Date.now() } : s,
			),
		);
	}, []);

	const patchNode = useCallback(
		(sid: string, nid: string, fn: (n: MsgNode) => MsgNode) => {
			setSessions((ss) =>
				ss.map((s) =>
					s.id !== sid
						? s
						: {
								...s,
								updatedAt: Date.now(),
								nodes: s.nodes.map((n) => (n.id === nid ? fn(n) : n)),
							},
				),
			);
		},
		[],
	);

	const setActiveNode = useCallback((sid: string, nid: string) => {
		setSessions((ss) =>
			ss.map((s) =>
				s.id !== sid ? s : { ...s, updatedAt: Date.now(), activeNodeId: nid },
			),
		);
	}, []);

	/** Stream one turn into a new assistant child of userNodeId. */
	const streamTurn = useCallback(
		(
			sid: string,
			userNodeId: string,
			message: string,
			courseId: number | null,
			history: { role: "user" | "assistant"; content: string }[],
			attachments: ChatAttachment[] = [],
			model?: string | null,
			serverId?: number | null,
			// Node ids the server needs to store this turn itself (see the
			// chat endpoint): the parent the user message hangs off, and the id
			// this turn's reply will use.
			parentNodeId?: string | null,
			assistantNodeId?: string | null,
		) => {
			let assistantId: string | null = null;
			let assistantActivated = false;
			let turnThinking = "";
			let receivedDone = false;
			// ordered thought/tool steps of this turn — each contiguous reasoning
			// run is a thought step; each tool call is a tool step
			let steps: StepItem[] = [];
			let openThought = -1;
			// content tokens since the last tool boundary: until a tool_start
			// arrives they are the model's VISIBLE NARRATION ("I'll check the
			// assignments first"), not the final answer — flushed to a narration
			// step (and removed from content) when the tool begins
			let narrationBuf = "";
			const ac = new AbortController();
			turnAbortRef.current = ac;
			const closeThought = () => {
				openThought = -1;
			};
			const ensureThought = () => {
				if (openThought === -1) {
					steps = [...steps, { kind: "thought", text: "" }];
					openThought = steps.length - 1;
				}
			};
			const patchSteps = (id: string) =>
				patchNode(sid, id, (n) => ({ ...n, steps }));
			const ensureAssistant = (seedThinking?: string): string => {
				if (assistantId) {
					// A pre-minted node may exist without being active: it is
					// appended up front so the server can address it, but it only
					// joins the visible path once there is something to show.
					if (!assistantActivated) {
						assistantActivated = true;
						setActiveNode(sid, assistantId);
					}
					return assistantId;
				}
				assistantId = makeUuid();
				appendNode(sid, {
					id: assistantId,
					parentId: userNodeId,
					children: [],
					role: "assistant",
					content: "",
					streaming: true,
					thinking: seedThinking ?? "",
					thinkingDone: false,
					steps: [],
					createdAt: Date.now(),
				});
				assistantActivated = true;
				setActiveNode(sid, assistantId);
				return assistantId;
			};
			const appendNode = (s: string, node: MsgNode) => {
				setSessions((ss) =>
					ss.map((x) => {
						if (x.id !== s) return x;
						const nodes = node.parentId
							? x.nodes.map((n) =>
									n.id === node.parentId
										? { ...n, children: [...n.children, node.id] }
										: n,
								)
							: x.nodes;
						return { ...x, updatedAt: Date.now(), nodes: [...nodes, node] };
					}),
				);
			};
			// Mint the reply's node id up front and hand it to the server, which
			// writes the answer itself under this id. The save used to be the
			// browser's job alone, so a cut stream, a closed tab or a locked
			// phone left the turn in a ledger nothing read.
			if (assistantNodeId) {
				appendNode(sid, {
					id: assistantNodeId,
					parentId: userNodeId,
					children: [],
					role: "assistant",
					content: "",
					streaming: true,
					thinking: "",
					thinkingDone: false,
					steps: [],
					createdAt: Date.now(),
				});
				assistantId = assistantNodeId;
			}
			// remember which server conversation this turn belongs to, so the
			// composer can steer it while it streams
			liveTurnServerId.current = serverId ?? null;
			void streamChat(
				message,
				courseId,
				(event, data) => {
					const d = data as Record<string, unknown>;
					if (event === "reasoning") {
						turnThinking += (d.text as string) ?? "";
						const id = ensureAssistant();
						ensureThought();
						const chunk = (d.text as string) ?? "";
						steps = steps.map((s, i) =>
							i === openThought ? { ...s, text: (s.text ?? "") + chunk } : s,
						);
						patchNode(sid, id, (n) => ({
							...n,
							thinking: (n.thinking ?? "") + chunk,
							steps,
						}));
					} else if (event === "token") {
						const id = ensureAssistant(turnThinking || undefined);
						closeThought();
						const chunk = (d.text as string) ?? "";
						narrationBuf += chunk;
						patchNode(sid, id, (n) => ({
							...n,
							content: n.content + chunk,
							thinking: turnThinking || n.thinking,
							thinkingDone: n.thinking ? true : n.thinkingDone,
							// tool_start hid this node as mid-turn narration — real content
							// tokens mean the answer is back, so show it again
							intermediate: false,
							steps,
						}));
					} else if (event === "steering") {
						// the running turn has picked this up: the model will see it on
						// its next step, so mark it delivered in the composer
						const txt = (d.text as string) ?? "";
						setSteers((p) => p.map((x) => (x.text === txt ? { ...x, delivered: true } : x)));
					} else if (event === "tool_start") {
						// keep the assistant node VISIBLE (its tool chips render live as
						// each tool starts: running → done) — hiding it made every tool
						// call invisible until the final answer began
						const id = ensureAssistant();
						closeThought();
						// content streamed before this tool call is the model's visible
						// narration — pull it OUT of the (future) final answer and record
						// it as a step so it shows in the order it was said
						if (narrationBuf.trim()) {
							const seg = narrationBuf;
							narrationBuf = "";
							steps = [...steps, { kind: "narration", text: seg }];
							patchNode(sid, id, (n) => ({
								...n,
								content: n.content.slice(0, Math.max(0, n.content.length - seg.length)),
							}));
						}
						steps = [
							...steps,
							{
								kind: "tool",
								tool: (d.tool as string) ?? "tool",
								args: d.args,
								done: false,
							},
						];
						const toolId = makeUuid();
						appendNode(sid, {
							id: toolId,
							parentId: assistantId ?? userNodeId,
							children: [],
							role: "tool",
							content: "",
							tool: (d.tool as string) ?? "tool",
							args: d.args,
							done: false,
							open: false,
							createdAt: Date.now(),
						});
						patchSteps(id);
					} else if (event === "tool_end") {
						steps = steps.map((s) =>
							s.kind === "tool" && s.tool === (d.tool as string) && !s.done
								? { ...s, done: true, result: d.result }
								: s,
						);
						setSessions((ss) =>
							ss.map((s) =>
								s.id !== sid
									? s
									: {
											...s,
											updatedAt: Date.now(),
											nodes: s.nodes.map((n) =>
												n.role === "tool" && n.tool === (d.tool as string) && !n.done
													? { ...n, done: true, result: d.result }
													: n,
											),
										},
							),
						);
						if (assistantId) patchSteps(assistantId);
					} else if (event === "cite_register") {
						const cite = d as unknown as Citation;
						if (assistantId && cite?.id != null) {
							patchNode(sid, assistantId, (n) => {
								const prev = n.citations ?? [];
								if (prev.some((c) => c.id === cite.id)) return n;
								return { ...n, citations: [...prev, cite] };
							});
						}
					} else if (event === "title") {
						// backend-generated first-exchange title (same model as the
						// turn) — replaces the naive first-42-chars placeholder.
						// The debounced save persists it; later renames and turns
						// never trigger a new one server-side.
						const t = String((d as Record<string, unknown>).title ?? "")
							.trim()
							.slice(0, 60);
						if (t) {
							setSessions((ss) =>
								ss.map((x) =>
									x.id === sid ? { ...x, title: t, updatedAt: Date.now() } : x,
								),
							);
						}
					} else if (event === "done") {
						receivedDone = true;
						closeThought();
						if (!assistantId) {
							// nothing streamed at all — surface the final answer directly
							const id = makeUuid();
							const doneCites = (d.citations as Citation[] | undefined) ?? [];
							appendNode(sid, {
								id,
								parentId: userNodeId,
								children: [],
								role: "assistant",
								content: (d.answer as string) ?? "",
								streaming: false,
								thinkingDone: true,
								thinking: turnThinking || undefined,
								steps,
								citations: doneCites.length ? doneCites : undefined,
								createdAt: Date.now(),
							});
							setActiveNode(sid, id);
						} else {
							const doneCites = (d.citations as Citation[] | undefined) ?? [];
							patchNode(sid, assistantId, (n) => ({
								...n,
								streaming: false,
								thinkingDone: true,
								intermediate: false,
								thinking: n.thinking || turnThinking || undefined,
								model: (d.model as string) || undefined,
								tokens: (d.usage as MsgNode["tokens"]) || undefined,
								steps,
								citations:
									doneCites.length > 0
										? doneCites
										: n.citations?.length
											? n.citations
											: undefined,
							}));
						}
					} else if (event === "error") {
						// backend runner failed (run_turn raised) — the stream closes
						// right after, so surface the exact message AS A VISIBLE NODE
						// (a status line alone is invisible — the user saw thinking +
						// tools then nothing)
						closeThought();
						const errText = `⚠ Stream failed: ${String(d?.message ?? "stream error")}`;
						if (assistantId) {
							patchNode(sid, assistantId, (n) => ({
								...n,
								streaming: false,
								intermediate: false,
								content: (n.content || "") + "\n\n" + errText,
								steps,
							}));
						} else {
							// Record the id: without this, .finally() below still sees
							// assistantId === null and appends a SECOND error node under
							// the same parent, so one failed turn rendered as two ⚠
							// bubbles with bogus v1/v2 branch chips.
							assistantId = makeUuid();
							appendNode(sid, {
								id: assistantId,
								parentId: userNodeId,
								children: [],
								role: "assistant",
								content: errText,
								streaming: false,
								thinkingDone: true,
								steps,
								createdAt: Date.now(),
							});
							setActiveNode(sid, assistantId);
						}
					}
				},
				history,
				model ?? undefined,
				userNodeId,
				attachments.map((a) => a.id),
				ac.signal,
				serverId ?? null,
				sid,
				// Looked up by THIS conversation's course, so a view published for
				// another course can never be attached to this turn.
				courseId == null ? null : (viewRef.current.get(courseId) ?? null),
				assistantNodeId ?? null,
				parentNodeId ?? null,
			)
				.catch(async (err) => {
					closeThought();
					if (ac.signal.aborted) {
						// user-initiated stop — keep whatever streamed, no scary warning
						if (assistantId) {
							patchNode(sid, assistantId, (n) => ({
								...n,
								streaming: false,
								thinkingDone: true,
								steps,
							}));
						}
						return;
					}
					// surface stream failures IN the chat — never silent
					const errMsg = String(err?.message ?? err) || "unknown stream error";
					// The server stores each turn itself now, under the id this
					// turn was given. If it finished the answer while this browser
					// was losing the stream, that answer exists — show it instead
					// of an error notice. This is the "⚠ Stream failed: Error in
					// input stream" case: the work was never lost, it was just
					// unread.
					if (assistantId && serverId) {
						try {
							const fresh = await api.chatSessionGet(serverId);
							const saved = (
								(fresh.nodes ?? []) as { id?: string; content?: string }[]
							).find((n) => n.id === assistantId);
							if (saved && typeof saved.content === "string" && saved.content) {
								const recovered = saved.content;
								patchNode(sid, assistantId, (n) => ({
									...n,
									// the server's copy is the finished one
									content: recovered,
									streaming: false,
									thinkingDone: true,
									steps: n.steps?.length ? n.steps : steps,
								}));
								// tell .finally() the turn completed, so it does not
								// stamp a "no done event" warning over the answer
								receivedDone = true;
								return;
							}
						} catch {
							/* reconciliation is best-effort — fall through */
						}
					}
					if (assistantId) {
						patchNode(sid, assistantId, (n) => ({
							...n,
							streaming: false,
							thinkingDone: true,
							content: n.content || `⚠ Stream failed: ${errMsg}`,
							steps,
						}));
					} else {
						// see the stream-error branch above: recording the id prevents
						// .finally() from appending a duplicate error node
						assistantId = makeUuid();
						appendNode(sid, {
							id: assistantId,
							parentId: userNodeId,
							children: [],
							role: "assistant",
							content: `⚠ Stream failed: ${errMsg}`,
							streaming: false,
							thinkingDone: true,
							steps,
							createdAt: Date.now(),
						});
						setActiveNode(sid, assistantId);
					}
				})
				.finally(() => {
					turnAbortRef.current = null;
					if (!receivedDone && !assistantId && !ac.signal.aborted) {
						const eid = makeUuid();
						appendNode(sid, {
							id: eid,
							parentId: userNodeId,
							children: [],
							role: "assistant",
							content:
								"⚠ The response ended before completing (no done event). Try again.",
							streaming: false,
							thinkingDone: true,
							steps,
							createdAt: Date.now(),
						});
						setActiveNode(sid, eid);
					} else if (!receivedDone && assistantId) {
						patchNode(sid, assistantId, (n) => ({
							...n,
							streaming: false,
							thinkingDone: true,
							content:
								n.content || "⚠ The response ended before completing. Try again.",
							steps,
						}));
					}
					busyRef.current = false;
					setBusy(false);
				});
		},
		[sessions, patchNode, setActiveNode],
	);

	/**
	 * Steer the turn that is already running. This is not a new question: the
	 * running turn reads it at its next step boundary, so the work done so far
	 * is kept and redirected rather than thrown away and restarted.
	 */
	const steer = useCallback(
		(text: string): boolean => {
			const t = text.trim();
			if (!t) return false;
			const serverId = liveTurnServerId.current;
			if (!serverId) return false;
			setSteers((p) => [...p, { text: t, delivered: false }]);
			void api.chatSteer(serverId, t).catch(() => {
				// the turn finished before it could be read
				setSteers((p) => p.filter((x) => x.text !== t || x.delivered));
			});
			return true;
		},
		[],
	);

	const send = useCallback(
		(
			courseId: number,
			text: string,
			attachments: ChatAttachment[] = [],
		): boolean => {
			if (busyRef.current || (!text.trim() && !attachments.length)) return false;
			let sid = activeFor(courseId)?.id;
			if (!sid) {
				// first message of a new session — create it inline (async newChat
				// would drop the message)
				const s = makeSession(courseId);
				sid = s.id;
				setSessions((ss) => [s, ...ss].slice(0, MAX_SESSIONS));
				setActiveMap((m) => ({ ...m, [courseId]: s.id }));
			}
			const session = sessions.find((x) => x.id === sid) ?? {
				id: sid!,
				courseId,
				title: "",
				createdAt: 0,
				updatedAt: 0,
				nodes: [],
				activeNodeId: null,
			};
			const history = pathFor(session)
				.filter(
					(n) => n.role !== "tool" && !(n.role === "assistant" && n.intermediate),
				)
				.map((n) => ({
					role: n.role as "user" | "assistant",
					content: n.content,
				}));

			const userNodeId = makeUuid();
			// Both ids exist before the request goes out: the server stores this
			// turn under them, so the answer does not depend on this browser
			// surviving to save it.
			const assistantNodeId = makeUuid();
			const parentNodeId = session.activeNodeId ?? null;
			setSessions((ss) =>
				ss.map((s) => {
					if (s.id !== sid) return s;
					const userNode: MsgNode = {
						id: userNodeId,
						parentId: s.activeNodeId,
						children: [],
						role: "user",
						content: text,
						attachments: attachments.length ? attachments : undefined,
						createdAt: Date.now(),
					};
					const nodes = s.activeNodeId
						? s.nodes.map((n) =>
								n.id === s.activeNodeId
									? { ...n, children: [...n.children, userNodeId] }
									: n,
							)
						: s.nodes;
					return {
						...s,
						title: s.nodes.length === 0 ? text.slice(0, 42) : s.title,
						updatedAt: Date.now(),
						activeNodeId: userNodeId,
						nodes: [...nodes, userNode],
					};
				}),
			);
			busyRef.current = true;
			setBusy(true);
			try {
				setLastCourse(courseId);
			} catch {
				/* never let a non-critical write kill the stream */
			}
			// Resolve the model for this turn. The session stores its own model
			// (stamped on first send); fall back to the current selector value,
			// then to the first live model. If the chosen model was removed from
			// the provider, substitute the first available so we never 402.
			// Use modelRef to avoid stale closure (picker change must be seen immediately).
			const live = modelsRef.current;
			const effective = resolveTurnModel(session, modelRef.current, live);
			// Stamp the session's model now (write-through on message) so
			// reopening restores it — even if the user only picked it in the UI.
			if (effective && session.model !== effective) {
				setSessions((ss) =>
					ss.map((x) =>
						x.id === sid ? { ...x, model: effective, updatedAt: Date.now() } : x,
					),
				);
			}
			streamTurn(
				sid,
				userNodeId,
				text,
				courseId,
				history,
				attachments,
				effective,
				activeFor(courseId)?.serverId,
				parentNodeId,
				assistantNodeId,
			);
			return true;
		},
		[activeFor, sessions, setLastCourse, streamTurn],
	);

	const regenerate = useCallback(
		(sessionId: string, nodeId: string) => {
			if (busyRef.current) return;
			const session = sessions.find((s) => s.id === sessionId);
			if (!session) return;
			const target = session.nodes.find((n) => n.id === nodeId);
			if (!target || target.role !== "assistant") return;
			const parentId = target.parentId;
			const userNode = session.nodes.find((n) => n.id === parentId);
			if (!userNode) return;
			// History is everything BEFORE the user message being re-sent. The
			// previous version filtered only parentId out of the full active path,
			// so the answer being regenerated — and every turn after it — was still
			// sent to the model. That biased the new answer toward the old one,
			// inflated tokens, and leaked other branches' context.
			const path = pathFor(session);
			const cutAt = path.findIndex((n) => n.id === parentId);
			const history = (cutAt >= 0 ? path.slice(0, cutAt) : path)
				.filter(
					(n) =>
						n.role !== "tool" &&
						!(n.role === "assistant" && n.intermediate),
				)
				.map((n) => ({
					role: n.role as "user" | "assistant",
					content: n.content,
				}));
			busyRef.current = true;
			setBusy(true);
			streamTurn(
				sessionId,
				userNode.id,
				userNode.content,
				session.courseId,
				history,
				userNode.attachments ?? [],
				resolveTurnModel(session, modelRef.current, modelsRef.current),
				session.serverId,
				// A regeneration is a whole new turn: the server stores it under
				// these ids exactly like a first send, so a lost stream cannot
				// dissolve the answer.
				userNode.parentId ?? null,
				makeUuid(),
			);
		},
		[sessions, streamTurn],
	);

	const editMessage = useCallback(
		(sessionId: string, nodeId: string, newText: string) => {
			if (busyRef.current || !newText.trim()) return;
			const session = sessions.find((s) => s.id === sessionId);
			if (!session) return;
			const target = session.nodes.find((n) => n.id === nodeId);
			if (!target || target.role !== "user") return;
			const doomed = collectSubtree(session.nodes, nodeId);
			// the user message itself survives (rewritten) — only its DESCENDANTS
			// are deleted. Removing the node too left the re-sent turn streaming
			// into a ghost parent: the user message vanished and only the new
			// assistant response rendered.
			doomed.delete(nodeId);
			const history = pathFor(session)
				.filter(
					(n) =>
						n.id !== nodeId &&
						!doomed.has(n.id) &&
						n.role !== "tool" &&
						!(n.role === "assistant" && n.intermediate),
				)
				.map((n) => ({
					role: n.role as "user" | "assistant",
					content: n.content,
				}));
			setSessions((ss) =>
				ss.map((s) => {
					if (s.id !== sessionId) return s;
					return {
						...s,
						updatedAt: Date.now(),
						activeNodeId: nodeId,
						nodes: s.nodes
							.filter((n) => !doomed.has(n.id))
							.map((n) =>
								n.children.some((c) => doomed.has(c))
									? { ...n, children: n.children.filter((c) => !doomed.has(c)) }
									: n,
							)
							.map((n) => (n.id === nodeId ? { ...n, content: newText } : n)),
					};
				}),
			);
			busyRef.current = true;
			setBusy(true);
			streamTurn(
				sessionId,
				nodeId,
				newText,
				session.courseId,
				history,
				target.attachments ?? [],
				resolveTurnModel(session, modelRef.current, modelsRef.current),
				session.serverId,
				// Edit-and-resend: same persistence as a normal send. The edited
				// message keeps its id (the server upserts it) and the new reply
				// gets a fresh one, so the replacement turn is stored too.
				target.parentId ?? null,
				makeUuid(),
			);
		},
		[sessions, streamTurn],
	);

	const deleteMessage = useCallback(
		(sessionId: string, nodeId: string) => {
			const session = sessions.find((s) => s.id === sessionId);
			if (!session) return;
			const target = session.nodes.find((n) => n.id === nodeId);
			if (!target) return;
			const parentId = target.parentId;
			// Delete JUST this message and REJOIN the conversation: direct
			// user/assistant children re-parent to the deleted node's parent, so
			// deleting a middle user message no longer wipes every later message
			// (the old behavior forced deleting the assistant reply first).
			// Tool/intermediate nodes are artifacts and die with their parent.
			const kids = session.nodes.filter((n) => n.parentId === nodeId);
			const rejoin = kids.filter(
				(k) => k.role !== "tool" && !(k.role === "assistant" && k.intermediate),
			);
			const artifactIds = new Set(
				kids.filter((k) => !rejoin.some((r) => r.id === k.id)).map((k) => k.id),
			);
			const nodes = session.nodes
				.filter((n) => n.id !== nodeId && !artifactIds.has(n.id))
				.map((n) => {
					if (n.id === parentId) {
						const keep = n.children.filter(
							(c) => c !== nodeId && !artifactIds.has(c),
						);
						return { ...n, children: [...keep, ...rejoin.map((k) => k.id)] };
					}
					return rejoin.some((k) => k.id === n.id) ? { ...n, parentId } : n;
				});
			// active node: if we deleted the active message, fall back to a
			// remaining sibling branch first (deleting a regenerated v2 shows v1),
			// then to the parent
			let activeNodeId = session.activeNodeId;
			if (activeNodeId === nodeId) {
				const parent = nodes.find((n) => n.id === parentId);
				const siblings = (parent?.children ?? [])
					.map((id) => nodes.find((n) => n.id === id))
					.filter((n): n is MsgNode => !!n && n.role !== "tool");
				activeNodeId = siblings.length
					? siblings[siblings.length - 1]!.id
					: parentId;
			}
			// safety: never leave the path rooted at a missing node
			if (activeNodeId && !nodes.some((n) => n.id === activeNodeId)) {
				activeNodeId = nodes[nodes.length - 1]?.id ?? null;
			}
			if (nodes.length === 0) {
				// the last message is gone → the session is empty → drop it entirely
				if (session.serverId != null) {
					api
						.chatSessionDelete(session.serverId)
						.catch((e) => console.error("[chat-sync] delete failed:", e));
				}
				setSessions((ss) => ss.filter((s) => s.id !== sessionId));
				return;
			}
			setSessions((ss) =>
				ss.map((s) =>
					s.id === sessionId
						? { ...s, updatedAt: Date.now(), activeNodeId, nodes }
						: s,
				),
			);
		},
		[sessions],
	);

	const setActiveBranch = useCallback(
		(sessionId: string, nodeId: string) => {
			setActiveNode(sessionId, nodeId);
		},
		[setActiveNode],
	);

	// Abort the in-flight turn. Whatever streamed stays on screen; the
	// stream closes and busy clears via streamTurn's finally.
	const stop = useCallback(() => {
		turnAbortRef.current?.abort();
	}, []);

	const value = useMemo<ChatContextValue>(
		() => ({
			sessions,
			busy,
			lastCourseId,
			model,
			setModel,
			models,
			contexts,
			pinned,
			setPinned,
			setLastCourse,
			publishView,
			sessionsFor,
			activeFor,
			serverReady,
			openSession,
			setSessionModel,
			newChat,
			renameSession,
			deleteSession,
			send,
			steer,
			steers,
			stop,
			regenerate,
			editMessage,
			deleteMessage,
			setActiveBranch,
		}),
		[
			sessions,
			busy,
			lastCourseId,
			model,
			setModel,
			models,
			contexts,
			pinned,
			setPinned,
			setLastCourse,
			publishView,
			sessionsFor,
			activeFor,
			serverReady,
			openSession,
			setSessionModel,
			newChat,
			renameSession,
			deleteSession,
			send,
			steer,
			steers,
			regenerate,
			editMessage,
			deleteMessage,
			setActiveBranch,
		],
	);

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
	const ctx = useContext(ChatContext);
	if (!ctx) throw new Error("useChat must be used within ChatProvider");
	return ctx;
}
