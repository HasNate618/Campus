import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";
import { DIGEST, NEXT7, TODAY } from "../data/demo";
import { Card, Chip, enter } from "./primitives";
import { Icon } from "./Icons";
import { TypeText } from "../motion/TypeText";

/** value that flips (rotateX) at `at` — Aug 29 → Aug 31 */
const FlipText: React.FC<{ at: number; from: string; to: string }> = ({
	at,
	from,
	to,
}) => {
	const frame = useCurrentFrame();
	const p1 = interpolate(frame, [at, at + 11], [0, 90], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const p2 = interpolate(frame, [at + 12, at + 24], [90, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const showNew = frame >= at + 12;
	return (
		<span style={{ display: "inline-block", perspective: 400 }}>
			<span
				style={{
					display: "inline-block",
					transform: `rotateX(${(showNew ? p2 : p1) || 0}deg)`,
				}}
			>
				{showNew ? (
					<span style={{ color: C.primary, fontWeight: 700 }}>{to}</span>
				) : (
					<span>{from}</span>
				)}
			</span>
		</span>
	);
};

const CalendarCard: React.FC<{ at: number }> = ({ at }) => {
	const cells: Array<{
		d: number;
		muted?: boolean;
		today?: boolean;
		dot?: boolean;
	}> = [];
	for (const d of [27, 28, 29, 30, 31]) cells.push({ d, muted: true }); // July tail
	for (let d = 1; d <= 31; d++)
		cells.push({ d, today: d === 27, dot: [28, 29, 30].includes(d) });
	return (
		<Card
			title="August 2026"
			icon={<Icon name="calendar" size={14} color={C.text3} />}
			right={
				<span style={{ fontSize: 12.5, color: C.primary, fontWeight: 600 }}>
					Open
				</span>
			}
			at={at}
		>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(7,1fr)",
					gap: 3,
				}}
			>
				{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
					<div
						key={`h${i}`}
						style={{
							textAlign: "center",
							fontSize: 11,
							color: C.text3,
							padding: "2px 0",
							fontFamily: FONT.sans,
						}}
					>
						{d}
					</div>
				))}
				{cells.map((c, i) => (
					<div
						key={i}
						style={{
							textAlign: "center",
							fontSize: 12.5,
							padding: "5px 0",
							borderRadius: 8,
							color: c.muted
								? "rgba(255,255,255,0.18)"
								: c.today
									? "#0b0a0f"
									: C.text2,
							background: c.today ? C.primary : "transparent",
							fontWeight: c.today ? 700 : 400,
							position: "relative",
							fontFamily: FONT.sans,
						}}
					>
						{c.d}
						{c.dot && (
							<span
								style={{
									position: "absolute",
									bottom: 1,
									left: "50%",
									marginLeft: -2,
									width: 4,
									height: 4,
									borderRadius: 999,
									background: C.primary,
								}}
							/>
						)}
					</div>
				))}
			</div>
		</Card>
	);
};

const Next7Card: React.FC<{
	at: number;
	pulseRows?: boolean;
	flipAt?: number;
}> = ({ at, pulseRows, flipAt }) => {
	const frame = useCurrentFrame();
	return (
		<Card
			title="Next 7 days"
			icon={<Icon name="clock" size={14} color={C.text3} />}
			at={at}
			style={{ flex: 1 }}
		>
			<div style={{ display: "flex", flexDirection: "column" }}>
				{NEXT7.map((r, i) => {
					const pulse =
						pulseRows && frame >= 400 + i * 20 && frame < 420 + i * 20
							? interpolate(frame, [400 + i * 20, 420 + i * 20], [0.14, 0])
							: 0;
					const isHero = r.pulse;
					return (
						<div
							key={i}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 12,
								padding: "9px 10px",
								borderRadius: 10,
								background:
									pulse > 0 ? `rgba(167,139,250,${pulse})` : "transparent",
							}}
						>
							<div style={{ width: 52, flexShrink: 0 }}>
								<div
									style={{
										fontSize: 13.5,
										fontWeight: 700,
										color: C.text1,
										fontFamily: FONT.sans,
									}}
								>
									{r.day}
								</div>
								<div
									style={{
										fontSize: 11.5,
										color: C.text3,
										fontFamily: FONT.sans,
									}}
								>
									{r.date}
								</div>
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 14.5,
										fontWeight: 600,
										color: C.text1,
										whiteSpace: "nowrap",
										fontFamily: FONT.sans,
									}}
								>
									{r.title}
								</div>
								<div
									style={{
										fontSize: 12.5,
										color: C.text3,
										whiteSpace: "nowrap",
										fontFamily: FONT.sans,
									}}
								>
									{isHero && flipAt !== undefined && frame >= flipAt - 999 ? (
										<>
											CS 1100A · due{" "}
											<FlipText
												at={flipAt}
												from="Aug 29, 23:59"
												to="Aug 31, 23:59"
											/>
										</>
									) : (
										r.sub
									)}
								</div>
							</div>
							<Chip
								kind={
									isHero && flipAt !== undefined && frame >= flipAt + 24
										? "amber"
										: isHero
											? "violet"
											: r.chip === "class"
												? "grey"
												: "violet"
								}
							>
								{isHero && flipAt !== undefined && frame >= flipAt + 24
									? "extended"
									: r.chip}
							</Chip>
						</div>
					);
				})}
			</div>
		</Card>
	);
};

