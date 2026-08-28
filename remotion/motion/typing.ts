/**
 * Deterministic typing/streaming cadence.
 * The same functions drive what the viewer sees (TypeText/StreamText) and
 * what they hear (SfxTrack keystroke ticks) — video and audio can't drift.
 */

/** seeded PRNG (mulberry32) — renders are byte-deterministic */
export function rng(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const PAUSE: Record<string, number> = {
	",": 3,
	";": 4,
	"?": 6,
	"!": 6,
	".": 9,
	"\u2014": 6,
	":": 3,
};

export type CadenceOpts = {
	seed?: number;
	/** frames per character (default 3 ≈ 45ms) */
	base?: number;
	/** extra per-char jitter 0..jit (default 2) */
	jit?: number;
};

/**
 * Frame index at which each character of `text` appears.
 * `base`/`jit` overrides let fast surfaces (digest, sync log) match their
 * SFX cue windows exactly.
 */
export function typeCadence(
	text: string,
	start: number,
	{ seed = 7, base = 3, jit = 2 }: CadenceOpts = {},
): number[] {
	const r = rng(seed);
	let t = start;
	const out: number[] = [];
	for (const ch of text) {
		out.push(Math.round(t));
		t += base + r() * jit + (PAUSE[ch] ?? 0);
	}
	return out;
}

export function typedCount(times: number[], frame: number): number {
	let n = 0;
	while (n < times.length && times[n] <= frame) n++;
	return n;
}

/** last typed frame (for caret logic / sfx end) */
export function cadenceEnd(times: number[]): number {
	return times.length ? (times.at(-1) as number) : 0;
}

/** word-chunk streaming times (~60 chars/s: a token every 3–4f) */
export function streamCues(text: string, start: number, seed = 11): number[] {
	const r = rng(seed);
	const tokens = text.split(/(?<=\s)|(?<=—)/);
	const out: number[] = [];
	let t = start;
	for (const tok of tokens) {
		out.push(Math.round(t));
		t += 3 + r() * 1.6 + (tok.includes("\u2014") ? 4 : 0);
	}
	return out;
}
