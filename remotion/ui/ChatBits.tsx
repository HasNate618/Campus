import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";
import { AUDIT_DIFF, S6_LEAD, S6_PATH, S6_QUOTE, S6_TAIL } from "../data/demo";
import { Card, Chip, enter } from "./primitives";
import { Icon } from "./Icons";
import { StepsChip, ToolRow } from "../motion/ToolChip";
import { StreamText } from "../motion/StreamText";
import { TypeText } from "../motion/TypeText";

/** right-aligned user message */
export const UserBubble: React.FC<{ text: string; at: number }> = ({
	text,
	at,
}) => {
	const { fps } = useVideoConfig();
	const s = spring({
		frame: useCurrentFrame() - at,
		fps,
		config: SPRING.snappy,
	});
	if (s <= 0.01) return null;
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "flex-end",
				opacity: s,
				transform: `translateX(${(1 - s) * 26}px)`,
			}}
		>
			<div
				style={{
					background: C.primaryBg,
					border: "1px solid rgba(167,139,250,0.32)",
					borderRadius: "16px 16px 4px 16px",
					padding: "11px 18px",
					fontSize: 15.5,
					color: C.text1,
					maxWidth: "68%",
					fontFamily: FONT.sans,
					lineHeight: 1.5,
				}}
			>
				{text}
			</div>
		</div>
	);
};

/** violet citation path chip with a 1-frame landing flash */
export const CitationChip: React.FC<{ label: string; flashAt?: number }> = ({
	label,
	flashAt,
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const pop = spring({
		frame: frame - (flashAt ?? 0),
		fps,
		config: SPRING.snappy,
	});
	const flash =
		flashAt !== undefined
			? interpolate(frame, [flashAt, flashAt + 12], [1, 0], {
					extrapolateRight: "clamp",
					extrapolateLeft: "clamp",
				})
			: 0;
	const appear = frame >= (flashAt ?? 0) - 999;
	return (
		<span
			style={{
				display: "inline-block",
				fontFamily: FONT.mono,
				fontSize: 12.5,
				color: flash > 0.5 ? C.primary : C.text2,
				background: C.cardSolid,
				border: `1px solid ${flash > 0.3 ? C.primary : C.border2}`,
				borderRadius: 7,
				padding: "3px 9px",
				margin: "0 3px",
				verticalAlign: "middle",
				boxShadow:
					flash > 0
						? `0 0 ${18 * flash}px rgba(167,139,250,${0.7 * flash})`
						: "none",
				transform: `scale(${0.92 + 0.08 * pop})`,
				opacity: appear ? 1 : 0,
				whiteSpace: "nowrap",
			}}
		>
			{label}
		</span>
	);
};

/** assistant answer: lead → quote block (bar draws in) → tail with citation */
export const AnswerBlock: React.FC<{
	leadAt: number;
	quoteAt?: number;
	tailAt?: number;
	chipFlashAt?: number;
	compact?: boolean;
}> = ({ leadAt, quoteAt, tailAt, chipFlashAt }) => {
	const frame = useCurrentFrame();
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 12,
				fontSize: 15.5,
				color: C.text1,
				fontFamily: FONT.sans,
				lineHeight: 1.6,
			}}
		>
			<div>
				<StreamText text={S6_LEAD} start={leadAt} seed={61} />
			</div>
			{quoteAt !== undefined && frame >= quoteAt && (
				<div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
					<div
						style={{
							width: 3,
							borderRadius: 2,
							background: C.quoteBar,
							transformOrigin: "top",
							transform: `scaleY(${interpolate(frame, [quoteAt, quoteAt + 18], [0, 1], { extrapolateRight: "clamp" })})`,
						}}
					/>
					<div
						style={{
							background: "rgba(255,255,255,0.03)",
							borderRadius: "0 10px 10px 0",
							padding: "10px 16px",
							flex: 1,
						}}
					>
						<StreamText
							text={S6_QUOTE}
							start={quoteAt + 4}
							seed={63}
							style={{ color: C.text2 }}
						/>
					</div>
				</div>
			)}
			{tailAt !== undefined && frame >= tailAt && (
				<div>
					<StreamText
						text="That's in "
						start={tailAt}
						seed={65}
						style={{ color: C.text2 }}
					/>
					<CitationChip label={S6_PATH} flashAt={chipFlashAt} />
					<StreamText
						text={S6_TAIL}
						start={(chipFlashAt ?? tailAt) + 8}
						seed={67}
						style={{ color: C.text2 }}
					/>
				</div>
			)}
		</div>
	);
};

