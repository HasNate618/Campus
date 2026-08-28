/**
 * Campus design tokens — ported from web/src/styles/global.css ("dark glass").
 */
export const C = {
	backdropHi: "#1e1b4b",
	backdropMid: "#0a0a0f",
	backdropLo: "#050507",

	bg: "#0b0a0f",
	card: "rgba(255,255,255,0.04)",
	cardSolid: "#14131b",
	card2: "#1a1922",
	border: "rgba(255,255,255,0.08)",
	border2: "rgba(255,255,255,0.14)",
	inputBg: "#131218",

	text1: "#ededed",
	text2: "#a1a1a3",
	text3: "#656566",

	primary: "#a78bfa",
	primaryDim: "#7c6cf0",
	primaryBg: "rgba(167,139,250,0.13)",

	green: "#10b981",
	greenBg: "#064e3b",
	greenText: "#a7f3d0",
	amber: "#f59e0b",
	amberBg: "rgba(245,158,11,0.14)",
	red: "#f87171",
	redBg: "rgba(239,68,68,0.14)",

	quoteBar: "#7c6cf0",
	shadow: "0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)",
};

export const FONT = {
	sans: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
	mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

export const SPRING = {
	soft: { damping: 18, stiffness: 110 },
	snappy: { damping: 16, stiffness: 160 },
	bouncy: { damping: 13, stiffness: 170 },
};

/** hero course color (matches app primary for main-character emphasis) */
export const HERO_COLOR = "#8b5cf6";
