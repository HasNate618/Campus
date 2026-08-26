import {
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	Cpu,
	History,
	Loader2,
	Plus,
	RefreshCw,
	Square,
	SquarePen,
	Trash2,
	Wrench,
} from "lucide-react";
import { CampusLogo } from "@/components/CampusLogo";
import { courseColor } from "@/lib/courses";
import { fmtRelative } from "@/lib/format";
import { api, type ChatAttachment } from "@/api/client";
import { getLlmModel } from "@/lib/appConfig";
import { listKeys, useListCursor, useZoneKeys } from "@/lib/keynav";
import { ZenMarkdown } from "@/lib/ZenMarkdown";
import { useChat, pathFor, type MsgNode, type StepItem } from "./ChatContext";
import type { Course } from "@/types";

const SUGGESTIONS = [
	"What's due this week?",
	"Summarize recent announcements",
	"Explain a concept from the course content",
	"What should I study next?",
];

/** Render tool args/results (objects arrive from the API) as readable JSON. */
function formatDetail(v: unknown): string {
	if (v == null) return "";
	if (typeof v === "string") return v;
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
}

/** Chat markdown is the same unified ZenMarkdown renderer as the content
 *  pages. Renders are rAF-throttled so token-by-token streaming stays
 *  smooth (content updates coalesce to one re-render per frame instead of
 *  one per token). memo() keeps finished messages from re-rendering when
 *  the composer re-renders the chat (typing previously wiped every
 *  message's innerHTML — code headers and images flickered). */
const ChatMd = memo(function ChatMd({ content }: { content: string }) {
	const [rendered, setRendered] = useState(content);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setRendered(content));
		return () => cancelAnimationFrame(raf);
	}, [content]);
	return <ZenMarkdown content={rendered} />;
});

function shortModel(id: string): string {
	const i = id.lastIndexOf("/");
	return i >= 0 ? id.slice(i + 1) : id;
}