/** bottom input bar with typing + streaming states */
export const InputBar: React.FC<{
	typeStart?: number;
	typeText?: string;
	seed?: number;
	base?: number;
	sentAt?: number;
	busyUntil?: number;
}> = ({ typeStart, typeText = "", seed = 31, base = 3, sentAt, busyUntil }) => {
	const frame = useCurrentFrame();
	const typing =
		typeStart !== undefined &&
		frame >= typeStart &&
		(sentAt === undefined || frame < sentAt);
	const busy =
		busyUntil !== undefined && frame >= (sentAt ?? 0) && frame < busyUntil;
	const focused = typeStart !== undefined && frame >= typeStart - 20;
	return (
		<div style={{ padding: "0 26px 24px", fontFamily: FONT.sans }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 12,
					background: C.inputBg,
					border: `1px solid ${focused ? "rgba(167,139,250,0.45)" : C.border}`,
					borderRadius: 15,
					padding: "12px 16px",
					boxShadow: focused ? "0 0 0 3px rgba(167,139,250,0.08)" : "none",
				}}
			>
				<Icon name="plus" size={17} color={C.text3} />
				<div style={{ flex: 1, fontSize: 15, color: C.text1, minHeight: 22 }}>
					{typing ? (
						<TypeText
							text={typeText}
							start={typeStart}
							seed={seed}
							base={base}
						/>
					) : (
						<span style={{ color: C.text3 }}>Ask CS 1100A…</span>
					)}
				</div>
				<span
					style={{
						color: C.text3,
						display: "flex",
						alignItems: "center",
						gap: 5,
						fontSize: 13,
					}}
				>
					<Icon name="gear" size={14} />
					Default
					<svg width={10} height={10} viewBox="0 0 24 24">
						<path
							d="m6 9 6 6 6-6"
							stroke={C.text3}
							strokeWidth="2.4"
							fill="none"
							strokeLinecap="round"
						/>
					</svg>
				</span>
				<div
					style={{
						width: 36,
						height: 36,
						borderRadius: 999,
						background: C.primaryDim,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{busy ? (
						<svg
							width={16}
							height={16}
							viewBox="0 0 24 24"
							style={{ transform: `rotate(${frame * 8}deg)` }}
						>
							<circle
								cx="12"
								cy="12"
								r="8"
								fill="none"
								stroke="#fff"
								strokeWidth="2.5"
								strokeDasharray="12 38"
								strokeLinecap="round"
							/>
						</svg>
					) : (
						<Icon name="arrowUp" size={16} color="#fff" strokeWidth={2.4} />
					)}
				</div>
			</div>
		</div>
	);
};

/** quiz question card */
export const QuestionCard: React.FC<{ at: number; text: string }> = ({
	at,
	text,
}) => {
	const frame = useCurrentFrame();
	return (
		<div style={enter(frame, at, { y: 12 })}>
			<div
				style={{
					background: C.cardSolid,
					border: `1px solid ${C.border2}`,
					borderRadius: 12,
					padding: "13px 16px",
					display: "flex",
					gap: 12,
					alignItems: "flex-start",
				}}
			>
				<Chip kind="violet" font={FONT.mono} style={{ marginTop: 2 }}>
					Q1
				</Chip>
				<div
					style={{
						fontSize: 15.5,
						fontWeight: 600,
						color: C.text1,
						lineHeight: 1.5,
					}}
				>
					{text}
				</div>
			</div>
		</div>
	);
};

/** inline answer box the "student" types into */
export const AnswerBox: React.FC<{
	at: number;
	text: string;
	typeStart: number;
	seed?: number;
}> = ({ at, text, typeStart, seed = 43 }) => {
	const frame = useCurrentFrame();
	const active = frame >= typeStart - 15;
	return (
		<div style={{ ...enter(frame, at, { y: 10 }) }}>
			<div
				style={{
					border: `1px solid ${active ? "rgba(167,139,250,0.45)" : C.border2}`,
					borderRadius: 12,
					background: C.inputBg,
					padding: "11px 15px",
					fontSize: 15,
					color: C.text1,
					minHeight: 20,
					boxShadow: active ? "0 0 0 3px rgba(167,139,250,0.08)" : "none",
					fontFamily: FONT.sans,
				}}
			>
				<TypeText
					text={text}
					start={typeStart}
					seed={seed}
					base={2.6}
					jit={1}
				/>
			</div>
		</div>
	);
};

/** the blind-grade stamp */
export const Stamp: React.FC<{ at: number }> = ({ at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({
		frame: frame - at,
		fps,
		config: { damping: 12, stiffness: 210 },
	});
	if (s <= 0.01) return null;
	const scale = interpolate(s, [0, 1], [1.7, 1]);
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "flex-end",
				opacity: Math.min(1, s * 2),
			}}
		>
			<div
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 10,
					border: `2.5px solid ${C.green}`,
					color: C.greenText,
					background: "rgba(6,78,59,0.5)",
					borderRadius: 12,
					padding: "9px 20px",
					transform: `rotate(-4deg) scale(${scale})`,
					fontSize: 20,
					fontWeight: 800,
					fontFamily: FONT.sans,
					boxShadow: "0 6px 30px rgba(16,185,129,0.25)",
				}}
			>
				<Icon name="check" size={19} color={C.green} strokeWidth={3.2} />
				correct
			</div>
		</div>
	);
};

