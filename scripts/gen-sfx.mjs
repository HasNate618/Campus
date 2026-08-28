#!/usr/bin/env node
/**
 * Deterministic SFX synthesizer for the Campus demo video.
 * Generates 48 kHz mono 16-bit WAVs into public/sfx/ — no samples, no
 * licensing, reproducible renders. Run: node scripts/gen-sfx.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SR = 48000;
const OUT = join(process.cwd(), "public", "sfx");
mkdirSync(OUT, { recursive: true });

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────
const rng = (seed) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const sec = (s) => Math.round(s * SR);

// ── synth helpers ────────────────────────────────────────────────────────
/** one-pole lowpass with per-sample cutoff */
function lowpass(samples, cutoffFn) {
	const out = new Float32Array(samples.length);
	let y = 0;
	for (let i = 0; i < samples.length; i++) {
		const fc = cutoffFn(i / SR);
		const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
		y += a * (samples[i] - y);
		out[i] = y;
	}
	return out;
}

function highpass(samples, cutoff) {
	const lp = lowpass(samples, () => cutoff);
	const out = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) out[i] = samples[i] - lp[i];
	return out;
}

/** tonal voice: freqFn(t)->Hz, exp decay tau, optional harmonics + vibrato */
function voice({
	dur,
	freqFn,
	tau,
	attack = 0.002,
	harmonics = [[1, 1]],
	vibHz = 0,
	vibAmt = 0,
	rnd,
}) {
	const n = sec(dur);
	const out = new Float32Array(n);
	let phase = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		let f = freqFn(t);
		if (vibHz) f *= 1 + vibAmt * Math.sin(2 * Math.PI * vibHz * t);
		phase += (2 * Math.PI * f) / SR;
		const env = t < attack ? t / attack : Math.exp(-(t - attack) / tau);
		let s = 0;
		for (const [m, amp] of harmonics) s += amp * Math.sin(m * phase);
		out[i] = s * env;
	}
	return out;
}

function noise({ dur, rnd }) {
	const n = sec(dur);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
	return out;
}

function mixAt(dst, src, atSec, gain = 1) {
	const off = sec(atSec);
	for (let i = 0; i < src.length; i++) {
		const j = off + i;
		if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
	}
	return dst;
}

function ampEnv(samples, { attack = 0.005, tau = 0.1, sustain = 1 }) {
	const out = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		const t = i / SR;
		const a = t < attack ? t / attack : 1;
		const d = Math.exp(-Math.max(0, t - attack) / tau);
		out[i] = samples[i] * a * d * sustain;
	}
	return out;
}

function normalize(samples, peak) {
	let max = 0;
	for (const v of samples) max = Math.max(max, Math.abs(v));
	const g = max > 0 ? peak / max : 1;
	for (let i = 0; i < samples.length; i++) samples[i] *= g;
	return samples;
}

function writeWav(name, samples) {
	const n = samples.length;
	const buf = Buffer.alloc(44 + n * 2);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(SR, 24);
	buf.writeUInt32LE(SR * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) {
		const v = Math.max(-1, Math.min(1, samples[i]));
		buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
	}
	writeFileSync(join(OUT, name), buf);
	return { name, dur: +(n / SR).toFixed(2), kb: Math.round(buf.length / 1024) };
}

