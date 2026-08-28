import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { CAPTIONS } from "../data/demo";
import { C, FONT } from "../theme";

/**
 * Global caption track — bottom-left chip, rise+fade in, fade out.
 * Key noun (accent) tinted violet. Lives OUTSIDE the camera so zooms
 * never move it; owns the bottom 120px safe area.
 */
export const CaptionTrack: React.FC = () => {
	const frame = useCurrentFrame();
	const cap = CAPTIONS.find((c) => frame >= c.from && frame < c.to);
	if (!cap) return null;
	const local = frame - cap.from;
	const dur = cap.to - cap.from;
	const opacity =
		local < 8
			? interpolate(local, [0, 8], [0, 1])
			: dur - local < 6
				? interpolate(dur - local, [0, 6], [0, 1])
				: 1;
	const rise = local < 8 ? interpolate(local, [0, 8], [18, 0]) : 0;

	// split text on the accent phrase for tinting
	const parts: React.ReactNode[] = [];
	if (cap.accent && cap.text.includes(cap.accent)) {
		const [a, ...rest] = cap.text.split(cap.accent);
		parts.push(a);
		parts.push(
			<span key="acc" style={{ color: C.primary }}>
				{cap.accent}
			</span>,
		);
		parts.push(rest.join(cap.accent));
	} else {
		parts.push(cap.text);
	}

	return (
		<AbsoluteFill style={{ pointerEvents: "none" }}>
			<div
				style={{
					position: "absolute",
					left: 64,
					bottom: 44,
					opacity,
					transform: `translateY(${rise}px)`,
					background: "rgba(10,10,15,0.85)",
					border: `1px solid ${C.border}`,
					borderRadius: 12,
					padding: "12px 20px",
					fontFamily: FONT.sans,
					fontWeight: 600,
					fontSize: 29,
					lineHeight: 1.25,
					color: C.text1,
					maxWidth: 1400,
					boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
				}}
			>
				{parts}
			</div>
		</AbsoluteFill>
	);
};
