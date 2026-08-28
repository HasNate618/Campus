import type React from "react";
import { Composition } from "remotion";
import { CampusDemo } from "./CampusDemo";
import { DURATION } from "./data/demo";

export const RemotionRoot: React.FC = () => {
	return (
		<>
			<Composition
				id="CampusDemo"
				component={CampusDemo}
				durationInFrames={DURATION} // 88 s @60fps — 90 BPM beat grid
				fps={60}
				width={1920}
				height={1080}
				defaultProps={{}}
			/>
		</>
	);
};
