import type React from "react";
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { C, FONT, SPRING } from "../theme";
import {
	S6_BEATS,
	S6_Q,
	S7_ANSWER,
	S7_BEATS,
	S7_MSG,
	S8_ANSWER,
	S8_BEATS,
	S8_FEEDBACK,
	S8_KICKER,
	S8_MSG,
	S8_QUESTION,
} from "../data/demo";
import { Shell } from "../ui/Shell";
import { CourseHeader, SyllabusView } from "../ui/CourseScreens";
import {
	AnswerBox,
	AnswerBlock,
	AuditCard,
	CitationChip,
	InputBar,
	PriorTurn,
	QuestionCard,
	Stamp,
	UserBubble,
} from "../ui/ChatBits";
import { StepsChip, ToolRow } from "../motion/ToolChip";
import { Camera } from "../motion/Camera";
import { Cursor } from "../motion/Cursor";
import { StreamText } from "../motion/StreamText";
import { Chip, enter } from "../ui/primitives";
import { Icon } from "../ui/Icons";

/** full-height chat pane (messages bottom-anchored above the input) */
const ChatColumn: React.FC<{
	children: React.ReactNode;
	suggestion?: boolean;
}> = ({ children, suggestion }) => {
	const frame = useCurrentFrame();
	const suggO = suggestion
		? interpolate(frame, [110, 150], [1, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 0;
	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				minWidth: 0,
				position: "relative",
			}}
		>
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					justifyContent: "flex-end",
					gap: 16,
					padding: "24px 30px",
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				{suggestion && suggO > 0 && (
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							opacity: suggO * 0.75,
						}}
					>
						<span
							style={{
								fontSize: 13,
								color: C.text3,
								border: `1px dashed ${C.border2}`,
								borderRadius: 999,
								padding: "5px 13px",
								fontFamily: FONT.sans,
							}}
						>
							{suggestion ? S6_Q : ""}
						</span>
					</div>
				)}
				{children}
			</div>
		</div>
	);
};

/** S6 — ask & cite (hero): type → tools → streaming answer → citation click-through */
export const S6Cite: React.FC = () => {
	const frame = useCurrentFrame();
	const B = S6_BEATS;
	const paneW = interpolate(frame, [B.paneIn, B.paneIn + 55], [0, 46], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: Easing.inOut(Easing.cubic),
	});
	const showPane = paneW > 0.5;
	return (
		<AbsoluteFill style={{ background: "#000" }}>
			<Camera
				moves={[
					{ start: B.camPush, end: B.camPush + 60, s: 1.35, cx: 0.36, cy: 0.8 },
					{
						start: B.paneIn + 6,
						end: B.paneIn + 46,
						s: 1.12,
						cx: 0.3,
						cy: 0.42,
					},
				]}
			>
				<Shell active="course">
					<div
						style={{ display: "flex", flexDirection: "column", height: "100%" }}
					>
						<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
							{/* content pane slides in on citation click */}
							<div
								style={{
									width: `${paneW}%`,
									overflow: "hidden",
									borderRight: showPane ? `1px solid ${C.border}` : "none",
									display: "flex",
									flexDirection: "column",
								}}
							>
								<CourseHeader active="content" compact />
								<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
									<SyllabusView
										highlightIdx={3}
										glowAt={B.glow}
										enterAt={B.paneIn + 6}
									/>
								</div>
							</div>
							{/* chat */}
							<ChatColumn suggestion>
								<UserBubble text={S6_Q} at={B.send} />
								<div>
									<StepsChip
										at={B.stepsIn}
										expandAt={B.stepsExpand}
										expanded={
											<ToolRow
												tool="content_grep"
												args={'query:"late penalty" · course:"CS 1100A"'}
												state={frame >= B.toolDone ? "done" : "running"}
												appearAt={B.stepsExpand + 2}
												doneLabel="1 hit · syllabus.md"
											/>
										}
									/>
									<div style={{ marginTop: 14 }}>
										<AnswerBlock
											leadAt={B.streamLead}
											quoteAt={B.quoteStart}
											tailAt={B.tailStart}
											chipFlashAt={B.chipLand}
										/>
									</div>
								</div>
							</ChatColumn>
						</div>
						<InputBar
							typeStart={B.typeStart}
							typeText={S6_Q}
							seed={31}
							sentAt={B.send}
							busyUntil={B.toolDone}
						/>
					</div>
				</Shell>
			</Camera>
			<Cursor
				stops={[
					{ at: 0, x: 1420, y: 870 },
					{ at: B.camPush + 40, x: 620, y: 902 },
					{ at: B.click, x: 620, y: 902, click: true },
				]}
				hideAfter={B.paneIn + 30}
			/>
		</AbsoluteFill>
	);
};

