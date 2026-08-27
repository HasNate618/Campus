import type React from "react";
import { Composition } from "remotion";
import { CampusDemo } from "./CampusDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CampusDemo"
        component={CampusDemo}
        durationInFrames={1500} // 25s at 60fps
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
};