const SyncCard: React.FC<{ at: number }> = ({ at }) => (
	<Card
		title="Sync"
		icon={<Icon name="refresh" size={14} color={C.text3} />}
		right={
			<span style={{ fontSize: 12.5, color: C.text3, fontWeight: 400 }}>
				Details
			</span>
		}
		at={at}
	>
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				fontFamily: FONT.sans,
			}}
		>
			<div>
				<div style={{ fontSize: 14.5, fontWeight: 600, color: C.text1 }}>
					Last run 27 Aug
				</div>
				<div style={{ fontSize: 12.5, color: C.text3, marginTop: 3 }}>
					2 new files · 1 updated
				</div>
			</div>
			<div
				style={{
					marginLeft: "auto",
					display: "flex",
					alignItems: "center",
					gap: 10,
				}}
			>
				<Chip kind="green">success</Chip>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						background: "rgba(255,255,255,0.08)",
						border: `1px solid ${C.border2}`,
						borderRadius: 9,
						padding: "6px 12px",
						fontSize: 13,
						fontWeight: 600,
						color: C.text1,
					}}
				>
					<Icon name="play" size={11} color={C.primary} />
					Sync
				</div>
			</div>
		</div>
	</Card>
);

/**
 * The Home screen. `digestAt` = scene-local typing start (null → fully
 * typed); `pulseRows` = S2 sequential row pulses; `flipAt` = due-date flip.
 */
export const HomeScreen: React.FC<{
	digestAt?: number | null;
	pulseRows?: boolean;
	flipAt?: number;
}> = ({ digestAt, pulseRows, flipAt }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const reveal = spring({
		frame,
		fps,
		config: { damping: 20, stiffness: 120 },
		durationInFrames: 40,
	});
	return (
		<div
			style={{
				padding: "30px 34px",
				height: "100%",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column",
				fontFamily: FONT.sans,
			}}
		>
			<div style={{ marginBottom: 20, opacity: reveal }}>
				<div style={{ fontSize: 30, fontWeight: 700, color: C.text1 }}>
					Home
				</div>
				<div style={{ fontSize: 15, color: C.text3, marginTop: 2 }}>
					{TODAY}
				</div>
			</div>
			<div style={{ display: "flex", gap: 18, flex: 1, minHeight: 0 }}>
				{/* left column */}
				<div
					style={{
						flex: 1.35,
						display: "flex",
						flexDirection: "column",
						gap: 18,
						minWidth: 0,
					}}
				>
					<Card
						title="Digest"
						icon={<Icon name="home" size={14} color={C.text3} />}
						right={
							<span style={{ fontSize: 12.5, color: C.text3, fontWeight: 400 }}>
								just now
							</span>
						}
						at={60}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
							{DIGEST.map((b, i) => (
								<div
									key={i}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 10,
										minHeight: 22,
									}}
								>
									<span
										style={{
											width: 6,
											height: 6,
											borderRadius: 999,
											background: C.primary,
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											fontSize: 14.5,
											color: C.text1,
											fontFamily: FONT.sans,
										}}
									>
										{digestAt == null ? (
											b
										) : (
											<TypeText
												text={b}
												start={digestAt + i * 95}
												seed={21 + i}
												base={2.2}
												jit={1}
												caret={i === DIGEST.length - 1}
											/>
										)}
									</span>
								</div>
							))}
						</div>
					</Card>
					<Next7Card at={74} pulseRows={pulseRows} flipAt={flipAt} />
				</div>
				{/* right column */}
				<div
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						gap: 18,
						minWidth: 0,
					}}
				>
					<CalendarCard at={88} />
					<SyncCard at={102} />
				</div>
			</div>
		</div>
	);
};
