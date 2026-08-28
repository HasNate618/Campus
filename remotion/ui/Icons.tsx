import type React from "react";

/** minimal lucide-style icon set (24×24, stroke) */
const PATHS: Record<string, string[]> = {
	home: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M10 21v-6h4v6"],
	calendar: [
		"M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
		"M8 3v4M16 3v4M4 10h16",
	],
	refresh: ["M21 12a9 9 0 1 1-2.6-6.4", "M21 3v6h-6"],
	logout: [
		"M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3",
		"M16 17l5-5-5-5",
		"M21 12H9",
	],
	panel: [
		"M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
		"M9 5v14",
	],
	chevD: ["m6 9 6 6 6-6"],
	chevR: ["m9 6 6 6-6 6"],
	arrowUp: ["M12 19V5", "m5 12 7-7 7 7"],
	plus: ["M12 5v14", "M5 12h14"],
	gear: [
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
		"M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1",
	],
	fileText: [
		"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
		"M14 3v5h5",
		"M9 13h6M9 17h4",
	],
	pdf: [
		"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
		"M14 3v5h5",
		"M9 15h6",
	],
	folder: [
		"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
	],
	check: ["m5 12.5 5 5L20 7"],
	bell: [
		"M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 15 6 9",
		"M10.3 20a2 2 0 0 0 3.4 0",
	],
	clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 3"],
	search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "m21 21-4.3-4.3"],
	play: ["M7 5v14l11-7z"],
};

export const Icon: React.FC<{
	name: keyof typeof PATHS;
	size?: number;
	color?: string;
	strokeWidth?: number;
	style?: React.CSSProperties;
}> = ({ name, size = 16, color = "currentColor", strokeWidth = 2, style }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		style={{ flexShrink: 0, ...style }}
	>
		{PATHS[name].map((d, i) => (
			<path
				key={i}
				d={d}
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		))}
	</svg>
);
