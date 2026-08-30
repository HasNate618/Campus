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
				durationInFrames={DURATION} // 42.7 s @60fps — short beat grid
				fps={60}
				width={1920}
				height={1080}
				defaultProps={{}}
			/>
		</>
	);
};
