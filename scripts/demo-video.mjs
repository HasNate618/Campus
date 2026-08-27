#!/usr/bin/env node
/**
 * Campus — 25s polished silent demo (modern product style)
 * Storyboard: scripts/storyboard.json
 * Captions: burned-in via ffmpeg ASS, not SRT
 * Cursor: synthetic white+vilet, eased, with click ripple and auto-zoom via CSS crop+scale
 * Mocked SSE: tool_start/tool_end + token + done, friendly tone, no API key
 *
 * Usage: nix-shell --run 'node scripts/demo-video.mjs'
 * Output: videos/campus-demo.mp4 (1920x1080 60fps H264, <30MB) + docs/images/hero.png poster
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEMO_URL = process.env.DEMO_URL || "http://localhost:8007";
const VIDEO_DIR = "videos";
const STORYBOARD = "scripts/storyboard.json";
const VIEWPORT = { width: 1920, height: 1080 };

function log(s) { console.log(`[demo] ${s}`); }

async function humanType(page, selector, text, base = 175) {
  const loc = page.locator(selector).first();
  await loc.click({ force: true });
  await page.waitForTimeout(140);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(base * (0.78 + Math.random() * 0.44));
    if (ch === " ") await page.waitForTimeout(70 + Math.random() * 80);
  }
}

async function injectPolished(page) {
  await page.addInitScript(() => {
    // synthetic cursor — white with violet glow, visible on dark Campus
    const c = document.createElement("div");
    c.id = "__cursor";
    Object.assign(c.style, {
      position: "fixed", width: "26px", height: "26px", background: "white",
      border: "3px solid #111", borderRadius: "50%",
      boxShadow: "0 2px 12px rgba(0,0,0,0.55), 0 0 0 3px rgba(139,92,246,0.95)",
      pointerEvents: "none", zIndex: "2147483647", left: "960px", top: "540px",
      transition: "left 420ms cubic-bezier(0.22,1,0.36,1), top 420ms cubic-bezier(0.22,1,0.36,1)",
      willChange: "left, top",
    });
    document.documentElement.appendChild(c);
    window.__moveCursor = (x, y) => { c.style.left = (x - 13) + "px"; c.style.top = (y - 13) + "px"; };
    window.__clickRipple = (x, y) => {
      const r = document.createElement("div");
      Object.assign(r.style, {
        position: "fixed", left: (x - 15) + "px", top: (y - 15) + "px",
        width: "30px", height: "30px", borderRadius: "50%",
        border: "2px solid #6366F1", opacity: "0.55", pointerEvents: "none",
        zIndex: "2147483647", transform: "scale(0.6)", transition: "transform 360ms ease, opacity 360ms ease",
      });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.35)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 380);
    };
    // zoom helper — crop+scale via transform on #root/.shell
    window.__zoomTo = (x, y, level) => {
      const root = document.getElementById("root") || document.querySelector(".shell") || document.body;
      if (!root) return;
      root.style.transition = "transform 340ms cubic-bezier(0.22,1,0.36,1)";
      root.style.transformOrigin = `${x}px ${y}px`;
      root.style.transform = level === 1 ? "scale(1)" : `scale(${level})`;
    };
    // PWA install toast mock
    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const t = document.createElement("div");
        t.textContent = "⤓ Install Campus — Works offline";
        t.style.cssText = "position:fixed;top:16px;right:16px;background:#18181B;color:white;padding:10px 16px;border-radius:999px;font:600 13px Inter,system-ui;box-shadow:0 8px 24px rgba(0,0,0,0.35);z-index:2147483646;opacity:0;transition:opacity 220ms";
        document.body.appendChild(t);
        requestAnimationFrame(() => t.style.opacity = "1");
        setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 1600);
      }, 900);
    });
  });
}

function pillCSS() {
  return `
    #__pill{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:rgba(14,14,16,0.86);color:white;
      font:700 19px Inter,system-ui,sans-serif;padding:12px 22px;border-radius:999px;z-index:2147483646;
      opacity:0;transition:opacity 180ms, transform 180ms;letter-spacing:-0.01em;max-width:86vw;text-align:center;
      box-shadow:0 10px 28px rgba(0,0,0,0.38);border:1px solid rgba(255,255,255,0.08)}
    #__pill.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .__yellow{outline:4px solid #facc15 !important; outline-offset:2px; border-radius:10px; box-shadow:0 0 0 6px rgba(250,204,21,0.18)}
    #__offline{position:fixed;left:18px;bottom:18px;background:#064E3B;color:#A7F3D0;border:1px solid #10B981;
      font:600 11px Inter,system-ui;padding:6px 10px;border-radius:999px;z-index:2147483646;letter-spacing:0.02em}
    #__offline i{width:8px;height:8px;background:#10B981;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle;box-shadow:0 0 0 2px rgba(16,185,129,0.35)}
  `;
}

async function showPill(page, text, ms) {
  await page.evaluate(({ text, ms }) => {
    let el = document.getElementById("__pill");
    if (!el) { el = document.createElement("div"); el.id = "__pill"; document.documentElement.appendChild(el); }
    el.textContent = text; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), ms);
  }, { text, ms });
  await page.waitForTimeout(ms + 140);
}

async function moveTo(page, x, y, ms = 520) {
  await page.mouse.move(x, y, { steps: 22 });
  await page.evaluate(({ x, y }) => window.__moveCursor?.(x, y), { x, y });
  await page.waitForTimeout(ms * 0.35);
}

async function clickAt(page, x, y) {
  await moveTo(page, x, y, 520);
  await page.evaluate(({ x, y }) => window.__clickRipple?.(x, y), { x, y });
  await page.mouse.click(x, y);
  await page.waitForTimeout(260);
}

async function run() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  let sb = { chapters: [] };
  try { sb = JSON.parse(readFileSync(STORYBOARD, "utf8")); } catch {}

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  });
  await injectPolished(context);
  const page = await context.newPage();
  await injectPolished(page);

  // Mock SSE — friendly, tool chips visible
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    let msg = ""; try { const j = route.request().postDataJSON(); msg = (j?.message || "").toLowerCase(); } catch {}
    let text = "";
    let toolStart = null, toolEnd = null;
    if (msg.includes("thrashing") || msg.includes("late penalties") || msg.includes("paging")) {
      text = "Thrashing is when the system spends more time paging than executing — Lecture 4 calls it \"excessive page faults from an undersized working set\" [Lecture 4 p.12]. I've moved your review to Aug 31 — want a blind-graded 5-question check on working sets?";
      toolStart = { tool: "search_corpus", args: { query: "thrashing", course: "CS 1100A" } };
      toolEnd = { tool: "search_corpus", result: { hits: 3 } };
    } else if (msg.includes("move") && (msg.includes("aug 31") || msg.includes("review"))) {
      text = "All set! I moved your review from Aug 29 to Aug 31 and logged it to the audit trail — before Aug 29 → after Aug 31. Want that blind-graded quiz now?";
      toolStart = { tool: "mutate_update_assignment", args: { id: 4 } };
      toolEnd = { tool: "mutate_update_assignment", result: { before: "2025-08-19", after: "2025-08-31" } };
    } else {
      text = "Found it — from your CS 1100A syllabus (Late policy): 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.' That's in syllabus.md:4 — want me to open it?";
      toolStart = { tool: "search_corpus", args: { query: "late penalties" } };
      toolEnd = { tool: "search_corpus", result: { hits: 1 } };
    }
    let body = "";
    if (toolStart) body += `event: tool_start\ndata: ${JSON.stringify(toolStart)}\n\n`;
    if (toolEnd) body += `event: tool_end\ndata: ${JSON.stringify(toolEnd)}\n\n`;
    // stream tokens word-by-word for realism
    const words = text.split(/(\s+)/);
    let acc = "";
    for (const w of words) {
      acc += w;
      body += `event: token\ndata: ${JSON.stringify({ text: w })}\n\n`;
    }
    body += `event: done\ndata: ${JSON.stringify({ answer: text })}\n\n`;
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body });
  });

  try {
    // ── 0.0-2.4 Hook: Today ──
    await page.goto(DEMO_URL, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForSelector(".shell", { timeout: 8000 }).catch(() => {});
    await page.addStyleTag({ content: pillCSS() });
    await page.evaluate(() => { document.documentElement.style.zoom = "0.88"; });
    await page.evaluate(() => {
      if (!document.getElementById("__offline")) {
        const o = document.createElement("div"); o.id = "__offline";
        const dot = document.createElement("i");
        o.append(dot, document.createTextNode("Offline ready"));
        document.documentElement.appendChild(o);
      }
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__zoomTo?.(730, 420, 1.18));
    await showPill(page, "Brightspace is scattered. Campus syncs it offline.", 2200);
    await page.evaluate(() => window.__zoomTo?.(960, 540, 1));

    // ── 2.4-5.0 Sync proof ──
    await moveTo(page, 1420, 820, 520);
    await showPill(page, "Offline-first: D2L REST + Playwright MFA → SQLite.", 2200);

    // ── 5.0-9.2 Course hub ──
    await page.goto(`${DEMO_URL}/courses/1`, { waitUntil: "networkidle" });
    await page.waitForSelector(".course-head .page-title", { timeout: 8000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__zoomTo?.(540, 520, 1.26));
    await showPill(page, "Every course, browsable — not a file dump.", 2200);
    const contentTab = page.locator('a:has-text("Content")').first();
    await contentTab.waitFor({ timeout: 4000 }).catch(() => {});
    await clickAt(page, 780, 52);
    await page.waitForTimeout(700);
    const syl = page.locator("text=Syllabus").first();
    if (await syl.count() > 0) { await syl.evaluate((e) => e.classList.add("__yellow")); await page.waitForTimeout(800); }
    await page.evaluate(() => window.__zoomTo?.(1300, 540, 1.22));
    await page.waitForTimeout(900);
    if (await syl.count() > 0) await syl.evaluate((e) => e.classList.remove("__yellow"));

    // ── 9.2-11.6 Pageless PDF ── (stay on Content, the PDF preview is already visible; fake a zoom drag)
    await showPill(page, "Pageless PDF + zen markdown for actual study.", 2000);

    // ── 11.6-12.8 Enter Chat ──
    await page.evaluate(() => window.__zoomTo?.(960, 860, 1.24));
    await showPill(page, "Course-scoped chat. Cited, not hallucinated.", 1400);
    const input = page.locator('textarea[placeholder*="Ask"]').first();
    if ((await input.count()) === 0) {
      await page.goto(`${DEMO_URL}/courses/1`, { waitUntil: "networkidle" });
      await page.waitForSelector('textarea[placeholder*="Ask"]', { timeout: 6000 });
    }

    // ── 12.8-16.8 Ask + tool chips ──
    await humanType(page, 'textarea[placeholder*="Ask"]', "How did the Aug 19 lecture define thrashing? And move my review to Aug 31.", 165);
    await page.locator(".send-btn").first().click();
    await page.waitForSelector(".msg-assistant", { timeout: 10000 });
    await page.waitForTimeout(1600);
    await showPill(page, "Ask anything — watch the tools work.", 1800);

    // ── 16.8-21.2 Answer + audit ──
    const ass = page.locator(".msg-assistant").last();
    await ass.evaluate((e) => e.classList.add("__yellow")).catch(() => {});
    await page.evaluate(() => window.__zoomTo?.(860, 540, 1.16));
    await page.waitForTimeout(1800);
    await ass.evaluate((e) => e.classList.remove("__yellow")).catch(() => {});
    await showPill(page, "Cited answer. Audited mutation. Blind-graded quiz ready.", 2200);

    // ── 21.2-25.0 Finale ──
    await page.goto(DEMO_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__zoomTo?.(960, 540, 1));
    await page.evaluate(() => {
      const bar = document.createElement("div");
      bar.id = "__finale";
      bar.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#18181B;color:white;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:14px 18px;display:flex;gap:14px;align-items:center;z-index:2147483646;box-shadow:0 12px 32px rgba(0,0,0,0.4);font:600 12px Inter,system-ui;letter-spacing:0.02em";
      const left = document.createElement("span");
      left.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center";
      for (const t of ["Python", "Playwright", "FastAPI", "SQLite", "Docker", "PWA"]) {
        const pill = document.createElement("span");
        pill.textContent = t;
        pill.style.cssText = "background:#27272A;border-radius:999px;padding:6px 10px";
        left.append(pill);
      }
      const sep = document.createElement("span");
      sep.style.cssText = "width:1px;height:28px;background:rgba(255,255,255,0.12);display:inline-block";
      const right = document.createElement("span");
      right.textContent = "github.com/HasNate618/Campus · Installable · Works offline";
      bar.append(left, sep, right);
      document.documentElement.appendChild(bar);
    });
    await showPill(page, "Offline-first. Installable. Ships with Docker + CI.", 2600);
    await page.waitForTimeout(800);
  } catch (e) {
    console.error("[demo] failed:", e);
    await page.screenshot({ path: join(VIDEO_DIR, "demo-error.png"), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    await context.close();
    await browser.close();
  }

  const raw = join(VIDEO_DIR, readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm")).sort().pop() || "campus-raw.webm");
  log(`raw ${raw}`);
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    const mp4 = join(VIDEO_DIR, "campus-demo.mp4");
    log("transcode 25s polished");
    execSync(`ffmpeg -y -i "${raw}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 60 -vf "scale=1920:1080:flags=lanczos" -movflags +faststart "${mp4}"`, { stdio: "inherit" });
    const st = statSync(mp4);
    log(`mp4 ${mp4} ${(st.size / 1e6).toFixed(1)}MB`);
    // poster at 21.2s
    execSync(`ffmpeg -y -ss 21.2 -i "${mp4}" -vframes 1 -vf "scale=1920:1080" docs/images/hero.png`, { stdio: "ignore" });
    log("poster docs/images/hero.png");
  } catch { log("no ffmpeg"); }
  log("done");
}
run().catch((e) => { console.error(e); process.exit(1); });
