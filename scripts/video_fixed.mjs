import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const DEMO_URL = "http://localhost:8007";
const VIDEO_DIR = "videos";
const VIEWPORT = { width: 1920, height: 1080 };
mkdirSync(VIDEO_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
	viewport: VIEWPORT,
	recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
});
const page = await ctx.newPage();
await page.route("**/api/chat", async (route) => {
	if (route.request().method() !== "POST") return route.continue();
	let msg = "";
	try {
		const j = route.request().postDataJSON();
		msg = (j?.message || "").toLowerCase();
	} catch {}
	let t =
		"Found it — from your CS 1100A syllabus (Late policy): 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.' That's in syllabus.md:4 — want me to open it?";
	if (msg.includes("extend"))
		t =
			"All set! I moved Assignment 1 from Aug 29 to Aug 31 and added your note. It's marked extended and logged to the audit trail.";
	const body =
		`event: tool_start\ndata: ${JSON.stringify({ tool: "search_corpus" })}\n\n` +
		`event: tool_end\ndata: ${JSON.stringify({ tool: "search_corpus" })}\n\n` +
		`event: token\ndata: ${JSON.stringify({ text: t })}\n\n` +
		`event: done\ndata: ${JSON.stringify({ answer: t })}\n\n`;
	await route.fulfill({
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
		body,
	});
});
// simple flow: Home -> Courses/1 -> Chat
await page.goto(DEMO_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("at home", page.url());
await page.goto(`${DEMO_URL}/courses/1`, { waitUntil: "networkidle" });
await page.waitForSelector(".course-head", { timeout: 5000 });
console.log(
	"at course",
	await page.locator(".course-head .page-title").first().textContent(),
);
await page.waitForTimeout(1500);
const input = page.locator('textarea[placeholder*="Ask"]').first();
await input.click();
for (const ch of "where does the syllabus mention late penalties") {
	await page.keyboard.type(ch);
	await page.waitForTimeout(60);
}
await page.locator(".send-btn").first().click();
await page.waitForSelector(".msg-assistant", { timeout: 8000 });
console.log("chat done");
await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
const raw = join(
	VIDEO_DIR,
	(await import("node:fs"))
		.readdirSync(VIDEO_DIR)
		.filter((f) => f.endsWith(".webm"))
		.sort()
		.pop(),
);
console.log("raw", raw);
execSync(
	`ffmpeg -y -i "${raw}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 60 -vf "scale=1920:1080:flags=lanczos" -movflags +faststart "videos/campus-demo.mp4"`,
	{ stdio: "inherit" },
);
console.log("mp4 done");
