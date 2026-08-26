import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
	CalendarDays,
	Home,
	LogOut,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Trash2,
} from "lucide-react";
import { CampusLogo } from "@/components/CampusLogo";
import { api } from "@/api/client";
import { useChat } from "@/chat/ChatContext";
import { listKeys, useListCursor, useZoneKeys } from "@/lib/keynav";
import { courseColor } from "@/lib/courses";
import { fmtRelative } from "@/lib/format";
import type { Course } from "@/types";

const NAV = [
	{ to: "/", label: "Home", icon: Home, end: true },
	{ to: "/schedule", label: "Schedule", icon: CalendarDays, end: true },
];

export function Sidebar({ onLogout }: { onLogout: () => void }) {
	const [courses, setCourses] = useState<Course[]>([]);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem("hc.sidebar.collapsed") === "1",
	);
	const { sessions, activeFor, openSession, renameSession, deleteSession } =
		useChat();
	const navigate = useNavigate();
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameText, setRenameText] = useState("");
	// Instant label tooltip for the collapsed sidebar (replaces the slow
	// browser-native title tooltip).
	const [tip, setTip] = useState<{
		label: string;
		x: number;
		y: number;
	} | null>(null);
	const showTip = (e: MouseEvent<HTMLElement>, label: string) => {
		if (!collapsed) return;
		const r = e.currentTarget.getBoundingClientRect();
		setTip({ label, x: r.right + 10, y: r.top + r.height / 2 });
	};
	const hideTip = () => setTip(null);

	useEffect(() => {
		api.courses().then(setCourses).catch(console.error);
	}, []);

	// Alt+1 toggles the sidebar collapse (same as the 'c' key / footer button).
	useEffect(() => {
		const h = (e: Event) => {
			if ((e as CustomEvent).detail?.pane === "sidebar") toggle();
		};
		window.addEventListener("campus:toggle-pane", h);
		return () => window.removeEventListener("campus:toggle-pane", h);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collapsed]);

	const toggle = () => {
		setTip(null);
		setCollapsed((c) => {
			localStorage.setItem("hc.sidebar.collapsed", c ? "0" : "1");
			return !c;
		});
	};

	const recentChats = [...sessions]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, 5);

	const courseById = new Map(courses.map((c) => [c.id, c]));

	// Flat list of keyboard-navigable rows in DOM order: Home, recent chats,
	// courses. Enter activates each kind.
	const rows = useMemo(() => {
		const r: {
			kind: "nav" | "chat" | "course";
			to?: string;
			sessionId?: string;
			courseId?: number;
		}[] = [];
		for (const n of NAV) r.push({ kind: "nav", to: n.to });
		for (const s of recentChats)
			r.push({ kind: "chat", sessionId: s.id, courseId: s.courseId });
		for (const c of courses)
			r.push({ kind: "course", courseId: c.id, to: `/courses/${c.id}` });
		return r;
	}, [recentChats, courses]);

	const cursor = useListCursor(rows.length);

	// Collapsed sidebar: mirror the hover tooltips for j/k navigation — the
	// cursor row announces itself exactly where the mouse tooltip appears.
	useEffect(() => {
		if (!collapsed) {
			setTip(null);
			return;
		}
		const row = rows[cursor.cursor];
		const el = cursor.refs.current[cursor.cursor];
		if (!row || !el) {
			setTip(null);
			return;
		}
		const r = el.getBoundingClientRect();
		const chat =
			row.kind === "chat"
				? sessions.find((s) => s.id === row.sessionId)
				: undefined;
		const c = courseById.get(row.courseId ?? NaN);
		const label =
			row.kind === "nav"
				? (NAV.find((n) => n.to === row.to)?.label ?? "")
				: row.kind === "chat"
					? `${c?.code ?? "Course"} — ${chat?.title ?? ""}`
					: `${c?.code ?? ""} — ${c?.name ?? ""}`;
		setTip({ label, x: r.right + 10, y: r.top + r.height / 2 });
		// rows/sessions/courseById are stable per render; cursor position and
		// collapse state drive the tooltip
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collapsed, cursor.cursor]);

	useZoneKeys("sidebar", (key) => {
		if (key === "c") {
			toggle();
			return true;
		}
		return listKeys(key, cursor, () => {
			const row = rows[cursor.cursor];
			if (!row) return;
			if (row.kind === "nav" && row.to) navigate(row.to);
			else if (row.kind === "chat" && row.sessionId && row.courseId != null) {
				openSession(row.courseId, row.sessionId);
				navigate(`/courses/${row.courseId}`);
			} else if (row.kind === "course" && row.courseId != null) {
				navigate(`/courses/${row.courseId}`);
			}
		});
	});

	return (
		<aside
			className={`sidebar${collapsed ? " collapsed" : ""}`}
			data-kbd-zone="sidebar"
		>
			<div className="brand">
				<button
					className="brand-logo-btn"
					onClick={collapsed ? toggle : undefined}
					onMouseEnter={(e) => collapsed && showTip(e, "Expand sidebar")}
					onMouseLeave={hideTip}
					title={collapsed ? "Expand sidebar" : undefined}
					aria-label={collapsed ? "Expand sidebar" : "Campus"}
				>
					<span className="brand-logo">
						<CampusLogo size={22} />
					</span>
					<span className="brand-expand-icon">
						<PanelLeftOpen size={18} />
					</span>
				</button>
				<span className="brand-name side-label">Campus</span>
				<button
					className="brand-collapse-btn"
					onClick={toggle}
					onMouseEnter={(e) => showTip(e, "Collapse sidebar")}
					onMouseLeave={hideTip}
					title="Collapse sidebar"
					aria-label="Collapse sidebar"
				>
					<PanelLeftClose size={17} />
				</button>
			</div>

			<div className="sidebar-scroll">
				<nav>
					{NAV.map(({ to, label, icon: Icon, end }, navIdx) => (
						<NavLink
							key={to}
							to={to}
							end={end}
							ref={cursor.setRef(navIdx)}
							onMouseEnter={(e) => showTip(e, label)}
							onMouseLeave={hideTip}
							className={({ isActive }) =>
								`nav-item${isActive ? " active" : ""}${cursor.cursor === navIdx ? " kbd-cursor" : ""}`
							}
						>
							<Icon size={17} />
							<span className="side-label">{label}</span>
						</NavLink>
					))}
				</nav>

				{recentChats.length > 0 && (
					<>
						<p className="section-label">Recent Chats</p>
						<div className="sidebar-list">
							{recentChats.map((s, i) => {
								const c = courseById.get(s.courseId);
								const active = activeFor(s.courseId)?.id === s.id;
								return (
								<div
									key={s.id}
									ref={cursor.setRef(i + 1)}
									data-navrow
									className={`session-item${active ? " active" : ""}${cursor.cursor === i + 1 ? " kbd-cursor" : ""}`}
									style={
										c
											? {
													borderLeft: `3px solid ${courseColor(c)}`,
													background: `linear-gradient(135deg, ${courseColor(c)}14 0%, transparent 65%)`,
												}
											: undefined
									}
								>
										<button
											className="session-btn"
											onMouseEnter={(e) =>
												showTip(e, `${c?.code ?? "Course"} — ${s.title}`)
											}
											onMouseLeave={hideTip}
											onClick={() => {
												openSession(s.courseId, s.id);
												navigate(`/courses/${s.courseId}`);
											}}
										>
											{renamingId === s.id ? (
												<input
													className="session-rename"
													value={renameText}
													autoFocus
													onChange={(e) => setRenameText(e.target.value)}
													onClick={(e) => e.stopPropagation()}
													onKeyDown={(e) => {
														e.stopPropagation();
														if (e.key === "Enter") {
															renameSession(s.id, renameText);
															setRenamingId(null);
														} else if (e.key === "Escape") {
															setRenamingId(null);
														}
													}}
													onBlur={() => {
														if (renamingId === s.id) {
															renameSession(s.id, renameText);
															setRenamingId(null);
														}
													}}
												/>
											) : (
												<span className="session-title">{s.title}</span>
											)}
											<span className="session-time">
												{fmtRelative(new Date(s.updatedAt).toISOString())}
											</span>
										</button>
										<button
											className="icon-btn session-rename-btn"
											title="Rename chat"
											onClick={() => {
												setRenamingId(s.id);
												setRenameText(s.title);
											}}
										>
											<Pencil size={12} />
										</button>
										<button
											className="icon-btn session-delete"
											title="Delete chat"
											onClick={() => deleteSession(s.id)}
										>
											<Trash2 size={12} />
										</button>
									</div>
								);
							})}
						</div>
					</>
				)}

				<p className="section-label">Courses</p>
				<div className="sidebar-list">
					{courses.map((c, i) => (
						<NavLink
							key={c.id}
							to={`/courses/${c.id}`}
							ref={cursor.setRef(i + 1 + recentChats.length)}
							onMouseEnter={(e) => showTip(e, `${c.code} — ${c.name}`)}
							onMouseLeave={hideTip}
							className={({ isActive }) =>
								`nav-item${isActive ? " active" : ""}${cursor.cursor === i + 1 + recentChats.length ? " kbd-cursor" : ""}`
							}
							style={{
								borderLeft: `3px solid ${courseColor(c)}`,
								background: `linear-gradient(135deg, ${courseColor(c)}18 0%, transparent 60%)`,
							}}
						>
							<span className="side-label">{c.code}</span>
						</NavLink>
					))}
				</div>
			</div>

			<div className="sidebar-footer">
				<button
					className="nav-item sidebar-logout"
					onClick={onLogout}
					onMouseEnter={(e) => showTip(e, "Log out")}
					onMouseLeave={hideTip}
					title="Log out"
					aria-label="Log out"
				>
					<LogOut size={17} />
					<span className="side-label">Log out</span>
				</button>
			</div>

			{tip && (
				<div className="side-tip" style={{ left: tip.x, top: tip.y }}>
					{tip.label}
				</div>
			)}
		</aside>
	);
}
