#!/usr/bin/env node
/**
 * Capture crisp screenshots for Remotion `public/frames/` + `docs/images/hero.png`
 * Runs against `DEMO_URL` (default http://localhost:8007), captures Today, course hub, and chat.
 * Usage: nix-shell --run 'node scripts/capture-frames.mjs'
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const DEMO_URL = process.env.DEMO_URL || "http://localhost:8007";
const OUT = "public/frames";
const DOCS = "docs/images";

async function injectCursor(page) {
  await page.addInitScript(() => {
    const c = document.createElement("div");
    c.id = "__cursor";
    Object.assign(c.style, {
      position: "fixed", width: "26px", height: "26px", background: "white",
      border: "3px solid #111", borderRadius: "50%",
      boxShadow: "0 2px 12px rgba(0,0,0,0.55), 0 0 0 3px rgba(139,92,246,0.95)",
      pointerEvents: "none", zIndex: "2147483647", left: "960px", top: "540px",
    });
    document.documentElement.appendChild(c);
    window.__moveCursor = (x, y) => { c.style.left = (x - 13) + "px"; c.style.top = (y - 13) + "px"; };
  });
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(DOCS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await injectCursor(ctx);
  const page = await ctx.newPage();
  await injectCursor(page);

  // Mock SSE friendly tone (same as demo-video.mjs)
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    let msg = ""; try { const j = route.request().postDataJSON(); msg = (j?.message || "").toLowerCase(); } catch {}
    let text = "Found it — from your CS 1100A syllabus (Late policy): 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.' That's in syllabus.md:4 — want me to open it?";
    let toolStart = { tool: "search_corpus", args: { query: "late penalties" } };
    const toolEnd = { tool: "search_corpus", result: { hits: 3 } };
    if (msg.includes("thrashing") || msg.includes("paging")) {
      text = "Thrashing is when the system spends more time paging than executing — Lecture 4 calls it \"excessive page faults from an undersized working set\" [Lecture 4 p.12]. I've moved your review to Aug 31 — want a blind-graded 5-question check on working sets?";
      toolStart = { tool: "search_corpus", args: { query: "thrashing" } };
    }
    let body = "";
    body += `event: tool_start\ndata: ${JSON.stringify(toolStart)}\n\n`;
    body += `event: tool_end\ndata: ${JSON.stringify(toolEnd)}\n\n`;
    for (const w of text.split(/(\s+)/)) body += `event: token\ndata: ${JSON.stringify({ text: w })}\n\n`;
    body += `event: done\ndata: ${JSON.stringify({ answer: text })}\n\n`;
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body });
  });

  const shot = async (route, name) => {
    await page.goto(`${DEMO_URL}${route}`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.documentElement.style.zoom = "0.88"; });
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    console.log(`[capture] ${name}.png`);
  };

  // 1) Today
  await shot("/", "today");
  // 2) Course hub
  await shot("/courses/1", "course-hub");
  // 3) Chat (empty)
  await page.goto(`${DEMO_URL}/courses/1`, { waitUntil: "networkidle" });
  await page.waitForSelector('textarea[placeholder*="Ask"]', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => { document.documentElement.style.zoom = "0.88"; });
  await page.screenshot({ path: join(OUT, "chat.png"), fullPage: false });
  console.log("[capture] chat.png");

  // 4) Chat with answer (type + send)
  const input = page.locator('textarea[placeholder*="Ask"]').first();
  if (await input.count() > 0) {
    await input.click();
    await page.keyboard.type("How did the Aug 19 lecture define thrashing? And move my review to Aug 31.");
    await page.locator(".send-btn").first().click();
    await page.waitForSelector(".msg-assistant", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, "chat-answer.png"), fullPage: false });
    console.log("[capture] chat-answer.png");
  } else {
    // fallback copy
    await page.screenshot({ path: join(OUT, "chat-answer.png"), fullPage: false });
  }

  // docs hero (800w)
  await page.goto(`${DEMO_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.documentElement.style.zoom = "0.88"; });
  await page.screenshot({ path: join(DOCS, "hero.png"), fullPage: false });
  console.log("[capture] docs/images/hero.png");

  await ctx.close(); await browser.close();
  console.log("[capture] done — public/frames/*.png ready for remotion");
}
run().catch((e) => { console.error(e); process.exit(1); });
