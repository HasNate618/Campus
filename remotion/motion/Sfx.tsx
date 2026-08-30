import type React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { CUES, S6_Q, S7_MSG, S8_ANSWER, S8_MSG, T, type Cue } from "../data/demo";
import { typeCadence } from "./typing";

/**
 * Global SFX track. Hand-placed beats come from CUES (demo.ts);
 * keystroke ticks are derived from the SAME cadence the TypeText
 * components render with — picture and sound cannot drift.
 */
type TickOpts = {
	seed: number;
	vol?: number;
	every?: number;
	base?: number;
	jit?: number;
};
const tickCues = (text: string, start: number, opts: TickOpts): Cue[] =>
	typeCadence(text, start, {
		seed: opts.seed,
		base: opts.base,
		jit: opts.jit,
	})
		.filter((_, i) => i % (opts.every ?? 2) === 0)
		.map((at) => ({ at, sfx: "type", vol: opts.vol ?? 0.12 }));

const TYPING_CUES: Cue[] = [
	// These match keyboard.type() in capture-real-ui.mjs.
	...tickCues(S6_Q, T.s6 + 72, { seed: 31, vol: 0.13 }),
	...tickCues(S7_MSG, T.s7 + 20, { seed: 37, vol: 0.13, every: 3, base: 2.5 }),
	...tickCues(S8_MSG, T.s8 + 20, { seed: 41, vol: 0.13 }),
	...tickCues(S8_ANSWER, T.s8 + 250, {
		seed: 43,
		vol: 0.13,
		every: 2,
		base: 2.6,
		jit: 1,
	}),
];

export const SfxTrack: React.FC = () => {
	const all = [...CUES, ...TYPING_CUES];
	return (
		<AbsoluteFill>
			{all.map((c, i) => (
				<Sequence key={i} from={Math.round(c.at)} name={`sfx-${c.sfx}`}>
					<Audio src={staticFile(`sfx/${c.sfx}.wav`)} volume={c.vol ?? 0.4} />
				</Sequence>
			))}
		</AbsoluteFill>
	);
};
