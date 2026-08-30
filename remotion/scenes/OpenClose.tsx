import type React from "react";
import {
	AbsoluteFill,
	Img,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	Easing,
} from "remotion";
import { C, FONT, SPRING } from "../theme";
import {
	PROOF_CHIPS,
	REPO,
	STACK,
	T,
	TAGLINE,
} from "../data/demo";
import { Icon } from "../ui/Icons";
import { MacWindow } from "../ui/MacWindow";
import { enter } from "../ui/primitives";

/** brand wordmark with a glint sweep masked to the logo silhouette */
export const BrandLogo: React.FC<{
	height?: number;
	glintAt?: number;
	at?: number;
}> = ({ height = 150, glintAt, at = 0 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.soft });
	const src = staticFile("brand/logo-full.svg");
	const sweep =
		glintAt !== undefined
			? interpolate(frame, [glintAt, glintAt + 34], [-400, 700], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
					easing: Easing.inOut(Easing.quad),
				})
			: -9999;
	return (
		<div
			style={{
				position: "relative",
				opacity: s,
				transform: `scale(${0.94 + 0.06 * s})`,
			}}
		>
			<Img
				src={src}
				style={{
					height,
					filter: "drop-shadow(0 10px 40px rgba(124,108,240,0.25))",
				}}
			/>
			{glintAt !== undefined && frame >= glintAt && frame <= glintAt + 34 && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						WebkitMaskImage: `url(${src})`,
						maskImage: `url(${src})`,
						WebkitMaskSize: "contain",
						maskSize: "contain",
						WebkitMaskRepeat: "no-repeat",
						maskRepeat: "no-repeat",
						WebkitMaskPosition: "center",
						maskPosition: "center",
						overflow: "hidden",
					}}
				>
					<div
						style={{
							position: "absolute",
							top: -40,
							bottom: -40,
							left: `calc(50% + ${sweep}px)`,
							width: 130,
							background:
								"linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
							transform: "rotate(8deg)",
						}}
					/>
				</div>
			)}
		</div>
	);
};

/** S0 — logo sting */
export const S0Logo: React.FC = () => {
	const frame = useCurrentFrame();
	const tagO = interpolate(frame, [100, 126], [0, 1], {
		extrapolateRight: "clamp",
	});
	return (
		<AbsoluteFill
			style={{
				background: "#000",
				alignItems: "center",
				justifyContent: "center",
				flexDirection: "column",
				gap: 26,
			}}
		>
			<BrandLogo height={140} glintAt={50} />
			<div
				style={{
					fontSize: 27,
					fontWeight: 600,
					color: C.text2,
					letterSpacing: "0.14em",
					opacity: tagO,
					fontFamily: FONT.sans,
				}}
			>
				{TAGLINE.toUpperCase()}
			</div>
		</AbsoluteFill>
	);
};

