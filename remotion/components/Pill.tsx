import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Pill: React.FC<{ text: string; durationInFrames?: number }> = ({
	text,
	durationInFrames,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const enter = spring({ frame, fps, config: { damping: 18, stiffness: 180 } });
	const y = interpolate(enter, [0, 1], [16, 0]);
	let opacity = interpolate(enter, [0, 1], [0, 1]);
	if (durationInFrames !== undefined) {
		const exitStart = Math.max(0, durationInFrames - 12);
		const exit = interpolate(frame, [exitStart, durationInFrames], [1, 0], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		opacity = Math.min(opacity, exit);
	}

	return (
		<div
			style={{
				position: "absolute",
				left: "50%",
				bottom: 88,
				transform: `translateX(-50%) translateY(${y}px)`,
				background: "rgba(14,14,16,0.86)",
				color: "white",
				fontFamily: "Inter, system-ui, sans-serif",
				fontWeight: 700,
				fontSize: 26,
				letterSpacing: "-0.01em",
				padding: "14px 26px",
				borderRadius: 999,
				opacity,
				border: "1px solid rgba(255,255,255,0.08)",
				boxShadow: "0 10px 28px rgba(0,0,0,0.38)",
				maxWidth: "86vw",
				textAlign: "center",
				whiteSpace: "nowrap",
			}}
		>
			{text}
		</div>
	);
};
