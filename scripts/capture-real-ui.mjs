#!/usr/bin/env node

import {
	mkdirSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixtureFor } from "./real-ui-fixtures.mjs";
import {
	REAL_UI_DURATION_MS,
	REAL_UI_DURATION_FRAMES,
	REAL_UI_CHAT_INPUT_SELECTOR,
	sceneStartMs,
} from "./real-ui-plan.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEMO_URL = process.env.CAMPUS_DEMO_URL ?? "http://127.0.0.1:5173";
const OUTPUT = join(
	ROOT,
	process.env.CAMPUS_REAL_UI_OUTPUT ?? "public/captures/campus-real-ui.mp4",
);
const RAW_DIR = join(ROOT, ".cache", "campus-real-ui");
const VIEWPORT = { width: 1920, height: 1080 };

const citeAnswer =
	"I found it in your CS 1100A syllabus.\\n\\n> Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.\\n\\nSource: `syllabus.md:4`";
const actAnswer =
	"Done — Assignment 1 moved from Aug 29 to Aug 31 and your note is saved. It is marked **extended** and logged to the audit trail.";
const quizPrompt =
	"**Week 1 check**\\n\\nWhat is the late-submission policy for Assignment 1?\\n\\nReply with the rule in one line — I’ll grade only your answer.";
const quizAnswer =
	"Correct. **10% per day**, up to **48 hours** late. The answer matches the syllabus policy.";

function chunks(text, width = 28) {
	const out = [];
	for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
	return out;
}

function scenario({ thinking, narration, tools, answer }) {
	const frames = [];
	const push = (event, data, delay) => frames.push({ event, data, delay });
	for (const part of chunks(thinking, 24)) {
		push("reasoning", { text: part }, 95);
	}
	if (narration) push("token", { text: narration }, 160);
	for (const tool of tools) {
		push("tool_start", tool.start, 220);
		push("tool_end", tool.end, 620);
	}
	for (const part of chunks(answer, 26)) {
		push("token", { text: part }, 82);
	}
	push("done", { answer }, 80);
	return { frames };
}

const CHAT_SCENARIOS = {
	cite: scenario({
		thinking: "Search the local course corpus for the late-submission policy.",
		narration: "I’ll check your syllabus. ",
		tools: [
			{
				start: {
					tool: "content_grep",
					args: { query: "late penalties", course: "CS 1100A" },
				},
				end: {
					tool: "content_grep",
					result: {
						hits: 1,
						path: "syllabus.md",
						line: 4,
					},
				},
			},
		],
		answer: citeAnswer,
	}),
	act: scenario({
		thinking: "Verify the current due date, then write the approved extension.",
		narration: "I’ll verify the assignment before changing it. ",
		tools: [
			{
				start: {
					tool: "course_map",
					args: { course: "CS 1100A" },
				},
				end: {
					tool: "course_map",
					result: { assignment: "Assignment 1", due_at: "2026-08-29T23:59:00" },
				},
			},
			{
				start: {
					tool: "mutate_update_assignment",
					args: {
						id: 401,
						due_at: "2026-08-31T23:59:00",
						note: "approved per email 2026-09-08",
					},
				},
				end: {
					tool: "mutate_update_assignment",
					result: { status: "updated", audit_id: "audit-401-08" },
				},
			},
		],
		answer: actAnswer,
	}),
	quiz: scenario({
		thinking: "Retrieve week one policy and create a blind check.",
		narration: "I’ll turn that policy into a quick recall check. ",
		tools: [
			{
				start: {
					tool: "content_read_file",
					args: { path: "syllabus.md" },
				},
				end: {
					tool: "content_read_file",
					result: { lines: 7 },
				},
			},
			{
				start: {
					tool: "quiz_create",
					args: { mode: "blind", questions: 1 },
				},
				end: {
					tool: "quiz_create",
					result: { question_id: "week1-policy" },
				},
			},
		],
		answer: quizPrompt,
	}),
	quizGrade: scenario({
		thinking: "Compare the answer with the saved policy key.",
		narration: null,
		tools: [
			{
				start: {
					tool: "quiz_grade",
					args: { question_id: "week1-policy" },
				},
				end: {
					tool: "quiz_grade",
					result: { correct: true },
				},
			},
		],
		answer: quizAnswer,
	}),
};

