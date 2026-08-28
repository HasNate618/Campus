import type React from "react";
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { C, SPRING } from "../theme";
import { Shell } from "../ui/Shell";
import { HomeScreen } from "../ui/HomeScreen";
import { SyncScreen } from "../ui/SyncScreen";
import { ScheduleScreen } from "../ui/ScheduleScreen";
import {
	CourseHeader,
	ContentTree,
	OverviewBody,
	PdfView,
	SyllabusView,
} from "../ui/CourseScreens";
import { Camera } from "../motion/Camera";
import { Cursor } from "../motion/Cursor";
import { S6_Q } from "../data/demo";

/** S2 — Home: the desk reveals, digest types, deadlines pulse */
export const S2Home: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const windowIn = spring({
		frame,
		fps,
		config: { damping: 20, stiffness: 120 },
		durationInFrames: 46,
	});
	return (
		<AbsoluteFill style={{ background: "#000" }}>
			<Camera moves={[{ start: 300, end: 380, s: 1.22, cx: 0.42, cy: 0.6 }]}>
				<div
					style={{
						width: "100%",
						height: "100%",
						transform: `scale(${0.97 + 0.03 * windowIn})`,
					}}
				>
					<Shell active="home" sidebarEnter>
						<HomeScreen digestAt={130} pulseRows />
					</Shell>
				</div>
			</Camera>
			<Cursor
				stops={[
					{ at: 12, x: 1480, y: 900 },
					{ at: 200, x: 1220, y: 740 },
					{ at: 290, x: 1180, y: 620 },
				]}
			/>
		</AbsoluteFill>
	);
};

/** S3 — the sync engine: trigger, run log, pipeline beat, architecture ribbon */
export const S3Sync: React.FC = () => (
	<AbsoluteFill style={{ background: "#000" }}>
		<Camera moves={[{ start: 440, end: 520, s: 1.12, cx: 0.5, cy: 0.45 }]}>
			<Shell active="sync">
				<SyncScreen />
			</Shell>
		</Camera>
		<Cursor
			stops={[
				{ at: 0, x: 1440, y: 900 },
				{ at: 30, x: 150, y: 200, click: true },
				{ at: 120, x: 1780, y: 72, click: true },
				{ at: 180, x: 1780, y: 78 },
			]}
			hideAfter={430}
		/>
	</AbsoluteFill>
);

/** S4 — course hub → content tree → zen syllabus → pageless PDF */
export const S4Content: React.FC = () => {
	const frame = useCurrentFrame();
	// phases: overview [0,140) → content tree [140,…) → syllabus [196,…) → pdf [320,…)
	const activeTab = frame < 140 ? "overview" : "content";
	const selected = frame >= 196 ? "syllabus.md" : undefined;
	const syllabusFade = interpolate(frame, [318, 330], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const pdfFade = interpolate(frame, [318, 332], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const syllabusY = interpolate(frame, [230, 300], [0, -130], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: Easing.inOut(Easing.quad),
	});
	const ghost = interpolate(frame, [420, 436], [0.3, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill style={{ background: "#000" }}>
			<Camera moves={[{ start: 200, end: 280, s: 1.12, cx: 0.55, cy: 0.5 }]}>
				<Shell active="course">
					<div
						style={{ display: "flex", flexDirection: "column", height: "100%" }}
					>
						<CourseHeader active={activeTab} />
						<div
							style={{
								flex: 1,
								minHeight: 0,
								opacity: interpolate(frame, [132, 142], [1, 0], {
									extrapolateLeft: "clamp",
									extrapolateRight: "clamp",
								}),
								visibility: frame < 144 ? "visible" : "hidden",
							}}
						>
							<OverviewBody />
						</div>
						<div
							style={{
								position: "absolute",
								inset: 0,
								top: 89,
								display: "flex",
								opacity: interpolate(frame, [140, 152], [0, 1], {
									extrapolateLeft: "clamp",
									extrapolateRight: "clamp",
								}),
								visibility: frame < 138 ? "hidden" : "visible",
							}}
						>
							<div
								style={{
									flex: 1,
									display: "flex",
									minHeight: 0,
									background: C.bg,
								}}
							>
								<ContentTree selected={selected} enterAt={4} />
								<div style={{ flex: 1, position: "relative", minWidth: 0 }}>
									{/* syllabus (fades out when PDF opens) */}
									<div
										style={{
											position: "absolute",
											inset: 0,
											opacity: syllabusFade,
											transform: `translateY(${syllabusY}px)`,
										}}
									>
										<SyllabusView enterAt={10} />
									</div>
									{/* pageless PDF */}
									<div
										style={{ position: "absolute", inset: 0, opacity: pdfFade }}
									>
										<PdfView scrollAt={340} enterAt={322} />
									</div>
									{/* paged ghost sliding out */}
									{frame >= 418 && frame <= 438 && (
										<div
											style={{
												position: "absolute",
												inset: 0,
												opacity: ghost,
												pointerEvents: "none",
											}}
										>
											<div
												style={{
													position: "absolute",
													left: "18%",
													top: "12%",
													width: "30%",
													height: "76%",
													background: "rgba(255,255,255,0.05)",
													border: `1px solid ${C.border}`,
													borderRadius: 8,
													transform: `translateX(${-40 * (1 - ghost)}px)`,
												}}
											/>
											<div
												style={{
													position: "absolute",
													left: "52%",
													top: "12%",
													width: "30%",
													height: "76%",
													background: "rgba(255,255,255,0.05)",
													border: `1px solid ${C.border}`,
													borderRadius: 8,
													transform: `translateX(${40 * (1 - ghost)}px)`,
												}}
											/>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</Shell>
			</Camera>
			<Cursor
				stops={[
					{ at: 0, x: 1440, y: 880 },
					{ at: 24, x: 150, y: 358, click: true },
					{ at: 128, x: 892, y: 78, click: true },
					{ at: 190, x: 420, y: 470, click: true },
					{ at: 310, x: 452, y: 512, click: true },
					{ at: 380, x: 900, y: 540 },
				]}
				hideAfter={560}
			/>
		</AbsoluteFill>
	);
};

/** S5 — the weekly timetable with a Fall/Winter flick */
export const S5Schedule: React.FC = () => (
	<AbsoluteFill style={{ background: "#000" }}>
		<Camera moves={[{ start: 150, end: 230, s: 1.15, cx: 0.62, cy: 0.58 }]}>
			<Shell active="schedule">
				<ScheduleScreen />
			</Shell>
		</Camera>
		<Cursor
			stops={[
				{ at: 0, x: 1440, y: 880 },
				{ at: 24, x: 150, y: 200, click: true },
				{ at: 110, x: 1660, y: 64, click: true },
				{ at: 146, x: 1590, y: 64, click: true },
			]}
			hideAfter={220}
		/>
	</AbsoluteFill>
);
