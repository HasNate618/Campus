import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { ANNOUNCEMENTS, CONTENT_TREE, LECTURE_PARAS, LECTURE_TITLE, SYLLABUS_LINES, heroCourse } from "../data/demo";
import { Card, Chip, enter } from "./primitives";
import { Icon } from "./Icons";

/** course header + tab bar (active tab animates on switch) */
export const CourseHeader: React.FC<{
	active: "overview" | "content" | "assignments" | "workspace";
	compact?: boolean;
}> = ({ active, compact = false }) => {
	const frame = useCurrentFrame();
	const tabs = [
		{ id: "overview", label: "Overview" },
		{ id: "content", label: "Content" },
		{ id: "assignments", label: "Assignments" },
		{ id: "workspace", label: "Workspace" },
	] as const;
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 14,
				padding: "18px 26px 14px",
				borderBottom: `1px solid ${C.border}`,
				fontFamily: FONT.sans,
			}}
		>
			<span style={{ fontSize: 21, fontWeight: 800, color: C.text1, letterSpacing: "0.01em" }}>{heroCourse.code}</span>
			<Chip kind="grey">2026F</Chip>
			{!compact && <span style={{ fontSize: 14, color: C.text3, whiteSpace: "nowrap" }}>{heroCourse.name}</span>}
			<div style={{ marginLeft: compact ? 12 : 30, display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 11, padding: 4 }}>
				{tabs.map((t) => {
					const on = t.id === active;
					const since = active === t.id ? 0 : 999;
					const o = on ? 1 : 0.75;
					return (
						<div
							key={t.id}
							style={{
								padding: "6px 16px",
								borderRadius: 8,
								fontSize: 13.5,
								fontWeight: on ? 700 : 500,
								color: on ? C.text1 : C.text3,
								background: on ? C.primaryBg : "transparent",
								opacity: o,
								transform: `scale(${on && frame - since < 20 && frame >= since ? 1 : 1})`,
							}}
						>
							{t.label}
						</div>
					);
				})}
			</div>
			{!compact && (
				<div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
					<Chip>4 files</Chip>
					<Chip>2 assignments</Chip>
				</div>
			)}
		</div>
	);
};

export const OverviewBody: React.FC = () => {
	const frame = useCurrentFrame();
	return (
	<div style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 16, fontFamily: FONT.sans }}>
		<Card title="Announcements" icon={<Icon name="bell" size={14} color={C.text3} />} at={60}>
			<div style={{ display: "flex", flexDirection: "column" }}>
				{ANNOUNCEMENTS.map((a, i) => (
					<div
						key={a.title}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 14,
							padding: "11px 2px",
							borderBottom: i < ANNOUNCEMENTS.length - 1 ? `1px solid ${C.border}` : "none",
							...enter(frame, 66 + i * 8, { y: 6 }),
						}}
					>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontSize: 14.5, fontWeight: 600, color: C.text1 }}>{a.title}</div>
							<div style={{ fontSize: 13, color: C.text3, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 720 }}>
								{a.sub}
							</div>
						</div>
						<span style={{ marginLeft: "auto", flexShrink: 0 }}>
							<Chip>{a.ago}</Chip>
						</span>
					</div>
				))}
			</div>
		</Card>
		<Card title="Upcoming" icon={<Icon name="clock" size={14} color={C.text3} />} at={84}>
			{[
				{ t: "CS 1100A LAB", s: "29 Aug, 14:00 · Lab A", k: "class" as const },
				{ t: "Assignment 1 — Control Flow", s: "due 29 Aug, 23:59", k: "assignment" as const },
			].map((r) => (
				<div key={r.t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 2px" }}>
					<span style={{ fontSize: 14, fontWeight: 600, color: C.text1 }}>{r.t}</span>
					<span style={{ fontSize: 12.5, color: C.text3 }}>{r.s}</span>
					<span style={{ marginLeft: "auto" }}>
						<Chip kind={r.k === "class" ? "grey" : "violet"}>{r.k}</Chip>
					</span>
				</div>
			))}
		</Card>
	</div>
	);
};

const FileIcon: React.FC<{ kind: string }> = ({ kind }) => (
	<Icon name={kind === "dir" ? "folder" : kind === "pdf" ? "pdf" : "fileText"} size={14} color={kind === "dir" ? C.text3 : C.primaryDim} />
);

const TreeRow: React.FC<{
	name: string;
	kind: "dir" | "md" | "pdf";
	depth: number;
	selected?: boolean;
	at: number;
}> = ({ name, kind, depth, selected, at }) => {
	const frame = useCurrentFrame();
	return (
	<div
		style={{
			display: "flex",
			alignItems: "center",
			gap: 8,
			padding: "7px 10px",
			marginLeft: depth * 16,
			borderRadius: 8,
			background: selected ? C.primaryBg : "transparent",
			borderLeft: selected ? `2px solid ${C.primary}` : "2px solid transparent",
			fontSize: 13.5,
			fontWeight: kind === "dir" ? 600 : 500,
			color: selected ? C.text1 : kind === "dir" ? C.text2 : C.text3,
			fontFamily: FONT.sans,
			...enter(frame, at, { y: 4 }),
		}}
	>
		<FileIcon kind={kind} />
		<span style={{ whiteSpace: "nowrap" }}>{name}</span>
	</div>
	);
};