function apiJson(status, body) {
	return {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		body: JSON.stringify(body),
	};
}

function installApiFixtures(page, state) {
	return page.route("**/api/**", async (route) => {
		const request = route.request();
		const url = request.url();
		const method = request.method();
		const parsed = new URL(url);

		if (method === "GET") {
			const body = fixtureFor(url, state.assignmentExtended);
			if (body !== null) {
				await route.fulfill(apiJson(200, body));
				return;
			}
		}

		if (parsed.pathname === "/api/sync/trigger" && method === "POST") {
			await route.fulfill(
				apiJson(200, {
					run_id: 42,
					status: "success",
					message: "Sync complete — 7 new files indexed.",
				}),
			);
			return;
		}

		if (parsed.pathname === "/api/chat/sessions" && method === "POST") {
			await route.fulfill(
				apiJson(200, {
					id: 9001,
					courseId: 1,
					title: "Demo chat",
					updatedAt: "2026-08-27 15:42:00",
					nodes: [],
					activeNodeId: null,
				}),
			);
			return;
		}

		if (parsed.pathname.startsWith("/api/chat/sessions/")) {
			await route.fulfill(apiJson(200, { ok: true, id: 9001 }));
			return;
		}

		await route.continue();
	});
}

async function installChatStream(page) {
	await page.addInitScript(
		({ scenarios }) => {
			const nativeFetch = window.fetch.bind(window);
			window.fetch = async (input, init) => {
				const requestUrl = new URL(
					typeof input === "string" ? input : input.url,
					window.location.href,
				);
				if (requestUrl.pathname !== "/api/chat" || init?.method !== "POST") {
					return nativeFetch(input, init);
				}

				let body = {};
				try {
					body = JSON.parse(String(init.body ?? "{}"));
				} catch {
					/* the real client always sends JSON */
				}
				const message = String(body.message ?? "").toLowerCase();
				const key = message.includes("10%") || message.includes("48 hours")
					? "quizGrade"
					: message.includes("quiz")
						? "quiz"
						: message.includes("extend")
							? "act"
							: "cite";
				const frames = scenarios[key]?.frames ?? scenarios.cite.frames;
				const encoder = new TextEncoder();
				let timer;
				let index = 0;
				const stream = new ReadableStream({
					start(controller) {
						const emit = () => {
							const frame = frames[index++];
							if (!frame) {
								controller.close();
								return;
							}
							controller.enqueue(
								encoder.encode(
									`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`,
								),
							);
							timer = window.setTimeout(emit, frame.delay);
						};
						timer = window.setTimeout(emit, 90);
					},
					cancel() {
						window.clearTimeout(timer);
					},
				});
				return new Response(stream, {
					status: 200,
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
					},
				});
			};
		},
		{ scenarios: CHAT_SCENARIOS },
	);
}

async function waitUntil(page, startedAt, targetMs) {
	const remaining = targetMs - (Date.now() - startedAt);
	if (remaining > 0) await page.waitForTimeout(remaining);
}

