export const REAL_UI_FPS = 60;
export const REAL_UI_CHAT_INPUT_SELECTOR = 'textarea[placeholder^="Ask"]';
export const REAL_UI_SOURCE = "captures/campus-real-ui.mp4";

export const REAL_UI_SCENES = [
	{ id: "intro", route: "/", frames: 120 },
	{ id: "home", route: "/", frames: 240 },
	{ id: "sync", route: "/sync", frames: 120 },
	{ id: "course", route: "/courses/1/content", frames: 120 },
	{ id: "cite", route: "/courses/1", frames: 800 },
	{ id: "act", route: "/courses/1", frames: 480 },
	{ id: "quiz", route: "/courses/1", frames: 400 },
	{ id: "close", route: "/", frames: 280 },
].map((scene) => ({
	...scene,
	durationMs: (scene.frames / REAL_UI_FPS) * 1000,
}));

export const REAL_UI_DURATION_FRAMES = REAL_UI_SCENES.reduce(
	(total, scene) => total + scene.frames,
	0,
);
export const REAL_UI_DURATION_MS =
	(REAL_UI_DURATION_FRAMES / REAL_UI_FPS) * 1000;

export function sceneStartMs(id) {
	let start = 0;
	for (const scene of REAL_UI_SCENES) {
		if (scene.id === id) return start;
		start += scene.durationMs;
	}
	throw new Error(`Unknown real UI scene: ${id}`);
}
