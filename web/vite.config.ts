import path from "path";
import { execSync } from "child_process";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Inject <meta name="build" content="<git sha>"> into index.html at build
 *  time. The UI renders it (chat status line) so the served bundle is always
 *  identifiable — a stale index.html would show a build hash that doesn't
 *  match the server's dist, making the old-bundle failure mode visible. */
function buildMeta(): Plugin {
	let hash = "unknown";
	try {
		hash = execSync("git rev-parse --short HEAD", {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		/* not a git checkout — fall back to 'unknown' */
	}
	return {
		name: "inject-build-meta",
		transformIndexHtml(html) {
			return html.replace(
				'<meta charset="UTF-8" />',
				`<meta charset="UTF-8" />\n    <meta name="build" content="${hash}" />`,
			);
		},
	};
}

export default defineConfig({
	plugins: [buildMeta(), react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		host: "0.0.0.0",
		port: 5173,
		proxy: {
			"/api": {
				// CAMPUS_API_TARGET overrides where /api proxies (e.g. :8010 when
				// something else already owns :8000)
				target: process.env.CAMPUS_API_TARGET || "http://127.0.0.1:8000",
				changeOrigin: true,
			},
		},
	},
	preview: {
		host: "0.0.0.0",
		port: 5173,
	},
});
