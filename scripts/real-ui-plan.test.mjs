import test from "node:test";
import assert from "node:assert/strict";
import {
	REAL_UI_FPS,
	REAL_UI_DURATION_FRAMES,
	REAL_UI_SCENES,
	REAL_UI_DURATION_MS,
	REAL_UI_CHAT_INPUT_SELECTOR,
	REAL_UI_SOURCE,
} from "./real-ui-plan.mjs";

test("real UI capture covers the short beat-aligned demo timeline", () => {
	assert.equal(REAL_UI_FPS, 60);
	assert.deepEqual(
		REAL_UI_SCENES.map((scene) => scene.id),
		[
			"intro",
			"home",
			"sync",
			"course",
			"cite",
			"act",
			"quiz",
			"close",
		],
	);
	assert.equal(
		REAL_UI_SCENES.reduce((total, scene) => total + scene.frames, 0),
		REAL_UI_DURATION_FRAMES,
	);
	assert.equal(REAL_UI_DURATION_FRAMES, 2_560);
	assert.equal(REAL_UI_DURATION_MS, 42_666.666666666664);
	assert.ok(
		REAL_UI_SCENES.every(
			(scene) => scene.frames > 0 && Number.isInteger(scene.frames),
		),
	);
});

test("real UI capture targets the production chat composer", () => {
	assert.equal(
		REAL_UI_CHAT_INPUT_SELECTOR,
		'textarea[placeholder^="Ask"]',
	);
});

test("the composition reads the captured production UI", () => {
	assert.equal(REAL_UI_SOURCE, "captures/campus-real-ui.mp4");
});
