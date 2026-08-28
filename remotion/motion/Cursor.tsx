import type React from "react";
import {
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { C } from "../theme";

export type CursorStop = { at: number; x: number; y: number; click?: boolean };

/**
 * Cursor that eases between stops (cubic) with optional click ripples.
 * Coordinates are frame px — place INSIDE the Camera so it tracks the UI.
 */
export const Cursor: React.FC<{
	stops: CursorStop[];
	hideAfter?: number;
}> = ({ stops, hideAfter }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const sorted = [...stops].sort((a, b) => a.at - b.at);

	// find position: eased segment between surrounding stops
	let x = sorted[0]?.x ?? 960;
	let y = sorted[0]?.y ?? 540;
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (frame >= b.at) {
			x = b.x;
			y = b.y;
		} else if (frame >= a.at) {
			const p = Easing.inOut(Easing.cubic)((frame - a.at) / (b.at - a.at));
			x = interpolate(p, [0, 1], [a.x, b.x]);
			y = interpolate(p, [0, 1], [a.y, b.y]);
			break;
		}
	}

	const clicks = stops.filter((s) => s.click);
	const gone = hideAfter !== undefined && frame >= hideAfter;
	const s = spring({
		frame,
		fps,
		config: { damping: 20, stiffness: 200 },
		durationInFrames: 14,
	});

	return (
		<div
			style={{
				position: "absolute",
				left: x,
				top: y,
				opacity: gone ? 0 : s,
				pointerEvents: "none",
			}}
		>
			<svg
				width={26}
				height={26}
				viewBox="0 0 24 24"
				style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}
			>
				<path
					d="M5 3l14 8.5-6.2 1.4L15.5 20l-2.6 1.2-2.7-7.1L5 18.5z"
					fill="#fff"
					stroke="#0b0a0f"
					strokeWidth="1.2"
				/>
			</svg>
			{clicks.map((c, i) => {
				const cf = frame - c.at;
				if (cf < 0 || cf > 18) return null;
				const r = interpolate(cf, [0, 18], [8, 34]);
				const o = interpolate(cf, [0, 18], [0.7, 0]);
				return (
					<div
						key={i}
						style={{
							position: "absolute",
							left: -r + 6,
							top: -r + 4,
							width: r * 2,
							height: r * 2,
							borderRadius: 999,
							border: `2px solid ${C.primary}`,
							opacity: o,
						}}
					/>
				);
			})}
		</div>
	);
};
