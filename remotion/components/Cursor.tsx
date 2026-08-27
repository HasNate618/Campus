import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Cursor: React.FC<{
  from: [number, number];
  to: [number, number];
  clickAt?: number; // frame offset where click ripple fires
}> = ({ from, to, clickAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 20, stiffness: 90 } });
  const x = interpolate(p, [0, 1], [from[0], to[0]]);
  const y = interpolate(p, [0, 1], [from[1], to[1]]);

  const showRipple = clickAt !== undefined && frame >= clickAt && frame < clickAt + 12;
  const rippleP = showRipple
    ? spring({ frame: frame - (clickAt ?? 0), fps, config: { damping: 14, stiffness: 160 } })
    : 0;
  const rippleScale = interpolate(rippleP, [0, 1], [0.6, 1.35]);
  const rippleOpacity = interpolate(rippleP, [0, 1], [0.55, 0]);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: x - 13,
          top: y - 13,
          width: 26,
          height: 26,
          borderRadius: 999,
          background: "white",
          border: "3px solid #111",
          boxShadow: "0 2px 12px rgba(0,0,0,0.55), 0 0 0 3px rgba(139,92,246,0.95)",
          pointerEvents: "none",
        }}
      />
      {showRipple && (
        <div
          style={{
            position: "absolute",
            left: x - 15,
            top: y - 15,
            width: 30,
            height: 30,
            borderRadius: 999,
            border: "2px solid #6366f1",
            opacity: rippleOpacity,
            transform: `scale(${rippleScale})`,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
};