/** dull drop entrance for the problem cards (no spring — deliberately lifeless) */
const dullIn = (at: number): React.CSSProperties => {
	const frame = useCurrentFrame();
	if (frame < at) return { opacity: 0 };
	const p = interpolate(frame, [at, at + 10], [0, 1], {
		easing: Easing.out(Easing.cubic),
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return { opacity: p, transform: `translateY(${(1 - p) * -26}px)` };
};

const PCard: React.FC<{
	at: number;
	rotate: number;
	w: number;
	children: React.ReactNode;
	style?: React.CSSProperties;
}> = ({ at, rotate, w, children, style }) => {
	const entrance = dullIn(at);
	return (
		<div
			style={{
				width: w,
				background: "#17171c",
				border: "1px solid rgba(255,255,255,0.07)",
				borderRadius: 12,
				padding: "20px 24px",
				boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
				fontFamily: FONT.sans,
				...entrance,
				transform: `${entrance.transform ?? ""} rotate(${rotate}deg)`,
				...style,
			}}
		>
			{children}
		</div>
	);
};

const RedChip: React.FC<{ children: React.ReactNode; at: number }> = ({
	children,
	at,
}) => (
	<span
		style={{
			display: "inline-flex",
			marginTop: 12,
			fontSize: 12,
			fontWeight: 700,
			color: "#f0a5a5",
			background: "rgba(239,68,68,0.13)",
			border: "1px solid rgba(239,68,68,0.35)",
			borderRadius: 999,
			padding: "3px 11px",
			opacity: dullIn(at).opacity ?? 0,
		}}
	>
		{children}
	</span>
);

/** S1 — the problem: three grey relics of Brightspace */
export const S1Problem: React.FC = () => {
	const frame = useCurrentFrame();
	const out = interpolate(frame, [440, 478], [0, 1], {
		easing: Easing.in(Easing.cubic),
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return (
		<AbsoluteFill
			style={{
				background:
					"radial-gradient(1000px 600px at 50% 20%, #131316 0%, #0a0a0c 60%, #060608 100%)",
				alignItems: "center",
				justifyContent: "center",
				filter: `grayscale(${out})`,
				transform: `translateX(${-90 * out}px)`,
				opacity: 1 - out,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 26,
					alignItems: "center",
				}}
			>
				{/* breadcrumbs */}
				<PCard at={40} rotate={-1.2} w={680}>
					<div
						style={{
							fontSize: 14.5,
							color: "#8b8b90",
							fontFamily: FONT.mono,
							letterSpacing: "0.02em",
						}}
					>
						Brightspace <span style={{ color: "#55555b" }}>›</span> Content{" "}
						<span style={{ color: "#55555b" }}>›</span> Module 2{" "}
						<span style={{ color: "#55555b" }}>›</span> Week 3{" "}
						<span style={{ color: "#55555b" }}>›</span>{" "}
						<span style={{ color: "#c9c9ce" }}>lecture-04.pdf</span>
					</div>
					<RedChip at={70}>4 clicks deep</RedChip>
				</PCard>
				{/* buried deadline */}
				<PCard at={120} rotate={0.9} w={680} style={{ marginLeft: 60 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
						{[82, 64].map((w, i) => (
							<div
								key={i}
								style={{
									height: 9,
									width: `${w}%`,
									borderRadius: 4,
									background: "rgba(255,255,255,0.07)",
								}}
							/>
						))}
						<div
							style={{
								fontSize: 14,
								color: "#e3b8b8",
								background: "rgba(239,68,68,0.10)",
								border: "1px solid rgba(239,68,68,0.25)",
								borderRadius: 6,
								padding: "7px 12px",
								fontFamily: FONT.mono,
							}}
						>
							…assignment due Aug 29 — see §3.2 for the late policy…
						</div>
						<div
							style={{
								height: 9,
								width: "45%",
								borderRadius: 4,
								background: "rgba(255,255,255,0.07)",
							}}
						/>
					</div>
					<RedChip at={150}>deadline hidden in a PDF</RedChip>
				</PCard>
				{/* scrolled-past announcement */}
				<PCard at={200} rotate={-0.6} w={680} style={{ marginLeft: -40 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						<div style={{ fontSize: 14.5, fontWeight: 600, color: "#a9a9ae" }}>
							Welcome to the course!
						</div>
						<div style={{ fontSize: 14.5, fontWeight: 600, color: "#a9a9ae" }}>
							Week 1 reminders
						</div>
						<div
							style={{
								fontSize: 14.5,
								fontWeight: 600,
								color: "#5c5c62",
								transform: "translateY(14px)",
								opacity: 0.55,
							}}
						>
							Lab sections rescheduled — check the portal
						</div>
					</div>
					<RedChip at={230}>scroll past once, gone</RedChip>
				</PCard>
			</div>
		</AbsoluteFill>
	);
};

/** S9 — proof chips over a blurred desk, then the end card */
export const S9Close: React.FC = () => {
	const frame = useCurrentFrame();
	const cardO = interpolate(frame, [145, 170], [0, 1], {
		extrapolateRight: "clamp",
	});
	const fade = interpolate(frame, [255, 280], [0, 1], {
		extrapolateRight: "clamp",
	});
	return (
		<AbsoluteFill style={{ background: "#000" }}>
			{/* blurred desk */}
			<AbsoluteFill style={{ opacity: 1 - cardO }}>
				<MacWindow
					startFrom={T.s9}
					animateIn={false}
					contentStyle={{
						filter: "blur(18px) brightness(0.42) saturate(0.85)",
					}}
				/>
				<AbsoluteFill style={{ background: "rgba(5,5,8,0.35)" }} />
				{/* proof chips */}
				<AbsoluteFill
					style={{ alignItems: "center", justifyContent: "center" }}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 18,
							alignItems: "stretch",
						}}
					>
						{PROOF_CHIPS.map((t, i) => (
							<div
								key={t}
								style={{
									...enter(frame, 18 + i * 28, { y: 12 }),
									display: "flex",
									alignItems: "center",
									gap: 12,
									background: "rgba(20,19,27,0.92)",
									border: `1px solid ${C.border2}`,
									borderRadius: 13,
									padding: "14px 22px",
									fontSize: 17,
									fontWeight: 600,
									color: C.text1,
									fontFamily: FONT.sans,
									boxShadow: "0 16px 50px rgba(0,0,0,0.45)",
								}}
							>
								<Icon name="check" size={17} color={C.green} strokeWidth={3} />
								{t}
							</div>
						))}
					</div>
				</AbsoluteFill>
			</AbsoluteFill>

			{/* end card */}
			<AbsoluteFill
				style={{
					opacity: cardO,
					background:
						"radial-gradient(1100px 640px at 50% -6%, #17153a 0%, #0a0a0f 52%, #050507 100%)",
					alignItems: "center",
					justifyContent: "center",
					flexDirection: "column",
					gap: 30,
				}}
			>
				<BrandLogo height={130} at={158} />
				<div
					style={{
						fontSize: 25,
						fontWeight: 600,
						color: C.text2,
						letterSpacing: "0.12em",
						fontFamily: FONT.sans,
					}}
				>
					{TAGLINE.toUpperCase()}
				</div>
				<div
					style={{
						fontFamily: FONT.mono,
						fontSize: 15,
						color: C.primary,
						background: C.primaryBg,
						border: "1px solid rgba(167,139,250,0.35)",
						borderRadius: 10,
						padding: "9px 18px",
						...enter(frame, 208, { y: 8 }),
					}}
				>
					{REPO}
				</div>
				<div style={{ display: "flex", gap: 9 }}>
					{STACK.map((t, i) => (
						<span
							key={t}
							style={{
								...enter(frame, 232 + i * 5, { y: 6 }),
								fontSize: 13.5,
								fontWeight: 600,
								color: C.text2,
								background: "rgba(255,255,255,0.06)",
								border: `1px solid ${C.border}`,
								borderRadius: 999,
								padding: "6px 14px",
								fontFamily: FONT.sans,
							}}
						>
							{t}
						</span>
					))}
				</div>
			</AbsoluteFill>

			{/* fade to black */}
			<AbsoluteFill style={{ background: "#000", opacity: fade }} />
		</AbsoluteFill>
	);
};