/** mini home inset for S7 — shows the due-date flip */
const PipHome: React.FC<{ flipAt: number; at: number }> = ({ flipAt, at }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: frame - at, fps, config: SPRING.soft });
	if (s <= 0.01) return null;
	const out = interpolate(frame, [620, 640], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return (
		<div
			style={{
				position: "absolute",
				right: 28,
				bottom: 104,
				width: 620,
				opacity: s * out,
				transform: `translateY(${(1 - s) * 30}px) scale(${0.96 + 0.04 * s})`,
				background: "rgba(20,19,27,0.97)",
				border: `1px solid ${C.border2}`,
				borderRadius: 14,
				boxShadow:
					"0 24px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(167,139,250,0.15)",
				padding: "14px 18px",
				fontFamily: FONT.sans,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					fontSize: 13.5,
					fontWeight: 700,
					color: C.text2,
					marginBottom: 8,
				}}
			>
				<Icon name="clock" size={13} color={C.text3} />
				Next 7 days
				<span
					style={{
						marginLeft: "auto",
						fontSize: 11,
						color: C.text3,
						fontWeight: 500,
					}}
				>
					Home · live
				</span>
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "7px 8px",
					borderRadius: 8,
				}}
			>
				<span
					style={{ fontSize: 12.5, fontWeight: 700, color: C.text1, width: 44 }}
				>
					Sat
				</span>
				<span style={{ fontSize: 13.5, color: C.text2, flex: 1 }}>
					CS 1100A LAB
				</span>
				<Chip>class</Chip>
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "7px 8px",
					borderRadius: 8,
					background: "rgba(167,139,250,0.08)",
				}}
			>
				<span
					style={{ fontSize: 12.5, fontWeight: 700, color: C.text1, width: 44 }}
				>
					Sat
				</span>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 13.5, fontWeight: 600, color: C.text1 }}>
						Assignment 1 — Control Flow
					</div>
					<div style={{ fontSize: 12, color: C.text3 }}>
						CS 1100A · due {(() => {
							const p1 = interpolate(frame, [flipAt, flipAt + 11], [0, 90], {
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							});
							const p2 = interpolate(
								frame,
								[flipAt + 12, flipAt + 24],
								[90, 0],
								{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
							);
							const isNew = frame >= flipAt + 12;
							return (
								<span style={{ display: "inline-block", perspective: 300 }}>
									<span
										style={{
											display: "inline-block",
											transform: `rotateX(${(isNew ? p2 : p1) || 0}deg)`,
										}}
									>
										{isNew ? (
											<span style={{ color: C.primary, fontWeight: 700 }}>
												Aug 31, 23:59
											</span>
										) : (
											<span>Aug 29, 23:59</span>
										)}
									</span>
								</span>
							);
						})()}
					</div>
				</div>
				<Chip kind={frame >= flipAt + 24 ? "amber" : "violet"}>
					{frame >= flipAt + 24 ? "extended" : "assignment"}
				</Chip>
			</div>
		</div>
	);
};