async function go(page, path, selector) {
	await page.goto(`${DEMO_URL}${path}`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector(selector, { timeout: 15_000 });
	await page.waitForTimeout(450);
}

async function sendMessage(page, message) {
	const input = page.locator(REAL_UI_CHAT_INPUT_SELECTOR).first();
	await input.waitFor({ state: "visible", timeout: 10_000 });
	await input.click();
	await page.keyboard.type(message, { delay: 22 });
	const send = page.locator(".send-btn").first();
	await page.waitForFunction(() => {
		const button = document.querySelector(".send-btn");
		return button instanceof HTMLButtonElement && !button.disabled;
	});
	await send.click();
	await page.waitForFunction(
		() => document.querySelector(".send-btn")?.getAttribute("aria-label") === "Send",
		{ timeout: 15_000 },
	);
}

async function newChat(page) {
	const button = page.locator('.chat-head button[title="New chat"]').first();
	if (await button.count()) {
		await button.click();
		await page.waitForTimeout(300);
	}
}

async function main() {
	mkdirSync(dirname(OUTPUT), { recursive: true });
	rmSync(RAW_DIR, { recursive: true, force: true });
	mkdirSync(RAW_DIR, { recursive: true });

	let browser;
	let context;
	try {
		browser = await chromium.launch({
			headless: true,
			executablePath:
				process.env.CAMPUS_CHROMIUM_PATH ??
				process.env.REMOTION_CHROMIUM_PATH ??
				undefined,
		});
		context = await browser.newContext({
			viewport: VIEWPORT,
			recordVideo: { dir: RAW_DIR, size: VIEWPORT },
			timezoneId: "America/Toronto",
			locale: "en-CA",
		});
		const page = await context.newPage();
		const state = { assignmentExtended: false };
		await installApiFixtures(page, state);
		await installChatStream(page);

		page.on("console", (message) => {
			if (message.type() === "error") {
				console.warn(`[browser] ${message.text()}`);
			}
		});

		const startedAt = Date.now();
		await go(page, "/", ".page-title");
		await waitUntil(page, startedAt, sceneStartMs("sync"));

		await go(page, "/sync", ".page-title");
		await waitUntil(page, startedAt, sceneStartMs("course"));

		await go(page, "/courses/1/content/102", ".viewer-title");
		await waitUntil(page, startedAt, sceneStartMs("cite"));

		await go(page, "/courses/1", ".chat-wrap");
		await waitUntil(page, startedAt, sceneStartMs("cite") + 900);
		await sendMessage(page, "where does the syllabus mention late penalties?");
		await page.waitForTimeout(900);

		await waitUntil(page, startedAt, sceneStartMs("act"));
		await newChat(page);
		await sendMessage(
			page,
			'extend Assignment 1 by 2 days — note "approved per email 2026-09-08"',
		);
		state.assignmentExtended = true;
		await page.waitForTimeout(850);

		await waitUntil(page, startedAt, sceneStartMs("quiz"));
		await newChat(page);
		await sendMessage(page, "quiz me on week 1");
		await page.waitForTimeout(1_000);
		await sendMessage(page, "10% per day, up to 48 hours late");
		await page.waitForTimeout(700);

		await waitUntil(page, startedAt, sceneStartMs("close"));
		await go(page, "/", ".page-title");
		await page.waitForTimeout(1_000);
		await waitUntil(page, startedAt, REAL_UI_DURATION_MS);

		const video = page.video();
		await context.close();
		context = undefined;
		await browser.close();
		browser = undefined;
		const rawPath = await video.path();
		const rawName = readdirSync(RAW_DIR).find((name) => name.endsWith(".webm"));
		if (!rawName || rawPath !== join(RAW_DIR, rawName)) {
			throw new Error(`Playwright video not found in ${RAW_DIR}`);
		}

		execFileSync(
			"ffmpeg",
			[
				"-y",
				"-i",
				rawPath,
				"-an",
				"-vf",
				"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=60,tpad=stop_mode=clone:stop_duration=1",
				"-frames:v",
				String(REAL_UI_DURATION_FRAMES),
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				"18",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				OUTPUT,
			],
			{ stdio: "inherit" },
		);
		console.log(`Real UI capture written to ${OUTPUT}`);
	} finally {
		await context?.close().catch(() => {});
		await browser?.close().catch(() => {});
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
