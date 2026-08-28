import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";
import {
	SYNC_LINE_DONES,
	SYNC_LINE_STARTS,
	SYNC_LINES,
	SYNC_PIPELINE,
} from "../data/demo";
import { Card, Chip, PageTitle, enter } from "./primitives";
import { Icon } from "./Icons";
import { TypeText } from "../motion/TypeText";

/** The sync engine page — trigger, live run log, pipeline beat, architecture ribbon. */
export const SyncScreen: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const progress = interpolate(
		frame,
		[SYNC_LINE_STARTS[0], SYNC_LINE_DONES[3]],
		[0, 100],
		{
			easing: (e) => e,
			extrapolateLeft: "extend",
			extrapolateRight: "extend",
		},
	);
	const runDone = frame >= SYNC_LINE_DONES[3];
	const chipPop = spring({
		frame: frame - SYNC_LINE_DONES[3],
		fps,
		config: SPRING.snappy,
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
			<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
				<PageTitle title="Sync" />
				<div style={{ display: "flex", gap: 8, marginTop: -14 }}>
					<Chip kind="green">token valid · refreshed 2h ago</Chip>
					<Chip>SQLite WAL · 21 tables</Chip>
				</div>
				<div
					style={{
						marginLeft: "auto",
						marginTop: -14,
						display: "flex",
						alignItems: "center",
						gap: 7,
						background: "rgba(255,255,255,0.08)",
						border: `1px solid ${C.border2}`,
						borderRadius: 9,
						padding: "7px 14px",
						fontSize: 13.5,
						fontWeight: 600,
						color: C.text1,
					}}
				>
					<Icon name="play" size={12} color={C.primary} />
					Sync
				</div>
			</div>

			<Card
				style={{ flex: 1, display: "flex", flexDirection: "column" }}
				at={60}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						marginBottom: 14,
					}}
				>
					<span style={{ fontSize: 15, fontWeight: 600, color: C.text1 }}>
						Sync run · #482
					</span>
					<span style={{ fontSize: 12.5, color: C.text3 }}>
						triggered 16:12 · full
					</span>
					<span style={{ marginLeft: "auto" }}>
						{runDone ? (
							<span
								style={{
									display: "inline-block",
									transform: `scale(${0.7 + 0.3 * chipPop})`,
								}}
							>
								<Chip kind="green">success</Chip>
							</span>
						) : (
							<Chip kind="amber">running</Chip>
						)}
					</span>
				</div>

				{/* progress */}
				<div
					style={{
						height: 5,
						borderRadius: 999,
						background: "rgba(255,255,255,0.07)",
						marginBottom: 20,
						overflow: "hidden",
					}}
				>
					<div
						style={{
							width: `${Math.min(100, progress)}%`,
							height: "100%",
							borderRadius: 999,
							background: `linear-gradient(90deg, ${C.primaryDim}, ${C.primary})`,
						}}
					/>
				</div>

				{/* log lines */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 13,
						fontFamily: FONT.mono,
					}}
				>
					{SYNC_LINES.map((line, i) => {
						const done = frame >= SYNC_LINE_DONES[i];
						const pop = spring({
							frame: frame - SYNC_LINE_DONES[i],
							fps,
							config: SPRING.snappy,
						});
						return (
							<div
								key={i}
								style={{
									display: "flex",
									alignItems: "center",
									fontSize: 14.5,
									minHeight: 22,
								}}
							>
								<TypeText
									text={line}
									start={SYNC_LINE_STARTS[i]}
									seed={51 + i}
									base={2}
									jit={0.6}
									caret={false}
									style={{ color: C.text2 }}
								/>
								{done && (
									<span
										style={{
											marginLeft: 12,
											display: "inline-flex",
											transform: `scale(${0.6 + 0.4 * pop})`,
											opacity: pop,
										}}
									>
										<Icon
											name="check"
											size={15}
											color={C.green}
											strokeWidth={3}
										/>
									</span>
								)}
							</div>
						);
					})}
				</div>

				{/* pipeline beat */}
				<div
					style={{
						...enter(frame, 440, { y: 8 }),
						marginTop: "auto",
						alignSelf: "flex-start",
						background: C.primaryBg,
						border: "1px solid rgba(167,139,250,0.35)",
						borderRadius: 10,
						padding: "10px 16px",
						fontFamily: FONT.mono,
						fontSize: 14,
						color: C.primary,
					}}
				>
					{SYNC_PIPELINE}
				</div>
			</Card>

			{/* architecture ribbon */}
			<div
				style={{
					...enter(frame, 520, { y: 12 }),
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 14,
					padding: "18px 0 2px",
				}}
			>
				{["Brightspace", "SQLite · 21 tables + files", "agent + PWA"].map(
					(n, i) => (
						<React.Fragment key={n}>
							{i > 0 && (
								<span
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										fontFamily: FONT.mono,
										fontSize: 11.5,
										color: C.text3,
									}}
								>
									{i === 1 ? "Playwright · MFA" : ""}
									<span
										style={{ color: C.primaryDim, fontSize: 16, lineHeight: 1 }}
									>
										→
									</span>
								</span>
							)}
							<div
								style={{
									...enter(frame, 524 + i * 8, { y: 6 }),
									background: C.cardSolid,
									border: `1px solid ${C.border2}`,
									borderRadius: 10,
									padding: "9px 16px",
									fontSize: 13.5,
									fontWeight: 600,
									color: C.text2,
								}}
							>
								{n}
							</div>
						</React.Fragment>
					),
				)}
			</div>
		</div>
	);
};
