import type React from "react";
import { AbsoluteFill, staticFile } from "remotion";

/** vendored variable fonts — deterministic offline renders, no network */
export const Fonts: React.FC = () => (
	<style>{`
		@font-face {
			font-family: 'Plus Jakarta Sans';
			src: url(${staticFile("fonts/plus-jakarta-sans.woff2")}) format('woff2');
			font-weight: 200 800;
			font-style: normal;
		}
		@font-face {
			font-family: 'JetBrains Mono';
			src: url(${staticFile("fonts/jetbrains-mono.woff2")}) format('woff2');
			font-weight: 100 800;
			font-style: normal;
		}
	`}</style>
);
