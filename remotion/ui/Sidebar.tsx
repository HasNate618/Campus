import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, SPRING } from "../theme";
import { COURSES } from "../data/demo";
import { Icon } from "./Icons";

const NavItem: React.FC<{
	icon: "home" | "calendar" | "refresh";
	label: string;
	active: boolean;
	at: number;
}> = ({ icon, label, active, at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.soft });
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 12px",
				borderRadius: 10,
				margin: "1px 0",
				background: active ? "rgba(167,139,250,0.14)" : "transparent",
				color: active ? C.text1 : C.text2,
				fontSize: 14.5,
				fontWeight: active ? 600 : 500,
				fontFamily: FONT.sans,
				opacity: s,
				transform: `translateX(${(1 - s) * -8}px)`,
			}}
		>
			<Icon name={icon} size={16} color={active ? C.primary : C.text3} />
			{label}
		</div>
	);
};

const CourseRow: React.FC<{
	code: string;
	color: string;
	active: boolean;
	at: number;
}> = ({ code, color, active, at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.soft });
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 9,
				padding: "6px 12px",
				borderRadius: 10,
				background: active ? "rgba(255,255,255,0.06)" : "transparent",
				fontSize: 13.5,
				fontWeight: 600,
				letterSpacing: "0.01em",
				color: active ? C.text1 : C.text2,
				fontFamily: FONT.sans,
				opacity: s,
				transform: `translateX(${(1 - s) * -8}px)`,
			}}
		>
			<span
				style={{
					width: 9,
					height: 9,
					borderRadius: 3,
					background: color,
					flexShrink: 0,
					boxShadow: active ? `0 0 10px ${color}` : "none",
				}}
			/>
			{code}
		</div>
	);
};

export const Sidebar: React.FC<{
	active: "home" | "schedule" | "sync" | "course";
	enter?: boolean;
	activeCourse?: string;
}> = ({ active, enter = false, activeCourse = "CS 1100A" }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = (i: number) =>
		enter ? spring({ frame: frame - i * 3, fps, config: SPRING.soft }) : 1;
	const logo = s(0);
	return (
		<div
			style={{
				width: 260,
				flexShrink: 0,
				borderRight: `1px solid ${C.border}`,
				padding: "20px 14px 18px",
				display: "flex",
				flexDirection: "column",
				fontFamily: FONT.sans,
				background: "rgba(255,255,255,0.015)",
			}}
		>
			{/* logo row */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "2px 8px 18px",
					opacity: logo,
				}}
			>
				<div
					style={{
						width: 30,
						height: 30,
						borderRadius: 9,
						background: "linear-gradient(135deg, #7c6cf0, #a78bfa)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<svg width={17} height={17} viewBox="0 0 24 24">
						<path
							d="M22 9.5 12 4.5 2 9.5l10 5 10-5z"
							fill="#0b0a0f"
							opacity="0.85"
						/>
						<path
							d="M6 12v4.6c0 1.5 2.7 2.9 6 2.9s6-1.4 6-2.9V12"
							stroke="#0b0a0f"
							strokeWidth="2"
							fill="none"
							strokeLinecap="round"
						/>
					</svg>
				</div>
				<span style={{ fontSize: 17.5, fontWeight: 700, color: C.text1 }}>
					Campus
				</span>
				<span style={{ marginLeft: "auto", color: C.text3 }}>
					<Icon name="panel" size={15} />
				</span>
			</div>

			{/* nav */}
			<div style={{ opacity: enter ? logo : 1 }}>
				<NavItem
					icon="home"
					label="Home"
					active={active === "home"}
					at={enter ? 4 : 0}
				/>
				<NavItem
					icon="calendar"
					label="Schedule"
					active={active === "schedule"}
					at={enter ? 7 : 0}
				/>
				<NavItem
					icon="refresh"
					label="Sync"
					active={active === "sync"}
					at={enter ? 10 : 0}
				/>
			</div>

			{/* recent chats */}
			<div style={{ marginTop: 20, opacity: s(12) }}>
				<div
					style={{
						fontSize: 10.5,
						fontWeight: 700,
						letterSpacing: "0.08em",
						color: C.text3,
						padding: "0 12px 8px",
					}}
				>
					RECENT CHATS
				</div>
				<div
					style={{
						padding: "7px 12px",
						fontSize: 13,
						color: C.text2,
						background: "rgba(255,255,255,0.04)",
						borderRadius: 10,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					where does the syllabus…{" "}
					<span style={{ color: C.text3, fontSize: 11.5, fontWeight: 400 }}>
						· just now
					</span>
				</div>
			</div>

			{/* courses */}
			<div style={{ marginTop: 20, flex: 1 }}>
				<div
					style={{
						fontSize: 10.5,
						fontWeight: 700,
						letterSpacing: "0.08em",
						color: C.text3,
						padding: "0 12px 8px",
						opacity: s(14),
					}}
				>
					COURSES
				</div>
				{COURSES.map((c, i) => (
					<CourseRow
						key={c.code}
						code={c.code}
						color={c.color}
						active={active === "course" && c.code === activeCourse}
						at={enter ? 16 + i * 2 : 0}
					/>
				))}
			</div>

			{/* bottom */}
			<div
				style={{
					borderTop: `1px solid ${C.border}`,
					padding: "14px 12px 0",
					display: "flex",
					alignItems: "center",
					gap: 8,
					color: C.text3,
					fontSize: 13.5,
					opacity: s(20),
				}}
			>
				<Icon name="logout" size={15} />
				Log out
			</div>
		</div>
	);
};
