#!/usr/bin/env node
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const DEMO_URL = process.env.DEMO_URL || "http://localhost:8007";
const VIDEO_DIR = "videos";
const VIEWPORT = { width: 1920, height: 1080 };
function log(s){ console.log(`[demo] ${s}`); }
async function humanType(page, selector, text, base=200){
  const loc = page.locator(selector).first();
  await loc.click({force:true});
  await page.waitForTimeout(160);
  for(const ch of text){
    await page.keyboard.type(ch);
    await page.waitForTimeout(base*(0.75+Math.random()*0.5));
    if(ch===" ") await page.waitForTimeout(80);
  }
}
async function injectCursor(page){
  await page.addInitScript(()=>{
    const c=document.createElement("div"); c.id="__cursor";
    Object.assign(c.style,{position:"fixed",width:"24px",height:"24px",background:"white",border:"3px solid #111",borderRadius:"50%",boxShadow:"0 2px 10px rgba(0,0,0,0.55), 0 0 0 2px rgba(139,92,246,0.9)",pointerEvents:"none",zIndex:"2147483647",left:"0",top:"0",transition:"left 120ms ease, top 120ms ease",willChange:"left, top"});
    document.documentElement.appendChild(c);
    window.__moveCursor=(x,y)=>{c.style.left=x+"px"; c.style.top=y+"px";};
    document.addEventListener("click",e=>{
      const r=document.getElementById("root")||document.querySelector(".shell")||document.body;
      if(!r) return;
      r.style.transition="transform 280ms cubic-bezier(.2,.8,.2,1)";
      r.style.transformOrigin=`${e.clientX}px ${e.clientY}px`;
      r.style.transform="scale(1.12)";
      setTimeout(()=>r.style.transform="scale(1)",700);
    });
  });
}
function pillCSS(){ return `#human-pill{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(17,17,17,0.92);color:white;font:600 18px system-ui;padding:10px 16px;border-radius:999px;z-index:2147483646;opacity:0;transition:opacity 180ms;max-width:88vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.35)} #human-pill.show{opacity:1} .__yellow{outline:4px solid #facc15 !important; outline-offset:2px; border-radius:8px}`; }
async function showPill(page,text,ms){
  await page.evaluate(({text,ms})=>{
    let el=document.getElementById("human-pill");
    if(!el){ el=document.createElement("div"); el.id="human-pill"; document.documentElement.appendChild(el); }
    el.textContent=text; el.classList.add("show");
    setTimeout(()=>el.classList.remove("show"),ms);
  },{text,ms});
  await page.waitForTimeout(ms+120);
}
async function run(){
  mkdirSync(VIDEO_DIR,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:VIEWPORT, recordVideo:{dir:VIDEO_DIR, size:VIEWPORT}});
  await injectCursor(context);
  const page=await context.newPage();
  await injectCursor(page);
  await page.route("**/api/chat", async route=>{
    if(route.request().method()!=="POST") return route.continue();
    let msg=""; try{const j=route.request().postDataJSON(); msg=(j?.message||"").toLowerCase();}catch{}
    let tokenText="", toolStart=null, toolEnd=null;
    if(msg.includes("late penalties")||msg.includes("late penalty")){
      tokenText="Found it — from your CS 1100A syllabus (Late policy):\n> 'Assignments submitted up to 48 hours late incur a penalty of 10 percent per day.'\n\nThat's in `2026F/CS1100A/content/Module 1 - Course Overview/syllabus.md:4` — want me to open it?";
      toolStart={tool:"search_corpus",args:{query:"late penalties",course:"CS 1100A"}}; toolEnd={tool:"search_corpus",result:{hits:1}};
    } else if(msg.includes("extend")&&msg.includes("assignment 1")){
      tokenText="All set! I moved Assignment 1 — Control Flow from Aug 29 to Aug 31 and added your note 'approved per email 2026-09-08'. It's marked as extended and logged to the audit trail.";
      toolStart={tool:"mutate_update_assignment",args:{id:4}}; toolEnd={tool:"mutate_update_assignment",result:{id:4}};
    } else tokenText="Mocked response.";
    let body=""; if(toolStart) body+=`event: tool_start\ndata: ${JSON.stringify(toolStart)}\n\n`; if(toolEnd) body+=`event: tool_end\ndata: ${JSON.stringify(toolEnd)}\n\n`; body+=`event: token\ndata: ${JSON.stringify({text:tokenText})}\n\n`+`event: done\ndata: ${JSON.stringify({answer:tokenText})}\n\n`;
    await route.fulfill({status:200, headers:{"Content-Type":"text/event-stream"}, body});
  });
  try{
    log("open "+DEMO_URL);
    await page.goto(DEMO_URL,{waitUntil:"domcontentloaded", timeout:15000});
    await page.waitForSelector(".shell",{timeout:8000}).catch(()=>{});
    await page.waitForTimeout(800);
    await page.addStyleTag({content:pillCSS()});
    await page.evaluate(()=>{ document.documentElement.style.zoom="0.88"; });
    // hook
    await showPill(page,"Campus — your courses, actually findable",1400);
    await page.mouse.move(200,380,{steps:18}); await page.evaluate(({x,y})=>window.__moveCursor?.(x,y),{x:200,y:380}); await page.waitForTimeout(300);
    await page.mouse.move(600,540,{steps:18}); await page.evaluate(({x,y})=>window.__moveCursor?.(x,y),{x:600,y:540}); await page.waitForTimeout(300);
    // Today
    await showPill(page,"Your week at a glance — digest + next 7 days",2200);
    await page.waitForTimeout(800);
    // Course hub — force navigation and wait for real header
    log("goto /courses/1");
    await page.goto(`${DEMO_URL}/courses/1`,{waitUntil:"networkidle", timeout:10000}).catch(()=>page.goto(`${DEMO_URL}/courses/1`,{waitUntil:"domcontentloaded"}));
    await page.waitForSelector(".course-head .page-title",{timeout:8000});
    log("course-head ready: "+await page.locator(".course-head .page-title").first().textContent());
    await page.waitForTimeout(900);
    await showPill(page,"Every Brightspace file, synced locally — sha256, only what changed",2400);
    // ensure Content tab is visible
    const contentTab = page.locator('a:has-text("Content")').first();
    await contentTab.waitFor({timeout:4000}).catch(()=>{});
    await contentTab.click().catch(()=>{});
    await page.waitForTimeout(800);
    const syl = page.locator("text=Syllabus").first();
    if(await syl.count()>0){ await syl.evaluate(el=>el.classList.add("__yellow")); await page.waitForTimeout(900); await syl.evaluate(el=>el.classList.remove("__yellow")); }
    await page.waitForTimeout(600);
    // Chat — ensure course 1 chat is loaded
    let input = page.locator('textarea[placeholder*="Ask"]').first();
    if(await input.count()===0){
      await page.goto(`${DEMO_URL}/courses/1`,{waitUntil:"networkidle"});
      await page.waitForSelector('textarea[placeholder*="Ask"]',{timeout:6000});
      input = page.locator('textarea[placeholder*="Ask"]').first();
    }
    await showPill(page,"Ask in plain English",1600);
    await humanType(page,'textarea[placeholder*="Ask"]',"where does the syllabus mention late penalties",190);
    await page.locator(".send-btn").first().click();
    await page.waitForSelector(".msg-assistant",{timeout:10000});
    await page.waitForTimeout(1800);
    const ass = page.locator(".msg-assistant").last();
    await ass.evaluate(el=>el.classList.add("__yellow")).catch(()=>{});
    await page.waitForTimeout(1100);
    await showPill(page,"Get the exact line — cited, not guessed",2000);
    // audited mutation
    const assignTab = page.locator('a:has-text("Assignments")').first();
    await assignTab.waitFor({timeout:4000}).catch(()=>{});
    await assignTab.click().catch(()=>{});
    await page.waitForTimeout(700);
    await showPill(page,"Before: due Aug 29",900);
    // back to chat — the split pane keeps chat visible after clicking Assignments? ensure input exists
    const input2 = page.locator('textarea[placeholder*="Ask"]').first();
    if(await input2.count()===0){
      await page.goto(`${DEMO_URL}/courses/1`,{waitUntil:"networkidle"});
      await page.waitForSelector('textarea[placeholder*="Ask"]',{timeout:6000});
    }
    await showPill(page,"Tell it to change — audited, reversible",2200);
    await humanType(page,'textarea[placeholder*="Ask"]','extend Assignment 1 by 2 days — note "approved per email 2026-09-08"',185);
    await page.locator(".send-btn").first().click();
    await page.waitForSelector(".msg-assistant",{timeout:10000});
    await page.waitForTimeout(1600);
    // show after state on Assignments
    await page.locator('a:has-text("Assignments")').first().click().catch(()=>{});
    await page.waitForTimeout(800);
    const row = page.locator("text=Assignment 1").first();
    if(await row.count()>0) await row.evaluate(el=>el.classList.add("__yellow")).catch(()=>{});
    await page.waitForTimeout(900);
    // close
    await page.goto(DEMO_URL,{waitUntil:"domcontentloaded"});
    await page.waitForTimeout(600);
    await showPill(page,"Built with SQLite · 19 tools · sha256 · audited writes",1400);
    await page.waitForTimeout(600);
  }catch(e){ console.error("[demo] failed:",e); await page.screenshot({path:join(VIDEO_DIR,"demo-error.png"),fullPage:true}).catch(()=>{}); throw e; }
  finally{ await context.close(); await browser.close(); }
  const raw = join(VIDEO_DIR, (await import("node:fs")).readdirSync(VIDEO_DIR).filter(f=>f.endsWith(".webm")).sort().pop()||"campus-raw.webm");
  log(`raw ${raw}`);
  try{
    execSync("which ffmpeg",{stdio:"ignore"});
    const mp4 = join(VIDEO_DIR,"campus-demo.mp4");
    log("transcode");
    execSync(`ffmpeg -y -i "${raw}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 60 -vf "scale=1920:1080:flags=lanczos" -c:a aac -b:a 128k -movflags +faststart "${mp4}"`,{stdio:"inherit"});
    const st=(await import("node:fs")).statSync(mp4);
    log(`mp4 ${mp4} ${(st.size/1e6).toFixed(1)}MB`);
  }catch{ log("no ffmpeg"); }
  log("done");
}
run().catch(e=>{console.error(e); process.exit(1);});
