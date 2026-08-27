import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const HUMAN_LABELS: Record<string, string> = {
	search_corpus: "Searching your notes",
	mutate: "Updating assignment",
	"search_corpus ✓ 3 sources": "Found 3 sources",
	"mutate ✓ Aug 31": "Moved to Aug 31",
};

function humanize(label: string): string {
	if (HUMAN_LABELS[label]) return HUMAN_LABELS[label];
	return label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ToolChip: React.FC<{
	label: string;
	state?: "running" | "done";
	delay?: number;
}> = ({ label, state = "done", delay = 0 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({
		frame: Math.max(0, frame - delay),
		fps,
		config: { damping: 16, stiffness: 160 },
	});
	const scale = interpolate(s, [0, 1], [0.92, 1]);
	const opacity = interpolate(s, [0, 1], [0, 1]);
	const displayLabel = humanize(label);

	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				background: state === "running" ? "#1f2937" : "#064e3b",
				color: state === "running" ? "#e5e7eb" : "#a7f3d0",
				border: `1px solid ${state === "running" ? "#374151" : "#10b981"}`,
				borderRadius: 999,
				padding: "6px 12px",
				fontFamily: "Inter, system-ui, sans-serif",
				fontWeight: 600,
				fontSize: 16,
				letterSpacing: "0.02em",
				opacity,
				transform: `scale(${scale})`,
			}}
		>
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: 999,
					background: state === "running" ? "#facc15" : "#10b981",
					boxShadow:
						state === "running"
							? "0 0 0 2px rgba(250,204,21,0.35)"
							: "0 0 0 2px rgba(16,185,129,0.35)",
				}}
			/>
			{displayLabel}
			{state === "done" ? " ✓" : " …"}
		</span>
	);
};

export const ToolChipRow: React.FC<{
	chips: Array<{ label: string; state?: "running" | "done" }>;
	stagger?: number;
}> = ({ chips, stagger = 18 }) => {
	return (
		<div
			style={{
				display: "flex",
				gap: 10,
				flexWrap: "wrap",
				alignItems: "center",
			}}
		>
			{chips.map((c, i) => (
				<ToolChip
					key={c.label}
					label={c.label}
					state={c.state}
					delay={i * stagger}
				/>
			))}
		</div>
	);
};