/** S7 — act & audit: extend the deadline, watch it propagate */
export const S7Act: React.FC = () => {
	const frame = useCurrentFrame();
	const B = S7_BEATS;
	const paneW = interpolate(frame, [B.paneBack, B.paneBack + 50], [46, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: Easing.inOut(Easing.cubic),
	});
	const showPane = paneW > 0.5;
	return (
		<AbsoluteFill style={{ background: "#000" }}>
			<Camera
				moves={[
					{ start: -2, end: 0, s: 1.12, cx: 0.3, cy: 0.42 },
					{ start: 6, end: 56, s: 1, cx: 0.5, cy: 0.5 },
				]}
			>
				<Shell active="course">
					<div
						style={{ display: "flex", flexDirection: "column", height: "100%" }}
					>
						<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
							<div
								style={{
									width: `${paneW}%`,
									overflow: "hidden",
									borderRight: `1px solid ${C.border}`,
									display: "flex",
									flexDirection: "column",
								}}
							>
								<CourseHeader active="content" compact />
								<SyllabusView highlightIdx={3} enterAt={-50} />
							</div>
							<ChatColumn>
								<PriorTurn
									q={S6_Q}
									a="Found it — from your CS 1100A syllabus (Late policy)… That's in syllabus.md:4 — opened it for you."
								/>
								<UserBubble text={S7_MSG} at={B.send} />
								<div>
									<StepsChip
										at={B.chip1}
										expandAt={B.chip1 + 30}
										label="2 steps · 2 tool calls"
										expanded={
											<>
												<ToolRow
													tool="harness_list_assignments"
													args="course: CS 1100A"
													state={frame >= B.chip1Done ? "done" : "running"}
													appearAt={B.chip1 + 32}
													doneLabel="#1 found"
												/>
												<ToolRow
													tool="mutate_update_assignment"
													args="id=1 · due → 2026-08-31"
													state={frame >= B.chip2Done ? "done" : "running"}
													appearAt={B.chip2 + 5}
													doneLabel="audited · write #412"
												/>
											</>
										}
									/>
									<div style={{ marginTop: 14, maxWidth: "82%" }}>
										<StreamText
											text={S7_ANSWER}
											start={B.streamStart}
											seed={71}
											style={{
												fontSize: 15.5,
												color: C.text1,
												lineHeight: 1.6,
												fontFamily: FONT.sans,
											}}
										/>
									</div>
								</div>
							</ChatColumn>
						</div>
						<InputBar
							typeStart={B.typeStart}
							typeText={S7_MSG}
							seed={37}
							base={2.5}
							sentAt={B.send}
							busyUntil={B.chip2Done}
						/>
					</div>
					<PipHome flipAt={B.flipAt} at={B.pipIn} />
					<AuditCard at={B.auditIn} />
				</Shell>
			</Camera>
		</AbsoluteFill>
	);
};

/** S8 — blind-graded quiz */
export const S8Quiz: React.FC = () => {
	const frame = useCurrentFrame();
	const B = S8_BEATS;
	return (
		<AbsoluteFill style={{ background: "#000" }}>
			<Shell active="course">
				<div
					style={{ display: "flex", flexDirection: "column", height: "100%" }}
				>
					<ChatColumn>
						<PriorTurn
							q={S7_MSG}
							a="Done — Assignment 1 moved from Aug 29 to Aug 31, note saved, logged to the audit trail."
						/>
						<UserBubble text={S8_MSG} at={B.send} />
						<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
							<StepsChip
								at={B.chipIn}
								expanded={
									<ToolRow
										tool="quiz_start"
										args="course: CS 1100A · week 1"
										state={frame >= B.chipDone ? "done" : "running"}
										appearAt={B.chipIn + 2}
										doneLabel="1 fact · late-policy"
									/>
								}
							/>
							<QuestionCard at={B.cardIn} text={S8_QUESTION} />
							<AnswerBox
								at={B.answerStart - 10}
								text={S8_ANSWER}
								typeStart={B.answerStart}
							/>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 20,
								}}
							>
								<StepsChip
									at={B.gradeIn}
									label="quiz_grade · blind"
									expanded={undefined}
								/>
								<Stamp at={B.stamp} />
							</div>
							<div
								style={{
									...enter(frame, B.kicker, { y: 8 }),
									fontSize: 14,
									color: C.text3,
									fontFamily: FONT.sans,
									display: "flex",
									alignItems: "center",
									gap: 9,
								}}
							>
								<Icon name="check" size={14} color={C.green} strokeWidth={3} />
								{S8_KICKER}
							</div>
							<div
								style={{
									fontSize: 14,
									color: C.text2,
									fontFamily: FONT.sans,
									...enter(frame, B.kicker + 6, { y: 6 }),
								}}
							>
								<span
									style={{
										color: C.greenText,
										background: "rgba(6,78,59,0.4)",
										borderRadius: 6,
										padding: "3px 9px",
										fontWeight: 600,
									}}
								>
									{S8_FEEDBACK}
								</span>
							</div>
						</div>
					</ChatColumn>
					<InputBar
						typeStart={B.typeStart}
						typeText={S8_MSG}
						seed={41}
						sentAt={B.send}
						busyUntil={B.gradeDone}
					/>
				</div>
			</Shell>
		</AbsoluteFill>
	);
};