function fmtTokens(n?: number): string {
	if (!n) return "";
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function greeting(): string {
	const h = new Date().getHours();
	if (h < 5) return "Up late";
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

interface Props {
	courseId: number;
	course?: Course;
	/** Show a course-switcher pill in the header (mobile chat tab). */
	courses?: Course[];
	onPickCourse?: (courseId: number) => void;
}

export function ChatView({ courseId, course, courses, onPickCourse }: Props) {
	const {
		busy,
		sessionsFor,
		activeFor,
		openSession,
		newChat,
		renameSession,
		deleteSession,
		send,
		stop,
		regenerate,
		editMessage,
		deleteMessage,
		setActiveBranch,
		model,
		setModel,
	} = useChat();
	const [input, setInput] = useState("");
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const [modelQuery, setModelQuery] = useState("");
	const [models, setModels] = useState<string[]>([]);
	const [contexts, setContexts] = useState<Record<string, number>>({});
	const [renamingTitle, setRenamingTitle] = useState(false);
	const [renameTitleText, setRenameTitleText] = useState("");
	const filteredModels = useMemo(
		() =>
			modelQuery.trim()
				? models.filter((m) =>
						m.toLowerCase().includes(modelQuery.trim().toLowerCase()),
					)
				: models,
		[models, modelQuery],
	);
	// server-configured default model (config llm_model) — used for the
	// context-window fallback when nothing is explicitly selected
	const ctxDefault = getLlmModel() || filteredModels[0] || "";
	const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>(
		{},
	);
	const [expandedStepDetail, setExpandedStepDetail] = useState<
		Record<string, boolean>
	>({});
	const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const historyRef = useRef<HTMLDivElement>(null);
	const pickerRef = useRef<HTMLDivElement>(null);
	const modelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		api
			.models()
			.then((d) => {
				if (d.models?.length) {
					setModels(d.models);
					// A model persisted in localStorage can go stale (removed upstream,
					// renamed, or a provider that no longer accepts it) — if the stored
					// model isn't in the live list, drop it so chat falls back to the
					// server default instead of 402ing on every turn.
					if (model && !d.models.includes(model)) setModel(null);
				}
				if (d.contexts) setContexts(d.contexts);
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const session = activeFor(courseId);
	const courseSessions = sessionsFor(courseId);
	const path = session ? pathFor(session) : [];
	const lastAssistant = [...path]
		.reverse()
		.find((n) => n.role === "assistant" && !n.intermediate);
	// real context window of the selected model (reported by /api/chat/models);
	// fall back to the configured default model's window when none is selected
	const ctxMax = model
		? (contexts[model] ?? null)
		: ctxDefault
			? (contexts[ctxDefault] ?? null)
			: null;
	const ctxText =
		lastAssistant?.tokens?.prompt_tokens != null
			? `${fmtTokens(lastAssistant.tokens.prompt_tokens)}${ctxMax ? `/${fmtTokens(ctxMax)}` : ""}`
			: "";

	// keyboard cursor inside the history popover (0 = New chat, 1.. = sessions)
	const histCount = courseSessions.length + 1;
	const histList = useListCursor(histCount);
	// keyboard cursor inside the model picker (0 = Default, 1.. = models)
	const modelCount = filteredModels.length + 1;
	const modelList = useListCursor(modelCount);

	// Chat zone keys: j/k scroll, g/G jump, Enter/i focus the input, n new
	// chat, r regenerate, h history, m model picker (j/k + Enter navigate
	// each popover, Esc closes).
	useZoneKeys("chat", (key) => {
		if (historyOpen) {
			const pick = (i: number) => {
				if (i === 0) {
					newChat(courseId);
					setHistoryOpen(false);
				} else {
					const s = courseSessions[i - 1];
					if (s) {
						openSession(courseId, s.id);
						setHistoryOpen(false);
					}
				}
			};
			if (key === "Escape") {
				setHistoryOpen(false);
				return true;
			}
			return listKeys(key, histList, () => pick(histList.cursor));
		}
		if (modelOpen) {
			const pick = (i: number) => {
				if (i === 0) {
					setModel(null);
				} else {
					const m = filteredModels[i - 1];
					if (m) setModel(m);
				}
				setModelOpen(false);
			};
			if (key === "Escape") {
				setModelOpen(false);
				return true;
			}
			// while the search input is focused keys type into it; once Esc
			// blurs it, j/k move the picker cursor
			return listKeys(key, modelList, () => pick(modelList.cursor));
		}
		switch (key) {
			case "j":
			case "ArrowDown":
				scrollRef.current?.scrollBy({ top: 120 });
				return true;
			case "k":
			case "ArrowUp":
				scrollRef.current?.scrollBy({ top: -120 });
				return true;
			case "g":
			case "Home":
				if (scrollRef.current) scrollRef.current.scrollTop = 0;
				return true;
			case "G":
			case "End":
				if (scrollRef.current)
					scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
				return true;
			case "Enter":
			case "i":
				inputRef.current?.focus();
				return true;
			case "n":
				newChat(courseId);
				return true;
			case "r": {
				const la = lastAssistant;
				if (la && session && !busy && la.thinkingDone && !la.streaming)
					regenerate(session.id, la.id);
				return true;
			}
			case "h":
				setHistoryOpen((o) => !o);
				return true;
			case "m":
				setModelOpen(true);
				setModelQuery("");
				return true;
			case "Escape":
				setHistoryOpen(false);
				setPickerOpen(false);
				setModelOpen(false);
				return true;
			default:
				return false;
		}
	});

	// Sticky scroll: follow streaming output ONLY while the user is pinned
	// to the bottom — scrolling up detaches the follow until they return.
	const pinnedRef = useRef(true);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		// switching sessions always jumps to the newest message and re-pins
		pinnedRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [session?.id]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !pinnedRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [session?.nodes, session?.activeNodeId]);

	/** Tool children of an assistant node (fallback + tree semantics). */
	const toolChildren = (assistantId: string): MsgNode[] =>
		session?.nodes.filter(
			(n) => n.parentId === assistantId && n.role === "tool",
		) ?? [];

	/** A short humanized purpose for a tool call, from its most meaningful
	 *  argument (the "to do thing" in "Using some_tool to do thing"). */
	const toolPurpose = (tool: string, args?: unknown): string => {
		const a = (args ?? {}) as Record<string, unknown>;
		const pick = (...keys: string[]): string => {
			for (const k of keys) {
				const v = a[k];
				if (typeof v === "string" && v.trim()) return v.trim();
				if (typeof v === "number") return String(v);
			}
			return "";
		};
		const trunc = (s: string) => (s.length > 72 ? `${s.slice(0, 69)}…` : s);
		switch (tool) {
			case "content_read_file":
				return trunc(pick("path"));
			case "content_grep":
			case "web_search":
				return `search '${trunc(pick("query"))}'`;
			case "web_read":
				return trunc(pick("url"));
			case "course_map":
			case "content_list_files":
			case "harness_list_assignments":
			case "harness_get_announcements":
			case "harness_get_facts":
				return pick("course");
			case "terminal_run":
				return trunc(pick("command"));
			case "file_write":
				return trunc(pick("path"));
			case "mutate_add_fact":
				return trunc(pick("fact"));
			case "mutate_add_event":
				return trunc(pick("title"));
			case "mutate_update_assignment": {
				const id = pick("id");
				const due = pick("due_at");
				if (due) return `#${id} due ${trunc(due)}`;
				return id ? `#${id}` : "";
			}
			default:
				return "";
		}
	};

	/** Ordered steps of an assistant turn: the recorded list, or (for chats
	 *  saved before steps existed) synthesized from thinking + tool children. */
	const stepsFor = (node: MsgNode): StepItem[] => {
		if (node.steps?.length) return node.steps;
		const out: StepItem[] = [];
		if (node.thinking) out.push({ kind: "thought", text: node.thinking });
		for (const t of toolChildren(node.id)) {
			out.push({
				kind: "tool",
				tool: t.tool,
				args: t.args,
				done: t.done,
				result: t.result,
			});
		}
		return out;
	};

	const toggleSteps = (assistantId: string) =>
		setExpandedSteps((s) => ({ ...s, [assistantId]: !s[assistantId] }));

	const toggleStepDetail = (key: string) =>
		setExpandedStepDetail((s) => ({ ...s, [key]: !s[key] }));

	const startEdit = (node: MsgNode) => {
		setEditingNodeId(node.id);
		setEditText(node.content);
	};

	const saveEdit = (node: MsgNode) => {
		if (!session) return;
		editMessage(session.id, node.id, editText);
		setEditingNodeId(null);
	};

	/** One step row of an assistant turn — thought (expandable thinking text),
	 *  narration (visible text the model said between tool batches), or tool
	 *  (expandable args/result). */
	const renderStepRow = (
		node: MsgNode,
		s: StepItem,
		i: number,
		key: string,
	): ReactNode => {
		const detailKey = `${node.id}:${i}`;
		const open = !!expandedStepDetail[detailKey];
		if (s.kind === "thought") {
			return (
				<motion.div
					key={key}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.18 }}
					style={{ display: "flex", flexDirection: "column" }}
				>
					<button
						className="tool-chip"
						onClick={() => toggleStepDetail(detailKey)}
						title={
							node.thinkingDone
								? "Show chain-of-thought"
								: "Chain-of-thought streaming"
						}
					>
						{node.thinkingDone ? (
							<Brain size={13} />
						) : (
							<Loader2 size={13} className="animate-spin" />
						)}
						<span>{node.thinkingDone ? "Thought" : "Thinking…"}</span>
						<ChevronDown
							size={12}
							style={{
								transform: open ? "rotate(180deg)" : "none",
								transition: "transform 120ms ease",
								opacity: 0.6,
							}}
						/>
					</button>
					{open && (
						<div
							className="tool-detail"
							style={{
								fontStyle: "italic",
								maxHeight: "min(40vh, 320px)",
								overflowY: "auto",
							}}
						>
							{s.text ?? node.thinking ?? ""}
						</div>
					)}
				</motion.div>
			);
		}
		if (s.kind === "narration") {
			// visible narration the model said between tool batches — regular
			// text, not a pill (it reads as the assistant speaking)
			return (
				<motion.div
					key={key}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.18 }}
				>
					<p className="step-narration">{s.text}</p>
				</motion.div>
			);
		}
		const purpose = toolPurpose(s.tool ?? "", s.args);
		return (
			<motion.div
				key={key}
				initial={{ opacity: 0, y: 6 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.18 }}
				style={{ display: "flex", flexDirection: "column" }}
			>
				<button
					className="tool-chip"
					onClick={() => toggleStepDetail(detailKey)}
				>
					{s.done ? (
						<Check size={13} />
					) : (
						<Loader2 size={13} className="animate-spin" />
					)}
					<Wrench size={13} />
					<span>{s.tool}</span>
					{purpose && <span style={{ opacity: 0.6 }}>· {purpose}</span>}
					<span style={{ opacity: 0.6 }}>
						{s.done ? "· done" : "· running"}
					</span>
					<ChevronDown
						size={12}
						style={{
							transform: open ? "rotate(180deg)" : "none",
							transition: "transform 120ms ease",
							opacity: 0.6,
						}}
					/>
				</button>
				{open && (
					<div className="tool-detail">
						{s.args != null && `args:   ${formatDetail(s.args)}\n`}
						{s.done ? `result: ${formatDetail(s.result) || "—"}` : "running…"}
					</div>
				)}
			</motion.div>
		);
	};

	const renderBranchChips = (node: MsgNode): ReactNode => {
		const kids =
			session?.nodes.filter(
				(n) => n.parentId === node.id && n.role !== "tool" && !n.intermediate,
			) ?? [];
		if (kids.length < 2) return null;
		return (
			<div key={`br-${node.id}`} className="branch-chips">
				{kids.map((k, i) => (
					<button
						key={k.id}
						className={`branch-chip${session?.activeNodeId === k.id ? " active" : ""}`}
						onClick={() => setActiveBranch(session!.id, k.id)}
						title="Switch to this branch"
					>
						v{i + 1}
					</button>
				))}
			</div>
		);
	};

	const renderMessages = (): ReactNode[] => {
		if (!session) return [];
		const out: ReactNode[] = [];
		for (const node of path) {
			const key = `${session.id}-${node.id}`;
			if (node.role === "user") {
				out.push(
					<motion.div
						key={key}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.18 }}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-end",
						}}
					>
						{editingNodeId === node.id ? (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: 6,
									width: "100%",
									maxWidth: 560,
								}}
							>
								<textarea
									className="chat-input-area"
									value={editText}
									onChange={(e) => setEditText(e.target.value)}
									rows={3}
									autoFocus
								/>
								<div
									style={{
										display: "flex",
										gap: 8,
										justifyContent: "flex-end",
									}}
								>
									<button
										className="btn btn-outline btn-sm"
										onClick={() => setEditingNodeId(null)}
									>
										Cancel
									</button>
									<button
										className="btn btn-sm"
										style={{ background: "var(--violet)", color: "#fff" }}
										onClick={() => saveEdit(node)}
										disabled={!editText.trim()}
									>
										Save & re-send
									</button>
								</div>
							</div>
						) : (
							<>
								{node.attachments?.length ? (
									<div className="msg-attachments">
										{node.attachments.map((a) =>
											a.mime.startsWith("image/") ? (
												<img
													key={a.id}
													className="msg-image"
													src={api.chatAttachmentUrl(a.id)}
													alt={a.name}
													loading="lazy"
													title={`${a.name} — click to open`}
													onClick={(e) => {
														e.stopPropagation();
														window.open(
															api.chatAttachmentUrl(a.id),
															"_blank",
															"noopener",
														);
													}}
												/>
											) : (
												<span className="msg-attachment" key={a.id}>
													{a.name}
												</span>
											),
										)}
									</div>
								) : null}
								{node.content && <div className="msg-user">{node.content}</div>}
								<div className="msg-actions">
									<button
										className="icon-btn"
										title="Edit (rewind)"
										onClick={() => startEdit(node)}
									>
										<SquarePen size={12} />
									</button>
									<button
										className="icon-btn"
										title="Delete message"
										onClick={() => deleteMessage(session.id, node.id)}
									>
										<Trash2 size={12} />
									</button>
								</div>
							</>
						)}
					</motion.div>,
				);
				out.push(renderBranchChips(node));
				continue;
			}

			// assistant — skip mid-turn narration
			if (node.role === "assistant" && node.intermediate) continue;

			if (node.role === "assistant") {
				const steps = stepsFor(node);
				// live while streaming; collapsed into one pill once done (expandable)
				const stepsOpen = !!node.streaming || !!expandedSteps[node.id];
				const nThoughts = steps.filter((s) => s.kind === "thought").length;
				const nTools = steps.length - nThoughts;
				out.push(
					<motion.div
						key={key}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.18 }}
						style={{ display: "flex", flexDirection: "column" }}
					>
						{steps.length > 0 && (
							<div className="msg-steps">
								<button
									className="tool-chip"
									onClick={() => {
										if (!node.streaming) toggleSteps(node.id);
									}}
									title={
										node.streaming
											? undefined
											: stepsOpen
												? "Collapse steps"
												: "Expand steps"
									}
									style={{ color: "var(--text-3)" }}
								>
									<Brain size={13} />
									<Wrench size={13} />
									<span>
										{steps.length} step{steps.length === 1 ? "" : "s"}
										{nTools > 0
											? ` · ${nTools} tool call${nTools === 1 ? "" : "s"}`
											: ""}
										{nThoughts > 0
											? ` · ${nThoughts} thought${nThoughts === 1 ? "" : "s"}`
											: ""}
									</span>
									<ChevronDown
										size={12}
										style={{
											transform: stepsOpen ? "rotate(180deg)" : "none",
											transition: "transform 120ms ease",
											opacity: 0.6,
										}}
									/>
								</button>
								{stepsOpen &&
									steps.map((s, i) =>
										renderStepRow(
											node,
											s,
											i,
											`${session.id}-step-${node.id}-${i}`,
										),
									)}
							</div>
						)}
						<div
							className={`msg-assistant${node.streaming ? " streaming" : ""}`}
						>
							<ChatMd content={node.content} />
							{node.streaming && <span className="stream-cursor" />}
						</div>

						<div className="msg-actions">
							{!busy && node.thinkingDone && (
								<button
									className="icon-btn"
									title="Regenerate (forks the conversation)"
									onClick={() => regenerate(session.id, node.id)}
								>
									<RefreshCw size={12} />
								</button>
							)}
							<button
								className="icon-btn"
								title="Delete message"
								onClick={() => deleteMessage(session.id, node.id)}
							>
								<Trash2 size={12} />
							</button>
						</div>
					</motion.div>,
				);
				out.push(renderBranchChips(node));
				continue;
			}
		}
		return out;
	};

	useEffect(() => {
		if (!historyOpen && !pickerOpen && !modelOpen) return;
		const close = (e: MouseEvent) => {
			if (historyOpen && !historyRef.current?.contains(e.target as Node))
				setHistoryOpen(false);
			if (pickerOpen && !pickerRef.current?.contains(e.target as Node))
				setPickerOpen(false);
			if (modelOpen && !modelRef.current?.contains(e.target as Node))
				setModelOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, [historyOpen, pickerOpen, modelOpen]);

	// Workspace "Ask AI" button → prefilled prompt lands here and sends
	useEffect(() => {
		const h = (e: Event) => {
			const detail = (e as CustomEvent).detail as { text?: string } | undefined;
			const text = detail?.text;
			if (text && send(courseId, text)) {
				setInput("");
				resetInputHeight();
			}
		};
		window.addEventListener("campus:ask-ai", h);
		return () => window.removeEventListener("campus:ask-ai", h);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [courseId]);

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	};

	const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInput(e.target.value);
		e.target.style.height = "auto";
		e.target.style.height = `${e.target.scrollHeight}px`;
	};

	/** Collapse the textarea back to one line after a send (autoGrow leaves
	 *  it at the grown height, so the box stays tall after sending). */
	const resetInputHeight = () => {
		if (inputRef.current) inputRef.current.style.height = "auto";
	};

	const submit = async () => {
		if (busy || uploading || (!input.trim() && !selectedFiles.length)) return;
		setUploading(true);
		setUploadError(null);
		try {
			const attachments: ChatAttachment[] = [];
			for (const file of selectedFiles)
				attachments.push(await api.chatUpload(file));
			if (send(courseId, input, attachments)) {
				setInput("");
				for (const f of selectedFiles) {
					const url = previewUrlsRef.current.get(f);
					if (url) {
						URL.revokeObjectURL(url);
						previewUrlsRef.current.delete(f);
					}
				}
				setSelectedFiles([]);
				resetInputHeight();
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : "Upload failed";
			setUploadError(message);
			console.error("[chat-upload]", e);
		} finally {
			setUploading(false);
		}
	};

	const addFiles = (files: FileList | null) => {
		if (!files) return;
		setSelectedFiles((current) =>
			[...current, ...Array.from(files)].slice(0, 8),
		);
	};

	// local object-URL previews for image attachments (revoked on removal)
	const previewUrlsRef = useRef(new Map<File, string>());
	const previewFor = (f: File): string => {
		let url = previewUrlsRef.current.get(f);
		if (!url) {
			url = URL.createObjectURL(f);
			previewUrlsRef.current.set(f, url);
		}
		return url;
	};

	const removeFile = (index: number) => {
		setSelectedFiles((files) => {
			const gone = files[index];
			if (gone) {
				const url = previewUrlsRef.current.get(gone);
				if (url) {
					URL.revokeObjectURL(url);
					previewUrlsRef.current.delete(gone);
				}
			}
			return files.filter((_, i) => i !== index);
		});
	};

	const answerStreaming =
		!!lastAssistant && lastAssistant.streaming && !lastAssistant.intermediate;

	return (
		<div className="chat-wrap" data-kbd-zone="chat">
			<div className="chat-head">
				<div ref={historyRef} style={{ position: "relative" }}>
					<button
						className="icon-btn"
						onClick={() => setHistoryOpen((o) => !o)}
						title="Chat history"
					>
						<History size={15} />
					</button>
					{historyOpen && (
						<div className="popover left">
							<button
								ref={histList.setRef(0)}
								className={`popover-item${histList.cursor === 0 ? " kbd-cursor" : ""}`}
								onClick={() => {
									newChat(courseId);
									setHistoryOpen(false);
								}}
							>
								<SquarePen size={13} style={{ flexShrink: 0 }} />
								New chat
							</button>
							{courseSessions.length > 0 && <div className="popover-divider" />}
							{courseSessions.map((s, i) => (
								<div key={s.id} className="popover-row">
									<button
										ref={histList.setRef(i + 1)}
										className={`popover-item${session?.id === s.id ? " selected" : ""}${histList.cursor === i + 1 ? " kbd-cursor" : ""}`}
										onClick={() => {
											openSession(courseId, s.id);
											setHistoryOpen(false);
										}}
									>
										<span className="popover-title">{s.title}</span>
										<span className="popover-time">
											{fmtRelative(new Date(s.updatedAt).toISOString())}
										</span>
									</button>
									<button
										className="icon-btn popover-delete"
										onClick={() => deleteSession(s.id)}
										title="Delete chat"
									>
										<Trash2 size={12} />
									</button>
								</div>
							))}
							{courseSessions.length === 0 && (
								<p
									style={{
										margin: "6px 10px",
										fontSize: 12,
										color: "var(--text-3)",
									}}
								>
									No chats yet
								</p>
							)}
						</div>
					)}
				</div>

				{courses && onPickCourse ? (
					<div ref={pickerRef} style={{ position: "relative" }}>
						<button
							className="scope-pill course-picker-pill"
							style={
								course
									? {
											background: courseColor(course),
											borderColor: "transparent",
											color: "#fff",
										}
									: undefined
							}
							onClick={() => setPickerOpen((o) => !o)}
						>
							{course && (
								<span
									className="dot"
									style={{ background: courseColor(course) }}
								/>
							)}
							<span className="picker-label">
								{course ? course.code : "Select course"}
							</span>
							<ChevronDown size={13} className="picker-chevron" />
						</button>
						{pickerOpen && (
							<div className="popover course-picker">
								{courses.map((c) => (
									<button
										key={c.id}
										className={`popover-item${c.id === courseId ? " selected" : ""}`}
										onClick={() => {
											onPickCourse(c.id);
											setPickerOpen(false);
										}}
										title={`${c.code} — ${c.name}`}
									>
										<span
											className="dot"
											style={{ background: courseColor(c) }}
										/>
										<span className="popover-title">{c.code}</span>
										{c.term && <span className="popover-time">{c.term}</span>}
									</button>
								))}
							</div>
						)}
					</div>
				) : renamingTitle ? (
					<input
						className="chat-head-rename"
						value={renameTitleText}
						autoFocus
						onChange={(e) => setRenameTitleText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && session) {
								renameSession(session.id, renameTitleText);
								setRenamingTitle(false);
							} else if (e.key === "Escape") {
								setRenamingTitle(false);
							}
						}}
						onBlur={() => {
							if (session) {
								renameSession(session.id, renameTitleText);
								setRenamingTitle(false);
							}
						}}
					/>
				) : (
					<div style={{ minWidth: 0 }}>
						<span
							className="chat-head-title"
							title="Rename chat"
							onClick={() => {
								if (session) {
									setRenamingTitle(true);
									setRenameTitleText(session.title);
								}
							}}
						>
							{session?.title ?? "New chat"}
						</span>
					</div>
				)}

				{session && path.length > 0 && (
					<button
						className="icon-btn"
						onClick={() => newChat(courseId)}
						title="New chat"
					>
						<SquarePen size={15} />
					</button>
				)}
			</div>

			<div className="chat-scroll" ref={scrollRef}>
				<div className="chat-col">
					{!session || path.length === 0 ? (
						<div className="chat-empty">
							<div className="logo-mark campus-logo-mark">
								<CampusLogo size={32} />
							</div>
							<p className="greeting">{greeting()}</p>
							<p className="page-sub" style={{ margin: 0 }}>
								Ask about {course ? course.code : "this course"} — deadlines,
								content, or what to study next.
							</p>
							<div className="suggestions">
								{SUGGESTIONS.map((s) => (
									<button
										key={s}
										className="suggestion"
										onClick={() => void send(courseId, s)}
									>
										{s}
									</button>
								))}
							</div>
						</div>
					) : (
						<>
							{renderMessages()}
							{busy && !answerStreaming && (
								<motion.div
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.18 }}
								>
									<div
										className="thinking-row msg-assistant"
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 8,
											fontSize: 13,
											color: "var(--text-2)",
										}}
									>
										<Loader2
											size={14}
											className="animate-spin"
											style={{ color: "var(--violet)" }}
										/>
										Thinking…
									</div>
								</motion.div>
							)}
						</>
					)}
				</div>
			</div>

			<div className="input-dock">
				<div className="chat-input">
					<div className="chat-input-main">
						<textarea
							ref={inputRef}
							value={input}
							onChange={autoGrow}
							onKeyDown={onKeyDown}
							placeholder={`Ask ${course ? course.code : "about this course"}…`}
							rows={1}
							disabled={busy || uploading}
						/>
						{selectedFiles.length > 0 && (
							<div className="attachment-strip">
								{selectedFiles.map((file, i) =>
									file.type.startsWith("image/") ? (
										<button
											type="button"
											className="attach-thumb"
											key={`${file.name}-${i}`}
											onClick={() => removeFile(i)}
											title={`Remove ${file.name}`}
										>
											<img src={previewFor(file)} alt={file.name} />
											<span className="attach-thumb-x">×</span>
										</button>
									) : (
										<button
											type="button"
											className="attachment-chip"
											key={`${file.name}-${i}`}
											onClick={() => removeFile(i)}
											title="Remove file"
										>
											{file.name} ×
										</button>
									),
								)}
							</div>
						)}
						{uploadError && <div className="upload-error">{uploadError}</div>}
						<div className="input-toolbar">
							<input
								ref={fileInputRef}
								type="file"
								hidden
								multiple
								accept=".pdf,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
								onChange={(e) => {
									addFiles(e.target.files);
									e.currentTarget.value = "";
								}}
							/>
							<button
								className="attach-btn"
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={busy || uploading}
								title="Attach files"
								aria-label="Attach files"
							>
								<Plus size={18} />
							</button>
							<span
								className="ctx-meter"
								title="Context used so far vs the selected model's window"
							>
								{ctxText}
							</span>
							<div style={{ flex: 1 }} />
							<div ref={modelRef} style={{ position: "relative" }}>
								<button
									className="scope-pill"
									onClick={() => {
										setModelOpen((o) => !o);
										setModelQuery("");
									}}
									title={model ?? "Default model"}
								>
									<Cpu size={12} />
									<span
										style={{
											maxWidth: 130,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{model ? shortModel(model) : "Default"}
									</span>
									<ChevronDown size={11} />
								</button>
								{modelOpen && (
									<div
										className="popover course-picker"
										style={{
											bottom: "calc(100% + 8px)",
											top: "auto",
											width: 280,
											maxHeight: 330,
											display: "flex",
											flexDirection: "column",
										}}
									>
										<input
											autoFocus
											value={modelQuery}
											onChange={(e) => setModelQuery(e.target.value)}
											placeholder="Search models…"
											className="model-search"
										/>
										<div style={{ overflowY: "auto", flex: 1 }}>
											<button
												ref={modelList.setRef(0)}
												className={`popover-item${!model ? " selected" : ""}${modelList.cursor === 0 ? " kbd-cursor" : ""}`}
												onClick={() => {
													setModel(null);
													setModelOpen(false);
												}}
											>
												<span className="popover-title">Default (config)</span>
											</button>
											{filteredModels.length === 0 && (
												<p
													style={{
														margin: "6px 10px",
														fontSize: 12,
														color: "var(--text-3)",
													}}
												>
													No matching models.
												</p>
											)}
											{filteredModels.map((m, i) => (
												<button
													key={m}
													ref={modelList.setRef(i + 1)}
													className={`popover-item${model === m ? " selected" : ""}${modelList.cursor === i + 1 ? " kbd-cursor" : ""}`}
													onClick={() => {
														setModel(m);
														setModelOpen(false);
													}}
													title={m}
												>
													<span
														className="popover-title"
														style={{
															overflow: "hidden",
															textOverflow: "ellipsis",
														}}
													>
														{m}
													</span>
													{model === m && (
														<Check size={13} style={{ flexShrink: 0 }} />
													)}
												</button>
											))}
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
					<button
						className={`send-btn${busy ? " stopping" : ""}`}
						onClick={busy ? stop : submit}
						disabled={
							uploading || (!busy && !input.trim() && !selectedFiles.length)
						}
						aria-label={busy ? "Stop generating" : "Send"}
						title={busy ? "Stop generating" : "Send"}
					>
						{busy ? (
							<Square size={13} fill="currentColor" />
						) : (
							<ArrowUp size={16} />
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