/** content tree — `selected` highlights one file */
export const ContentTree: React.FC<{ selected?: string; enterAt?: number }> = ({
	selected,
	enterAt = 0,
}) => (
	<div style={{ width: 330, flexShrink: 0, borderRight: `1px solid ${C.border}`, padding: "16px 12px", fontFamily: FONT.sans }}>
		{CONTENT_TREE.map((mod, i) => (
			<div key={mod.name} style={{ marginBottom: 4 }}>
				<TreeRow name={mod.name} kind="dir" depth={0} at={enterAt + i * 5} />
				{mod.children?.map((f, j) => (
					<TreeRow key={f.name} name={f.name} kind={f.kind} depth={1} selected={selected === f.name} at={enterAt + i * 5 + j + 1} />
				))}
			</div>
		))}
	</div>
);

/** zen markdown view of the syllabus; optional citation-line highlight + glow */
export const SyllabusView: React.FC<{
	highlightIdx?: number;
	glowAt?: number;
	enterAt?: number;
}> = ({ highlightIdx, glowAt, enterAt = 0 }) => {
	const frame = useCurrentFrame();
	const glow =
		glowAt !== undefined && frame >= glowAt
			? interpolate(frame, [glowAt, glowAt + 18], [0.25, 0.5], { extrapolateRight: "clamp" })
			: 0;
	return (
		<div style={{ flex: 1, overflow: "hidden", position: "relative", fontFamily: FONT.sans }}>
			<div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 44px", ...enter(frame, enterAt, { y: 10 }) }}>
				{SYLLABUS_LINES.map((l, i) => {
					const hl = highlightIdx === i;
					const body: React.CSSProperties =
						l.style === "h1"
							? { fontSize: 21, fontWeight: 700, color: C.text1, marginBottom: 12 }
							: l.style === "muted"
								? { fontSize: 13.5, color: C.text3, marginBottom: 18 }
								: l.style === "h2"
									? { fontSize: 14.5, fontWeight: 700, color: C.text2, marginTop: 24, marginBottom: 8 }
									: { fontSize: 15.5, lineHeight: 1.65, color: C.text1, marginBottom: 10 };
					return (
						<div
							key={i}
							style={{
								...body,
								...(hl
									? {
											background: `rgba(167,139,250,${0.12 + glow * 0.25})`,
											borderLeft: `3px solid ${C.primary}`,
											borderRadius: 8,
											padding: "10px 16px",
											marginLeft: -19,
											marginBottom: 12,
											boxShadow: glow > 0 ? `0 0 ${24 * glow + 8}px rgba(167,139,250,${glow})` : "none",
										}
									: {}),
							}}
						>
							{l.text}
						</div>
					);
				})}
			</div>
		</div>
	);
};

/** pageless lecture: continuous reflowed text + figure, scrolls itself */
export const PdfView: React.FC<{ scrollAt: number; enterAt?: number }> = ({ scrollAt, enterAt = 0 }) => {
	const frame = useCurrentFrame();
	const y = interpolate(frame, [scrollAt, scrollAt + 85], [0, -300], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: (e) => e,
	});
	return (
		<div style={{ flex: 1, overflow: "hidden", position: "relative", fontFamily: FONT.sans }}>
			<div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 44px", transform: `translateY(${y}px)`, ...enter(frame, enterAt, { y: 10 }) }}>
				<div style={{ fontSize: 20, fontWeight: 700, color: C.text1, marginBottom: 6 }}>{LECTURE_TITLE}</div>
				<div style={{ fontSize: 13, color: C.text3, marginBottom: 22 }}>CS 1100A · Module 2 · synced 27 Aug</div>
				{LECTURE_PARAS.map((p, i) => (
					<p key={i} style={{ fontSize: 15.5, lineHeight: 1.7, color: C.text2, margin: "0 0 16px" }}>
						{p}
					</p>
				))}
				<div style={{ background: C.cardSolid, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginTop: 8 }}>
					{[72, 48, 86, 60, 34].map((w, i) => (
						<div key={i} style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 64, marginBottom: 8 }}>
							{[38, 64, 50, 78, 44].map((h, j) => (
								<div
									key={j}
									style={{
										width: 26,
										height: `${h * (0.5 + ((i * 7 + j * 13) % 50) / 100)}%`,
										background: j === 3 ? "rgba(167,139,250,0.45)" : "rgba(255,255,255,0.10)",
										borderRadius: 4,
									}}
								/>
							))}
						</div>
					))}
					<div style={{ fontSize: 12, color: C.text3, marginTop: 8 }}>Fig. 2 — Assertion outcomes vs. test count</div>
				</div>
				<p style={{ fontSize: 15.5, lineHeight: 1.7, color: C.text2, margin: "18px 0 0" }}>
					{LECTURE_PARAS[0]}
				</p>
			</div>
			<div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 40, background: `linear-gradient(${C.bg}, transparent)`, pointerEvents: "none" }} />
		</div>
	);
};
