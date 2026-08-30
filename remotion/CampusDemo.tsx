import type React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { T } from "./data/demo";
import { S0Logo, S9Close } from "./scenes/OpenClose";
import { SfxTrack } from "./motion/Sfx";
import { CaptionTrack } from "./motion/Caption";
import { Fonts } from "./ui/Fonts";
import { MacWindow } from "./ui/MacWindow";

const scene = (from: number, durationInFrames: number, Component: React.FC) => {
	return (
		<Sequence
			key={from}
			from={from}
			durationInFrames={durationInFrames}
			name={`S@${from}`}
		>
			<Component />
		</Sequence>
	);
};

const CUTS = [T.home, T.sync, T.course, T.s6, T.s7, T.s8, T.s9];

const SceneCuts: React.FC = () => {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill style={{ pointerEvents: "none" }}>
			{CUTS.map((at) => (
				<AbsoluteFill
					key={at}
					style={{
						opacity: interpolate(frame, [at - 7, at, at + 13], [0, 0.24, 0], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
						background:
							"linear-gradient(105deg, transparent 18%, rgba(167,139,250,0.7) 50%, transparent 82%)",
						mixBlendMode: "screen",
					}}
				/>
			))}
		</AbsoluteFill>
	);
};

/**
 * Campus — 42.7 s product demo built from the captured production UI.
 * The app is presented inside a focused macOS-style window.
 */
export const CampusDemo: React.FC = () => (
	<AbsoluteFill
		style={{
			background:
				"radial-gradient(900px 620px at 50% 42%, #211d45 0%, #100f1b 48%, #07070b 100%)",
			fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
		}}
	>
		<Fonts />
		<MacWindow />
		{scene(T.s0, T.home - T.s0, S0Logo)}
		{scene(T.s9, T.end - T.s9, S9Close)}
		<SceneCuts />
		<CaptionTrack />
		<SfxTrack />
	</AbsoluteFill>
);
