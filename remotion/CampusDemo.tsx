import type React from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useVideoConfig } from "remotion";
import { Pill } from "./components/Pill";
import { Cursor } from "./components/Cursor";
import { ToolChipRow } from "./components/ToolChip";
import { Zoom } from "./components/Zoom";

// Frames captured via `nix-shell --run 'node scripts/capture-frames.mjs'`
// Fallback to docs/images if not yet captured — so `remotion studio` works out of the box.
const frame = (name: string) => staticFile(`frames/${name}.png`);

const BG: React.CSSProperties = {
  background:
    "radial-gradient(1200px 600px at 50% -10%, #1e1b4b 0%, #0a0a0f 45%, #050507 100%)",
};

const Card: React.CSSProperties = {
  borderRadius: 18,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset",
  background: "#0f0f12",
};

export const CampusDemo: React.FC = () => {
  const { fps } = useVideoConfig();
  const s = (sec: number) => Math.round(sec * fps);

  return (
    <AbsoluteFill style={BG}>
      {/* ── 0.0–2.4 Hook: Today (bright, zoom to digest) ── */}
      <Sequence from={s(0)} durationInFrames={s(2.4)}>
        <Zoom to={1.18} center={[0.38, 0.42]}>
          <AbsoluteFill style={{ padding: 28 }}>
            <div style={{ ...Card, width: "100%", height: "100%", position: "relative" }}>
              <Img src={frame("today")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
        <Pill text="Brightspace is scattered. Campus syncs it offline." />
        <Cursor from={[960, 540]} to={[480, 380]} />
      </Sequence>

      {/* 2.4–5.0 Sync proof */}
      <Sequence from={s(2.4)} durationInFrames={s(2.6)}>
        <AbsoluteFill style={{ padding: 28 }}>
          <div style={{ ...Card, width: "100%", height: "100%", position: "relative" }}>
            <Img src={frame("today")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </AbsoluteFill>
        <Pill text="Offline-first: D2L REST + Playwright MFA → SQLite." />
        <Cursor from={[480, 380]} to={[1420, 820]} clickAt={18} />
      </Sequence>

      {/* 5.0–9.2 Course hub */}
      <Sequence from={s(5.0)} durationInFrames={s(4.2)}>
        <Zoom to={1.26} center={[0.28, 0.48]}>
          <AbsoluteFill style={{ padding: 28 }}>
            <div style={{ ...Card, width: "100%", height: "100%" }}>
              <Img src={frame("course-hub")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </AbsoluteFill>
        </Zoom>
        <Pill text="Every course, browsable — not a file dump." />
        <Cursor from={[1420, 820]} to={[540, 520]} clickAt={16} />
      </Sequence>

      {/* 9.2–11.6 Pageless PDF */}
      <Sequence from={s(9.2)} durationInFrames={s(2.4)}>
        <Zoom to={1.22} center={[0.68, 0.5]}>
          <AbsoluteFill style={{ padding: 28 }}>
            <div style={{ ...Card, width: "100%", height: "100%" }}>
              <Img src={frame("course-hub")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </AbsoluteFill>
        </Zoom>
        <Pill text="Pageless PDF + zen markdown for actual study." />
      </Sequence>

      {/* 11.6–16.8 Chat: type + tool chips */}
      <Sequence from={s(11.6)} durationInFrames={s(5.2)}>
        <AbsoluteFill style={{ padding: 28 }}>
          <div style={{ ...Card, width: "100%", height: "100%", position: "relative" }}>
            <Img src={frame("chat")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {/* fake typed query */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 118,
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
              How did the Aug 19 lecture define thrashing? And move my review to Aug 31.
            </div>
            <div style={{ position: "absolute", left: 24, top: 24 }}>
              <ToolChipRow
                chips={[
                  { label: "search_corpus", state: "done" },
                  { label: "mutate", state: "running" },
                ]}
              />
            </div>
          </div>
        </AbsoluteFill>
        <Pill text="Ask anything — watch the tools work." />
        <Cursor from={[960, 860]} to={[1500, 240]} />
      </Sequence>

      {/* 16.8–21.2 Answer + audit */}
      <Sequence from={s(16.8)} durationInFrames={s(4.4)}>
        <AbsoluteFill style={{ padding: 28 }}>
          <div style={{ ...Card, width: "100%", height: "100%", position: "relative" }}>
            <Img src={frame("chat-answer")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                bottom: 108,
                background: "rgba(17,24,39,0.96)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: 12,
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 13,
                color: "#e5e7eb",
              }}
            >
              Thrashing is when the system spends more time paging than executing —{" "}
              <span style={{ color: "#facc15" }}>Lecture 4 p.12 [3 sources]</span>. Moved your review Aug 29 → Aug 31 ·
              audited.
            </div>
            <div style={{ position: "absolute", left: 24, top: 24 }}>
              <ToolChipRow
                chips={[
                  { label: "search_corpus ✓ 3 sources", state: "done" },
                  { label: "mutate ✓ Aug 31", state: "done" },
                ]}
              />
            </div>
          </div>
        </AbsoluteFill>
        <Pill text="Cited answer. Audited mutation. Blind-graded quiz ready." />
      </Sequence>

      {/* 21.2–25.0 Close */}
      <Sequence from={s(21.2)} durationInFrames={s(3.8)}>
        <AbsoluteFill style={{ padding: 28, justifyContent: "flex-end" as const }}>
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
            <Img src={frame("today")} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }} />
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
                {["Python", "Playwright", "FastAPI", "SQLite", "Docker", "PWA"].map((t) => (
                  <span key={t} style={{ background: "#27272a", borderRadius: 999, padding: "6px 10px" }}>
                    {t}
                  </span>
                ))}
              </span>
              <span style={{ width: 1, height: 28, background: "rgba(255,255,255,0.12)" }} />
              <span>github.com/HasNate618/Campus · Installable · Works offline</span>
            </div>
          </div>
        </AbsoluteFill>
        <Pill text="Offline-first. Installable. Ships with Docker + CI." />
      </Sequence>
    </AbsoluteFill>
  );
};
