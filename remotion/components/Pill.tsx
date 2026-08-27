import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Pill: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const appear = spring({ frame, fps, config: { damping: 18, stiffness: 180 } });
  const opacity = interpolate(appear, [0, 1], [0, 1]);
  const y = interpolate(appear, [0, 1], [16, 0]);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 64,
        transform: `translateX(-50%) translateY(${y}px)`,
        background: "rgba(14,14,16,0.86)",
        color: "white",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 700,
        fontSize: 32,
        letterSpacing: "-0.01em",
        padding: "14px 26px",
        borderRadius: 999,
        opacity,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.38)",
        maxWidth: "86vw",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
};
