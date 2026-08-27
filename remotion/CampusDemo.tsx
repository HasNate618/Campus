import type React from "react";
import {
	AbsoluteFill,
	Img,
	Sequence,
	staticFile,
	useVideoConfig,
} from "remotion";
import { Pill } from "./components/Pill";
import { Cursor } from "./components/Cursor";
import { ToolChipRow } from "./components/ToolChip";
import { Zoom } from "./components/Zoom";

const frame = (name: string) => staticFile(`frames/${name}.png`);

const BG: React.CSSProperties = {
	background:
		"radial-gradient(1200px 600px at 50% -10%, #1e1b4b 0%, #0a0a0f 45%, #050507 100%)",
};

const Card: React.CSSProperties = {
	borderRadius: 18,
	overflow: "hidden",
	border: "1px solid rgba(255,255,255,0.08)",
	boxShadow:
		"0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset",
	background: "#0f0f12",
};

/**
 * 30s (1800f @60fps) pacing — rebalanced for readability.
 *  0–270    Hook, 270–540 Sync, 540–840 Course hub, 840–1080 Pageless,
 *  1080–1440 Chat ask, 1440–1650 Answer, 1650–1800 Close
 * Zooms: 3 max, center [0.5,0.5], each with 60-90f hold.
 */
export const CampusDemo: React.FC = () => {
	const { fps } = useVideoConfig();
	const s = (sec: number) => Math.round(sec * fps);

	return (
		<AbsoluteFill style={BG}>
			{/* 0–270 Hook */}
			<Sequence from={0} durationInFrames={270}>
				<Zoom to={1.12} center={[0.5, 0.5]} holdFrames={90}>
					<AbsoluteFill style={{ padding: 28 }}>
						<div
							style={{
								...Card,
								width: "100%",
								height: "100%",
								position: "relative",
							}}
						>
							<Img
								src={frame("today")}
								style={{ width: "100%", height: "100%", objectFit: "cover" }}
							/>
							<div
								style={{
									position: "absolute",
									left: 18,
									bottom: 18,
									background: "#064e3b",
									color: "#a7f3d0",
									border: "1px solid #10b981",
									fontFamily: "Inter, system-ui, sans-serif",
									fontWeight: 600,
									fontSize: 11,
									letterSpacing: "0.02em",
									padding: "6px 10px",
									borderRadius: 999,
								}}
							>
								● Offline ready
							</div>
						</div>
					</AbsoluteFill>
				</Zoom>
				<Pill
					text="Brightspace is scattered. Campus syncs it offline."
					durationInFrames={270}
				/>
			</Sequence>

			{/* 270–540 Sync */}
			<Sequence from={270} durationInFrames={270}>
				<AbsoluteFill style={{ padding: 28 }}>
					<div
						style={{
							...Card,
							width: "100%",
							height: "100%",
							position: "relative",
						}}
					>
						<Img
							src={frame("today")}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
					</div>
				</AbsoluteFill>
				<Pill
					text="Offline-first: D2L REST + Playwright MFA → SQLite."
					durationInFrames={270}
				/>
			</Sequence>

			{/* 540–840 Course hub */}
			<Sequence from={540} durationInFrames={300}>
				<Zoom to={1.18} center={[0.5, 0.5]} holdFrames={90}>
					<AbsoluteFill style={{ padding: 28 }}>
						<div style={{ ...Card, width: "100%", height: "100%" }}>
							<Img
								src={frame("course-hub")}
								style={{ width: "100%", height: "100%", objectFit: "cover" }}
							/>
						</div>
					</AbsoluteFill>
				</Zoom>
				<Pill
					text="Every course, browsable — not a file dump."
					durationInFrames={300}
				/>
				<Cursor from={[1420, 820]} to={[640, 520]} dwell={45} clickAt={60} />
			</Sequence>

			{/* 840–1080 Pageless */}
			<Sequence from={840} durationInFrames={240}>
				<AbsoluteFill style={{ padding: 28 }}>
					<div style={{ ...Card, width: "100%", height: "100%" }}>
						<Img
							src={frame("course-hub")}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
					</div>
				</AbsoluteFill>
				<Pill
					text="Pageless PDF + zen markdown for actual study."
					durationInFrames={240}
				/>
			</Sequence>

			{/* 1080–1440 Chat ask — staged chips */}
			<Sequence from={1080} durationInFrames={360}>
				<AbsoluteFill style={{ padding: 28 }}>
					<div
						style={{
							...Card,
							width: "100%",
							height: "100%",
							position: "relative",
						}}
					>
						<Img
							src={frame("chat")}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
						<div
							style={{
								position: "absolute",
								left: "50%",
								bottom: 160,
								transform: "translateX(-50%)",
								width: "78%",
								background: "rgba(24,24,27,0.94)",
								border: "1px solid rgba(255,255,255,0.12)",
								borderRadius: 14,
								padding: "12px 14px",
								fontFamily: "Inter, system-ui, sans-serif",
								fontSize: 15,
								color: "white",
								boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
							}}
						>
							How did the Aug 19 lecture define thrashing? And move my review to
							Aug 31.
						</div>
					</div>
				</AbsoluteFill>
				<Pill
					text="Ask anything — watch the tools work."
					durationInFrames={360}
				/>
				<Sequence from={1080 + 30} durationInFrames={330}>
					<div style={{ position: "absolute", left: 24, top: 24 }}>
						<ToolChipRow
							chips={[{ label: "search_corpus", state: "running" }]}
						/>
					</div>
				</Sequence>
				<Sequence from={1080 + 90} durationInFrames={270}>
					<div style={{ position: "absolute", left: 24, top: 24 }}>
						<ToolChipRow
							chips={[
								{ label: "search_corpus", state: "done" },
								{ label: "mutate", state: "running" },
							]}
						/>
					</div>
				</Sequence>
				<Cursor from={[960, 860]} to={[960, 860]} dwell={45} />
			</Sequence>

			{/* 1440–1650 Answer */}
			<Sequence from={1440} durationInFrames={210}>
				<AbsoluteFill style={{ padding: 28 }}>
					<div
						style={{
							...Card,
							width: "100%",
							height: "100%",
							position: "relative",
						}}
					>
						<Img
							src={frame("chat-answer")}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
						<div
							style={{
								position: "absolute",
								left: 24,
								right: 24,
								bottom: 150,
								background: "rgba(17,24,39,0.96)",
								border: "1px solid rgba(255,255,255,0.1)",
								borderRadius: 12,
								padding: 12,
								fontFamily: "Inter, system-ui, sans-serif",
								fontSize: 13,
								color: "#e5e7eb",
							}}
						>
							Thrashing is when the system spends more time paging than
							executing —{" "}
							<span style={{ color: "#facc15" }}>
								Lecture 4 p.12 [3 sources]
							</span>
							. Moved your review Aug 29 → Aug 31 · audited.
						</div>
					</div>
				</AbsoluteFill>
				<Pill
					text="Cited answer. Audited mutation. Blind-graded quiz ready."
					durationInFrames={210}
				/>
				<Sequence from={1440 + 18} durationInFrames={192}>
					<div style={{ position: "absolute", left: 24, top: 24 }}>
						<ToolChipRow
							chips={[{ label: "search_corpus ✓ 3 sources", state: "done" }]}
						/>
					</div>
				</Sequence>
				<Sequence from={1440 + 54} durationInFrames={156}>
					<div style={{ position: "absolute", left: 24, top: 52 }}>
						<ToolChipRow
							chips={[
								{ label: "search_corpus ✓ 3 sources", state: "done" },
								{ label: "mutate ✓ Aug 31", state: "done" },
							]}
						/>
					</div>
				</Sequence>
			</Sequence>

			{/* 1650–1800 Close */}
			<Sequence from={1650} durationInFrames={150}>
				<AbsoluteFill
					style={{ padding: 28, justifyContent: "flex-end" as const }}
				>
					<div
						style={{
							...Card,
							width: "100%",
							height: "84%",
							position: "relative",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Img
							src={frame("today")}
							style={{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								opacity: 0.55,
							}}
						/>
						<div
							style={{
								position: "absolute",
								bottom: 18,
								left: "50%",
								transform: "translateX(-50%)",
								display: "flex",
								gap: 12,
								alignItems: "center",
								background: "#18181b",
								border: "1px solid rgba(255,255,255,0.08)",
								borderRadius: 16,
								padding: "14px 18px",
								fontFamily: "Inter, system-ui, sans-serif",
								fontWeight: 600,
								fontSize: 12,
								letterSpacing: "0.02em",
								color: "white",
								boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
								whiteSpace: "nowrap",
							}}
						>
							<span style={{ display: "flex", gap: 8 }}>
								{[
									"Python",
									"Playwright",
									"FastAPI",
									"SQLite",
									"Docker",
									"PWA",
								].map((t) => (
									<span
										key={t}
										style={{
											background: "#27272a",
											borderRadius: 999,
											padding: "6px 10px",
										}}
									>
										{t}
									</span>
								))}
							</span>
							<span
								style={{
									width: 1,
									height: 28,
									background: "rgba(255,255,255,0.12)",
								}}
							/>
							<span>
								github.com/HasNate618/Campus · Installable · Works offline
							</span>
						</div>
					</div>
				</AbsoluteFill>
				<Pill
					text="Offline-first. Installable. Ships with Docker + CI."
					durationInFrames={150}
				/>
			</Sequence>
		</AbsoluteFill>
	);
};
