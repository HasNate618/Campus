import type React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";

export type ToolState = "hidden" | "running" | "done";

const TOOL_LABELS: Record<string, string> = {
	content_grep: "content_grep",
	harness_list_assignments: "harness_list_assignments",
	mutate_update_assignment: "mutate_update_assignment",
	quiz_start: "quiz_start",
	quiz_grade: "quiz_grade",
};

/** one row inside the expanded steps card */
export const ToolRow: React.FC<{
	tool: string;
	args?: string;
	state: ToolState;
	appearAt: number;
	doneLabel?: string;
}> = ({ tool, args, state, appearAt, doneLabel }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({
		frame: frame - appearAt,
		fps,
		config: SPRING.snappy,
	});
	if (s <= 0.01) return null;
	const done = state === "done";
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				opacity: s,
				transform: `translateY(${(1 - s) * 6}px)`,
				fontFamily: FONT.mono,
				fontSize: 12.5,
				color: done ? C.text2 : C.text3,
			}}
		>
			<Spinner done={done} />
			<span style={{ color: C.primaryDim }}>{TOOL_LABELS[tool] ?? tool}</span>
			{args && <span style={{ color: C.text3 }}>{args}</span>}
			{done && doneLabel && (
				<span style={{ color: C.green, marginLeft: "auto", fontSize: 12 }}>
					{doneLabel}
				</span>
			)}
		</div>
	);
};

/** spinner that morphs into a green check */
export const Spinner: React.FC<{ done: boolean; size?: number }> = ({
	done,
	size = 13,
}) => {
	const frame = useCurrentFrame();
	if (done) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				style={{ flexShrink: 0 }}
			>
				<path
					d="M5 12.5 10 17.5 19 7"
					fill="none"
					stroke={C.green}
					strokeWidth={3}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		);
	}
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			style={{ transform: `rotate(${frame * 7}deg)`, flexShrink: 0 }}
		>
			<circle
				cx="12"
				cy="12"
				r="9"
				fill="none"
				stroke={C.text3}
				strokeWidth="2.5"
				strokeDasharray="14 42"
				strokeLinecap="round"
			/>
		</svg>
	);
};

/** the collapsible "1 step · 1 tool call" chip */
export const StepsChip: React.FC<{
	at: number;
	expandAt?: number;
	expanded?: React.ReactNode;
	label?: string;
}> = ({ at, expandAt, expanded, label = "1 step · 1 tool call" }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.snappy });
	if (s <= 0.01) return null;
	const open = expandAt !== undefined && frame >= expandAt;
	return (
		<div style={{ opacity: s, transform: `translateY(${(1 - s) * 6}px)` }}>
			<div
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 7,
					background: "rgba(255,255,255,0.05)",
					border: `1px solid ${C.border}`,
					borderRadius: 999,
					padding: "5px 12px",
					fontFamily: FONT.mono,
					fontSize: 12.5,
					color: C.text2,
				}}
			>
				<svg width={12} height={12} viewBox="0 0 24 24">
					<circle
						cx="12"
						cy="12"
						r="9"
						fill="none"
						stroke={C.primaryDim}
						strokeWidth="2"
					/>
					<path
						d="M12 7v5l3 3"
						stroke={C.primaryDim}
						strokeWidth="2"
						fill="none"
						strokeLinecap="round"
					/>
				</svg>
				{label}
				{open ? (
					<svg width={11} height={11} viewBox="0 0 24 24">
						<path
							d="m6 15 6-6 6 6"
							stroke={C.text3}
							strokeWidth="2.4"
							fill="none"
							strokeLinecap="round"
						/>
					</svg>
				) : (
					<svg width={11} height={11} viewBox="0 0 24 24">
						<path
							d="m6 9 6 6 6-6"
							stroke={C.text3}
							strokeWidth="2.4"
							fill="none"
							strokeLinecap="round"
						/>
					</svg>
				)}
			</div>
			{open && expanded && (
				<div
					style={{
						marginTop: 8,
						background: "rgba(255,255,255,0.03)",
						border: `1px solid ${C.border}`,
						borderRadius: 12,
						padding: "12px 14px",
						display: "flex",
						flexDirection: "column",
						gap: 9,
					}}
				>
					{expanded}
				</div>
			)}
		</div>
	);
};
