import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";
import { BLOCKS, courseByCode } from "../data/demo";
import { enter } from "./primitives";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const PX_PER_H = 56;
const GRID_TOP = 34; // day-header height

const hexA = (hex: string, a: number) => {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const BlockBox: React.FC<{
	code: string;
	color: string;
	kind: string;
	from: number;
	to: number;
	room: string;
	at: number;
}> = ({ code, color, kind, from, to, room, at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.snappy });
	if (s <= 0.01) return null;
	const fmt = (m: number) => {
		const h = Math.floor(m / 60) + 8;
		const mm = m % 60;
		return `${h}:${String(mm).padStart(2, "0")}`;
	};
	return (
		<div
			style={{
				position: "absolute",
				left: 3,
				right: 4,
				top: GRID_TOP + (from / 60) * PX_PER_H + 2,
				height: ((to - from) / 60) * PX_PER_H - 5,
				background: hexA(color, 0.16),
				borderLeft: `3px solid ${color}`,
				borderRadius: 8,
				padding: "7px 9px",
				overflow: "hidden",
				opacity: s,
				transform: `scale(${0.92 + 0.08 * s})`,
				transformOrigin: "top left",
				fontFamily: FONT.sans,
			}}
		>
			<div
				style={{
					fontSize: 12.5,
					fontWeight: 800,
					color,
					letterSpacing: "0.02em",
				}}
			>
				{code}
			</div>
			<div style={{ fontSize: 10.5, color: C.text3, marginTop: 1 }}>{kind}</div>
			<div style={{ fontSize: 10.5, color: C.text3, marginTop: 1 }}>
				{fmt(from)}–{fmt(to)} · {room}
			</div>
		</div>
	);
};

/** Weekly timetable with the Fall/Winter toggle flick. */
export const ScheduleScreen: React.FC = () => {
	const frame = useCurrentFrame();
	const winter = frame >= 120 && frame < 146;
	const visible = BLOCKS.filter((b) => (winter ? b.winter : !b.winter));
	const legend = ["CS 1100A", "MATH 1600A", "ENG 3300A"];

	return (
		<div
			style={{
				padding: "26px 30px",
				height: "100%",
				boxSizing: "border-box",
				display: "flex",
				flexDirection: "column",
				fontFamily: FONT.sans,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
				<span style={{ fontSize: 15, fontWeight: 600, color: C.text2 }}>
					My Schedule
				</span>
				<div
					style={{
						marginLeft: "auto",
						display: "flex",
						gap: 6,
						background: "rgba(255,255,255,0.04)",
						borderRadius: 11,
						padding: 4,
					}}
				>
					{["Fall · A", "Winter · B"].map((t, i) => {
						const on = winter ? i === 1 : i === 0;
						return (
							<div
								key={t}
								style={{
									padding: "5px 14px",
									borderRadius: 8,
									fontSize: 12.5,
									fontWeight: on ? 700 : 500,
									color: on ? C.text1 : C.text3,
									background: on ? C.primaryBg : "transparent",
								}}
							>
								{t}
							</div>
						);
					})}
				</div>
			</div>

			{/* grid */}
			<div
				style={{ flex: 1, display: "flex", position: "relative", minHeight: 0 }}
			>
				{/* time gutter */}
				<div style={{ width: 52, flexShrink: 0, position: "relative" }}>
					{Array.from({ length: 13 }, (_, i) => (
						<div
							key={i}
							style={{
								position: "absolute",
								top: GRID_TOP + i * PX_PER_H - 7,
								right: 8,
								fontSize: 10.5,
								color: C.text3,
								fontFamily: FONT.sans,
							}}
						>
							{`${(i + 8) % 12 === 0 ? 12 : (i + 8) % 12} ${i + 8 < 12 || i + 8 === 24 ? "AM" : "PM"}`}
						</div>
					))}
				</div>
				{/* day columns */}
				<div style={{ flex: 1, display: "flex", position: "relative" }}>
					{/* hour lines */}
					{Array.from({ length: 14 }, (_, i) => (
						<div
							key={i}
							style={{
								position: "absolute",
								left: 0,
								right: 0,
								top: GRID_TOP + i * PX_PER_H,
								borderTop: `1px solid rgba(255,255,255,0.05)`,
							}}
						/>
					))}
					{DAYS.map((d, di) => (
						<div
							key={d}
							style={{
								flex: 1,
								borderLeft:
									di === 0 ? "none" : `1px solid rgba(255,255,255,0.05)`,
								position: "relative",
							}}
						>
							<div
								style={{
									textAlign: "center",
									fontSize: 11.5,
									fontWeight: 700,
									letterSpacing: "0.06em",
									color: di === 3 ? C.primary : C.text3,
									lineHeight: `${GRID_TOP}px`,
								}}
							>
								{d}
							</div>
							{visible
								.filter((b) => b.day === di)
								.map((b) => (
									<BlockBox
										key={b.course + b.kind + b.day}
										code={b.course}
										color={courseByCode(b.course).color}
										kind={b.kind}
										from={b.from}
										to={b.to}
										room={b.room}
										at={40 + di * 2 + (winter ? 0 : b.from / 30)}
									/>
								))}
						</div>
					))}
				</div>
			</div>

			{/* legend */}
			<div
				style={{
					display: "flex",
					gap: 26,
					borderTop: `1px solid ${C.border}`,
					paddingTop: 12,
					...enter(frame, 140, { y: 6 }),
				}}
			>
				{legend.map((code) => {
					const c = courseByCode(code);
					return (
						<div
							key={code}
							style={{ display: "flex", alignItems: "center", gap: 8 }}
						>
							<span
								style={{
									width: 10,
									height: 10,
									borderRadius: 3,
									background: c.color,
								}}
							/>
							<span style={{ fontSize: 12.5, fontWeight: 700, color: C.text1 }}>
								{code}
							</span>
							<span style={{ fontSize: 12, color: C.text3 }}>{c.name}</span>
							<span style={{ fontSize: 12, color: C.text3, marginLeft: 2 }}>
								0.50
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
};
