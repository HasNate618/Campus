import type React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { T } from "./data/demo";
import { S0Logo, S1Problem, S9Close } from "./scenes/OpenClose";
import { S2Home, S3Sync, S4Content, S5Schedule } from "./scenes/Middle";
import { S6Cite, S7Act, S8Quiz } from "./scenes/Agent";
import { SfxTrack } from "./motion/Sfx";
import { CaptionTrack } from "./motion/Caption";
import { Fonts } from "./ui/Fonts";

const scene = (from: number, Component: React.FC) => {
	const nexts = Object.values(T).filter((v) => v > from);
	const dur = (nexts.length ? Math.min(...nexts) : T.end) - from;
	return (
		<Sequence key={from} from={from} durationInFrames={dur} name={`S@${from}`}>
			<Component />
		</Sequence>
	);
};

/**
 * Campus — 88 s product demo (90 BPM beat grid, SFX, captions).
 * Scene boundaries all land on bar lines so a music bed drops in aligned.
 */
export const CampusDemo: React.FC = () => (
	<AbsoluteFill
		style={{
			background: "#000",
			fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
		}}
	>
		<Fonts />
		{scene(T.s0, S0Logo)}
		{scene(T.s1, S1Problem)}
		{scene(T.s2, S2Home)}
		{scene(T.s3, S3Sync)}
		{scene(T.s4, S4Content)}
		{scene(T.s5, S5Schedule)}
		{scene(T.s6, S6Cite)}
		{scene(T.s7, S7Act)}
		{scene(T.s8, S8Quiz)}
		{scene(T.s9, S9Close)}
		<CaptionTrack />
		<SfxTrack />
	</AbsoluteFill>
);
