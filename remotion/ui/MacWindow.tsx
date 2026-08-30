import type React from "react";
import {
	AbsoluteFill,
	OffthreadVideo,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { REAL_UI_SOURCE } from "../data/demo";
import { C, FONT, SPRING } from "../theme";

type MacWindowProps = {
	startFrom?: number;
	animateIn?: boolean;
	enterAt?: number;
	contentStyle?: React.CSSProperties;
	windowStyle?: React.CSSProperties;
};

/**
 * Presents the captured production UI as a focused macOS app window.
 * The inner viewport keeps the capture's 16:9 aspect ratio so the real UI
 * stays undistorted while the title bar and desktop treatment add context.
 */
export const MacWindow: React.FC<MacWindowProps> = ({
	startFrom,
	animateIn = true,
	enterAt = 96,
	contentStyle,
	windowStyle,
}) => {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();
	const titlebarHeight = 52;
	const horizontalMargin = 80;
	const verticalMargin = 20;
	const maxWidth = 1760;
	const maxWidthFromHeight =
		(height - verticalMargin * 2 - titlebarHeight) * (16 / 9);
	const windowWidth = Math.min(
		maxWidth,
		width - horizontalMargin * 2,
		maxWidthFromHeight,
	);
	const contentHeight = windowWidth * (9 / 16);
	const windowHeight = titlebarHeight + contentHeight;
	const left = (width - windowWidth) / 2;
	const top = (height - windowHeight) / 2;

	const progress = animateIn
		? spring({
				frame: frame - enterAt,
				fps,
				config: SPRING.soft,
			})
		: 1;
	const opacity = animateIn
		? interpolate(frame, [enterAt, enterAt + 18], [0, 1], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 1;

	return (
		<AbsoluteFill
			style={{
				opacity,
				transform: `translateY(${(1 - progress) * 14}px) scale(${0.985 + progress * 0.015})`,
				transformOrigin: "center center",
				...windowStyle,
			}}
		>
			<div
				style={{
					position: "absolute",
					left,
					top,
					width: windowWidth,
					height: windowHeight,
					overflow: "hidden",
					borderRadius: 20,
					background: "#19191f",
					border: "1px solid rgba(255,255,255,0.13)",
					boxShadow:
						"0 30px 90px rgba(0,0,0,0.62), 0 8px 24px rgba(0,0,0,0.35), inset 0 1px rgba(255,255,255,0.08)",
				}}
			>
				<div
					style={{
						position: "relative",
						height: titlebarHeight,
						display: "flex",
						alignItems: "center",
						padding: "0 18px",
						background:
							"linear-gradient(180deg, rgba(55,55,65,0.98), rgba(36,36,44,0.98))",
						borderBottom: "1px solid rgba(0,0,0,0.48)",
						fontFamily: FONT.sans,
					}}
				>
					<div style={{ display: "flex", gap: 9 }}>
						{[
							["#ff5f57", "rgba(255,95,87,0.24)"],
							["#febc2e", "rgba(254,188,46,0.22)"],
							["#28c840", "rgba(40,200,64,0.22)"],
						].map(([color, glow]) => (
							<span
								key={color}
								style={{
									width: 13,
									height: 13,
									borderRadius: "50%",
									background: color,
									boxShadow: `0 0 0 1px ${glow}, inset 0 1px rgba(255,255,255,0.32)`,
								}}
							/>
						))}
					</div>
					<div
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							gap: 8,
							color: "rgba(245,245,248,0.78)",
							fontSize: 14,
							fontWeight: 650,
							letterSpacing: "-0.01em",
							pointerEvents: "none",
						}}
					>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: C.primary,
								boxShadow: `0 0 12px ${C.primary}`,
							}}
						/>
						Campus
					</div>
					<div
						style={{
							marginLeft: "auto",
							color: "rgba(225,225,230,0.48)",
							fontFamily: FONT.mono,
							fontSize: 11,
							letterSpacing: "0.02em",
						}}
					>
						local workspace
					</div>
				</div>
				<div
					style={{
						position: "relative",
						width: windowWidth,
						height: contentHeight,
						background: C.bg,
					}}
				>
					<OffthreadVideo
						src={staticFile(REAL_UI_SOURCE)}
						startFrom={startFrom}
						volume={0}
						style={{
							display: "block",
							width: "100%",
							height: "100%",
							objectFit: "fill",
							...contentStyle,
						}}
					/>
				</div>
			</div>
		</AbsoluteFill>
	);
};
