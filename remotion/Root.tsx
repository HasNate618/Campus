import type React from "react";
import { Composition } from "remotion";
import { CampusDemo } from "./CampusDemo";

export const RemotionRoot: React.FC = () => {
	return (
		<>
			<Composition
				id="CampusDemo"
				component={CampusDemo}
				durationInFrames={1800} // 30s at 60fps — rebalanced for holds + readability (was 1500f too fast)
				fps={60}
				width={1920}
				height={1080}
				defaultProps={{}}
			/>
		</>
	);
};
