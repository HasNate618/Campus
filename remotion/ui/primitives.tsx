import type React from "react";
import { spring, useCurrentFrame } from "remotion";
import { C, FONT, SPRING } from "../theme";

/** spring entrance style: rise + fade (returns style props). Pure — takes the
 *  current frame explicitly so it is safe inside any render, even after a
 *  parent's null-guard (useCurrentFrame is a hook; calling it conditionally
 *  throws "rendered more hooks" when a subtree flips null -> rendered). */
export const enter = (
	frame: number,
	at: number,
	opts: { y?: number; damping?: number; stiffness?: number; fps?: number } = {},
): React.CSSProperties => {
	const s = spring({
		frame: frame - at,
		fps: opts.fps ?? 60,
		config: {
			damping: opts.damping ?? SPRING.soft.damping,
			stiffness: opts.stiffness ?? SPRING.soft.stiffness,
		},
	});
	if (s <= 0.001) return { opacity: 0 };
	return {
		opacity: s,
		transform: `translateY(${(1 - s) * (opts.y ?? 10)}px)`,
	};
};

export const Card: React.FC<{
	title?: string;
	icon?: React.ReactNode;
	right?: React.ReactNode;
	at?: number;
	style?: React.CSSProperties;
	children: React.ReactNode;
}> = ({ title, icon, right, at, style, children }) => {
	const frame = useCurrentFrame();
	const entrance = at !== undefined ? enter(frame, at) : {};
	return (
		<div
			style={{
				background: C.card,
				border: `1px solid ${C.border}`,
				borderRadius: 14,
				padding: "16px 18px",
				...entrance,
				...style,
			}}
		>
			{title && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginBottom: 12,
						fontSize: 15,
						fontWeight: 600,
						color: C.text1,
						fontFamily: FONT.sans,
					}}
				>
					{icon}
					{title}
					{right && <span style={{ marginLeft: "auto" }}>{right}</span>}
				</div>
			)}
			{children}
		</div>
	);
};

type ChipKind = "grey" | "violet" | "green" | "amber" | "red";

const CHIP_STYLES: Record<ChipKind, React.CSSProperties> = {
	grey: {
		background: "rgba(255,255,255,0.07)",
		color: C.text2,
		border: `1px solid ${C.border}`,
	},
	violet: {
		background: C.primaryBg,
		color: C.primary,
		border: "1px solid rgba(167,139,250,0.35)",
	},
	green: {
		background: C.greenBg,
		color: C.greenText,
		border: "1px solid rgba(16,185,129,0.4)",
	},
	amber: {
		background: C.amberBg,
		color: C.amber,
		border: "1px solid rgba(245,158,11,0.4)",
	},
	red: {
		background: C.redBg,
		color: C.red,
		border: "1px solid rgba(239,68,68,0.4)",
	},
};

export const Chip: React.FC<{
	kind?: ChipKind;
	children: React.ReactNode;
	style?: React.CSSProperties;
	font?: string;
}> = ({ kind = "grey", children, style, font = FONT.sans }) => (
	<span
		style={{
			display: "inline-flex",
			alignItems: "center",
			borderRadius: 999,
			padding: "3px 10px",
			fontSize: 12,
			fontWeight: 600,
			lineHeight: 1.5,
			whiteSpace: "nowrap",
			fontFamily: font,
			...CHIP_STYLES[kind],
			...style,
		}}
	>
		{children}
	</span>
);

export const PageTitle: React.FC<{ title: string; sub?: string }> = ({
	title,
	sub,
}) => (
	<div style={{ marginBottom: 22 }}>
		<div
			style={{
				fontSize: 30,
				fontWeight: 700,
				color: C.text1,
				fontFamily: FONT.sans,
			}}
		>
			{title}
		</div>
		{sub && (
			<div
				style={{
					fontSize: 15,
					color: C.text3,
					marginTop: 2,
					fontFamily: FONT.sans,
				}}
			>
				{sub}
			</div>
		)}
	</div>
);
