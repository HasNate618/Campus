import type React from "react";
import { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

export type CamMove = {
	start: number;
	end: number;
	s: number; // target scale
	cx: number; // target center x (0-1)
	cy: number;
};

/**
 * Virtual camera: piecewise zoom/pan over live UI. Each move eases both
 * scale and origin from the previous state, so chained moves never jump.
 */
export const Camera: React.FC<{
	moves: CamMove[];
	children: React.ReactNode;
}> = ({ moves, children }) => {
	const frame = useCurrentFrame();

	const state = useMemo(() => {
		let prev = { s: 1, cx: 0.5, cy: 0.5 };
		let cur = prev;
		const sorted = [...moves].sort((a, b) => a.start - b.start);
		for (const m of sorted) {
			if (frame < m.start) break;
			const p = Easing.inOut(Easing.cubic)(
				Math.min(1, (frame - m.start) / Math.max(1, m.end - m.start)),
			);
			cur = {
				s: interpolate(p, [0, 1], [prev.s, m.s]),
				cx: interpolate(p, [0, 1], [prev.cx, m.cx]),
				cy: interpolate(p, [0, 1], [prev.cy, m.cy]),
			};
			if (frame >= m.end) prev = { s: m.s, cx: m.cx, cy: m.cy };
		}
		return cur;
	}, [frame, moves]);

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				transform: `scale(${state.s})`,
				transformOrigin: `${state.cx * 100}% ${state.cy * 100}%`,
				willChange: "transform",
			}}
		>
			{children}
		</div>
	);
};
