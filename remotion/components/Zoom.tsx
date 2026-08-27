import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Zoom: React.FC<{
	children: React.ReactNode;
	from?: number;
	to: number;
	center?: [number, number]; // 0-1
	holdFrames?: number; // static hold before zoom starts (60-90f = 1-1.5s)
}> = ({ children, from = 1, to, center = [0.5, 0.5], holdFrames = 0 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const zoomFrame = Math.max(0, frame - holdFrames);
	const p = spring({
		frame: zoomFrame,
		fps,
		config: { damping: 18, stiffness: 90 },
	});
	// hold phase: scale stays at `from` until holdFrames passes
	const scale = frame < holdFrames ? from : interpolate(p, [0, 1], [from, to]);
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				transform: `scale(${scale})`,
				transformOrigin: `${center[0] * 100}% ${center[1] * 100}%`,
				willChange: "transform",
			}}
		>
			{children}
		</div>
	);
};
