import type React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { CUES, type Cue } from "../data/demo";
import { S6_Q, S7_MSG, S8_ANSWER, S8_MSG, DIGEST } from "../data/demo";
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
	// S2 digest bullets (base 2.2 cadence — matches HomeScreen typing)
	...DIGEST.flatMap((b, i) =>
		tickCues(b, 770 + i * 95, {
			seed: 21 + i,
			vol: 0.1,
			every: 3,
			base: 2.2,
			jit: 1,
		}).filter((c) => c.at < 770 + i * 95 + 90),
	),
	// S6 question typing (global = T.s6 + local)
	...tickCues(S6_Q, 2720 + 80, { seed: 31, vol: 0.13 }),
	// S7 message typing (base 2.5 — fits the 60–250 window)
	...tickCues(S7_MSG, 3680 + 60, { seed: 37, vol: 0.13, every: 3, base: 2.5 }),
	// S8 message + answer typing
	...tickCues(S8_MSG, 4320 + 40, { seed: 41, vol: 0.13 }),
	...tickCues(S8_ANSWER, 4320 + 245, {
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
