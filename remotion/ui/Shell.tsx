import type React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../theme";
import { Sidebar } from "./Sidebar";

/**
 * The app window: radial backdrop + rounded window (sidebar + content).
 * Scenes drop their screen into `children`; optional `windowStyle` lets
 * scenes animate the window itself (S2 reveal).
 */
export const Shell: React.FC<{
	active: "home" | "schedule" | "sync" | "course";
	children: React.ReactNode;
	windowStyle?: React.CSSProperties;
	sidebarEnter?: boolean;
}> = ({ active, children, windowStyle, sidebarEnter }) => (
	<AbsoluteFill
		style={{
			background: `radial-gradient(1200px 700px at 50% -8%, ${C.backdropHi} 0%, ${C.backdropMid} 48%, ${C.backdropLo} 100%)`,
		}}
	>
		<div
			style={{
				position: "absolute",
				inset: 40,
				borderRadius: 18,
				overflow: "hidden",
				background: C.bg,
				border: `1px solid ${C.border}`,
				boxShadow: C.shadow,
				display: "flex",
				...windowStyle,
			}}
		>
			<Sidebar active={active} enter={sidebarEnter} />
			<div style={{ flex: 1, position: "relative", minWidth: 0 }}>
				{children}
			</div>
		</div>
	</AbsoluteFill>
);
