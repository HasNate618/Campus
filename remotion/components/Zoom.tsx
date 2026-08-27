import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Zoom: React.FC<{
  children: React.ReactNode;
  from?: number;
  to: number;
  center?: [number, number]; // 0-1
}> = ({ children, from = 1, to, center = [0.5, 0.5] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const scale = interpolate(p, [0, 1], [from, to]);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: `scale(${scale})`,
        transformOrigin: `${center[0] * 100}% ${center[1] * 100}%`,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};