/** the audit_log diff card (S7 right side) */
export const AuditCard: React.FC<{ at: number }> = ({ at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.soft });
	if (s <= 0.01) return null;
	return (
		<div
			style={{
				position: "absolute",
				right: 30,
				top: 170,
				width: 420,
				opacity: s,
				transform: `translateX(${(1 - s) * 44}px)`,
				background: "rgba(20,19,27,0.97)",
				border: `1px solid ${C.border2}`,
				borderRadius: 14,
				boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
				fontFamily: FONT.mono,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "12px 16px",
					borderBottom: `1px solid ${C.border}`,
				}}
			>
				<span style={{ fontSize: 13, color: C.primary, fontWeight: 600 }}>
					audit_log
				</span>
				<Chip kind="violet" font={FONT.mono}>
					write #412
				</Chip>
				<span style={{ marginLeft: "auto", fontSize: 12, color: C.text3 }}>
					16:12:04
				</span>
			</div>
			<div
				style={{
					padding: "13px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 7,
					fontSize: 13,
				}}
			>
				{AUDIT_DIFF.map((l, i) => (
					<div
						key={i}
						style={{
							color:
								l.tone === "del"
									? C.red
									: l.tone === "add"
										? C.greenText
										: C.text2,
							background:
								l.tone === "del"
									? C.redBg
									: l.tone === "add"
										? "rgba(6,78,59,0.55)"
										: "transparent",
							borderRadius: 5,
							padding: l.tone === "plain" ? 0 : "3px 8px",
							...enter(frame, at + 12 + i * 6, { y: 4 }),
						}}
					>
						{l.t}
					</div>
				))}
			</div>
		</div>
	);
};

/** compact chat exchange rendered faded, for conversation continuity */
export const PriorTurn: React.FC<{ q: string; a: string }> = ({ q, a }) => (
	<div
		style={{
			opacity: 0.45,
			display: "flex",
			flexDirection: "column",
			gap: 10,
			fontFamily: FONT.sans,
		}}
	>
		<div style={{ display: "flex", justifyContent: "flex-end" }}>
			<div
				style={{
					background: C.primaryBg,
					border: "1px solid rgba(167,139,250,0.3)",
					borderRadius: "14px 14px 4px 14px",
					padding: "8px 14px",
					fontSize: 13.5,
					color: C.text2,
					maxWidth: "60%",
				}}
			>
				{q}
			</div>
		</div>
		<StepsChip at={-50} label="1 step · 1 tool call" />
		<div
			style={{
				fontSize: 13.5,
				color: C.text2,
				maxWidth: "80%",
				overflow: "hidden",
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
			}}
		>
			{a}
		</div>
	</div>
);