// ── the kit ──────────────────────────────────────────────────────────────
const made = [];
{
	// click — cursor click: bright tick + micro noise transient
	const r = rng(1);
	const s = new Float32Array(sec(0.09));
	mixAt(
		s,
		voice({
			dur: 0.05,
			freqFn: () => 1650,
			tau: 0.012,
			harmonics: [
				[1, 1],
				[2.7, 0.3],
			],
		}),
		0,
		0.9,
	);
	mixAt(
		s,
		ampEnv(noise({ dur: 0.02, rnd: r }), { attack: 0.001, tau: 0.006 }),
		0,
		0.5,
	);
	made.push(writeWav("click.wav", normalize(s, 0.5)));
}
{
	// type — soft keystroke tick
	const s = new Float32Array(sec(0.055));
	mixAt(
		s,
		voice({
			dur: 0.045,
			freqFn: () => 1150,
			tau: 0.009,
			harmonics: [
				[1, 1],
				[2.2, 0.25],
			],
		}),
		0,
		0.85,
	);
	const r = rng(2);
	mixAt(
		s,
		ampEnv(noise({ dur: 0.012, rnd: r }), { attack: 0.001, tau: 0.004 }),
		0,
		0.28,
	);
	made.push(writeWav("type.wav", normalize(s, 0.4)));
}
{
	// card — entrance pop (sine blip rising, quick decay)
	const s = new Float32Array(sec(0.22));
	mixAt(
		s,
		voice({
			dur: 0.18,
			freqFn: (t) => 470 + 210 * Math.min(1, t / 0.035),
			tau: 0.05,
			harmonics: [
				[1, 1],
				[2, 0.2],
			],
		}),
		0,
		0.9,
	);
	mixAt(s, voice({ dur: 0.03, freqFn: () => 1800, tau: 0.008 }), 0, 0.3);
	made.push(writeWav("card.wav", normalize(s, 0.42)));
}
{
	// send — message send: up-sweep
	const s = new Float32Array(sec(0.24));
	mixAt(
		s,
		voice({
			dur: 0.22,
			freqFn: (t) => 330 + 560 * Math.min(1, t / 0.12),
			tau: 0.09,
			harmonics: [
				[1, 1],
				[2, 0.18],
			],
			vibHz: 7,
			vibAmt: 0.008,
		}),
		0,
		0.95,
	);
	made.push(writeWav("send.wav", normalize(s, 0.42)));
}
{
	// run — tool start: double tick
	const s = new Float32Array(sec(0.3));
	for (const at of [0, 0.1]) {
		mixAt(
			s,
			voice({
				dur: 0.06,
				freqFn: () => 1420,
				tau: 0.014,
				harmonics: [
					[1, 1],
					[2.4, 0.25],
				],
			}),
			at,
			0.8,
		);
	}
	made.push(writeWav("run.wav", normalize(s, 0.4)));
}
{
	// done — success: two-note blip 880 -> 1318
	const s = new Float32Array(sec(0.4));
	mixAt(
		s,
		voice({
			dur: 0.12,
			freqFn: () => 880,
			tau: 0.05,
			harmonics: [
				[1, 1],
				[2, 0.2],
			],
		}),
		0,
		0.7,
	);
	mixAt(
		s,
		voice({
			dur: 0.28,
			freqFn: () => 1318.5,
			tau: 0.12,
			harmonics: [
				[1, 1],
				[2, 0.22],
				[3, 0.06],
			],
		}),
		0.09,
		0.85,
	);
	made.push(writeWav("done.wav", normalize(s, 0.42)));
}
{
	// flash — citation land: bright ping + shimmer splash
	const r = rng(3);
	const s = new Float32Array(sec(0.45));
	mixAt(
		s,
		voice({
			dur: 0.35,
			freqFn: () => 2093,
			tau: 0.1,
			harmonics: [
				[1, 1],
				[1.5, 0.3],
			],
		}),
		0,
		0.8,
	);
	mixAt(s, voice({ dur: 0.3, freqFn: () => 3136, tau: 0.16 }), 0.015, 0.25);
	mixAt(
		s,
		ampEnv(highpass(noise({ dur: 0.06, rnd: r }), 4000), {
			attack: 0.002,
			tau: 0.02,
		}),
		0,
		0.35,
	);
	made.push(writeWav("flash.wav", normalize(s, 0.45)));
}
{
	// flip — due-date flip: down-up pitch bend
	const s = new Float32Array(sec(0.32));
	mixAt(
		s,
		voice({
			dur: 0.3,
			freqFn: (t) =>
				t < 0.09
					? 640 - 260 * (t / 0.09)
					: 380 + 360 * Math.min(1, (t - 0.09) / 0.11),
			tau: 0.13,
			harmonics: [
				[1, 1],
				[2, 0.15],
			],
		}),
		0,
		0.95,
	);
	made.push(writeWav("flip.wav", normalize(s, 0.42)));
}
{
	// stamp — thunk + confirmation chime tail
	const r = rng(4);
	const s = new Float32Array(sec(0.55));
	mixAt(
		s,
		voice({
			dur: 0.3,
			freqFn: () => 84,
			tau: 0.1,
			harmonics: [
				[1, 1],
				[2.02, 0.4],
			],
		}),
		0,
		1.0,
	);
	mixAt(s, voice({ dur: 0.14, freqFn: () => 172, tau: 0.05 }), 0, 0.5);
	mixAt(
		s,
		ampEnv(
			lowpass(noise({ dur: 0.05, rnd: r }), () => 2800),
			{ attack: 0.001, tau: 0.02 },
		),
		0,
		0.65,
	);
	mixAt(
		s,
		voice({
			dur: 0.3,
			freqFn: () => 1046.5,
			tau: 0.2,
			harmonics: [
				[1, 1],
				[2, 0.2],
			],
		}),
		0.2,
		0.28,
	);
	made.push(writeWav("stamp.wav", normalize(s, 0.62)));
}
{
	// slide — pane slide-in: noise sweep down + low body
	const r = rng(5);
	let n = noise({ dur: 0.4, rnd: r });
	n = lowpass(n, (t) => 3800 * Math.exp(-t / 0.09) + 240);
	const s = ampEnv(n, { attack: 0.03, tau: 0.16 });
	mixAt(
		s,
		voice({
			dur: 0.3,
			freqFn: () => 196,
			tau: 0.14,
			harmonics: [
				[1, 1],
				[2, 0.2],
			],
		}),
		0,
		0.3,
	);
	made.push(writeWav("slide.wav", normalize(s, 0.4)));
}
{
	// whoosh — transition wipe: band sweep
	const r = rng(6);
	let n = noise({ dur: 0.5, rnd: r });
	n = highpass(
		lowpass(n, (t) => 400 + 3200 * Math.sin(Math.PI * Math.min(1, t / 0.45))),
		180,
	);
	const s = ampEnv(n, { attack: 0.12, tau: 0.16 });
	made.push(writeWav("whoosh.wav", normalize(s, 0.4)));
}
{
	// reveal — app reveal: airy swell
	const r = rng(7);
	let n = noise({ dur: 0.9, rnd: r });
	n = lowpass(n, (t) => 180 + 2400 * Math.min(1, t / 0.55));
	const s = ampEnv(n, { attack: 0.3, tau: 0.42 });
	mixAt(
		s,
		voice({
			dur: 0.7,
			freqFn: (t) => 262 + 130 * Math.min(1, t / 0.4),
			tau: 0.3,
			harmonics: [
				[1, 1],
				[2, 0.3],
			],
		}),
		0,
		0.22,
	);
	made.push(writeWav("reveal.wav", normalize(s, 0.38)));
}
{
	// sting — logo glint: bell ping with harmonics
	const s = new Float32Array(sec(0.8));
	mixAt(
		s,
		voice({
			dur: 0.7,
			freqFn: () => 1568,
			tau: 0.2,
			harmonics: [
				[1, 1],
				[1.5, 0.35],
				[2.76, 0.12],
			],
		}),
		0,
		0.85,
	);
	mixAt(
		s,
		voice({
			dur: 0.6,
			freqFn: () => 523.25,
			tau: 0.26,
			harmonics: [
				[1, 1],
				[2, 0.25],
			],
		}),
		0.02,
		0.3,
	);
	made.push(writeWav("sting.wav", normalize(s, 0.5)));
}
{
	// glide — camera push: quiet airy movement
	const r = rng(8);
	let n = noise({ dur: 0.45, rnd: r });
	n = lowpass(n, (t) => 600 + 1400 * Math.sin(Math.PI * Math.min(1, t / 0.4)));
	const s = ampEnv(n, { attack: 0.1, tau: 0.14 });
	made.push(writeWav("glide.wav", normalize(s, 0.22)));
}

console.log(`wrote ${made.length} sfx files to public/sfx:`);
for (const m of made)
	console.log(
		`  ${m.name.padEnd(12)} ${String(m.dur).padStart(4)}s  ${m.kb} KB`,
	);
