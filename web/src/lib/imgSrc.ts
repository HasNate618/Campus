/**
 * Resolve image srcs in markdown to the workspace asset route.
 *
 * The agent writes what it just produced, and it writes it as the FULL workspace
 * path it uses with its own tools:
 *
 *     ![q1.2 shapes](2026F/SE3310A/work/assignment2/q12-shapes.png)
 *
 * Sometimes just the tail (`work/a2-q1.1.png`). Both have to resolve, and the
 * course prefix must not be applied twice, which produced
 * `/api/assets/2026F/SE3310A/2026F/SE3310A/...` and a 404 the browser turned
 * into alt text. A leading slash is treated the same way: a workspace path, not
 * a same-origin API path, unless it already points at /api/.
 *
 * Absolute/protocol-relative URLs and data:/blob: URIs are left alone.
 */
export function rewriteImageSrcs(html: string, assetBase: string): string {
	const base = assetBase.replace(/\/+$/, "");
	if (!base) return html;
	// "/api/assets/2026F/SE3310A" -> "2026F/SE3310A"
	const coursePrefix = base.replace(/^\/api\/assets\/?/i, "").replace(/^\/+|\/+$/g, "");
	return html.replace(/<img\b[^>]*>/gi, (tag) => {
		const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
		if (!m) return tag;
		let rel = (m[1] ?? m[2] ?? "").trim();
		if (!rel) return tag;
		if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return tag; // http:, https:, data:, blob:
		if (rel.startsWith("//")) return tag;
		if (/^\/api\//i.test(rel)) return tag;
		rel = rel.replace(/^\/+/, "").replace(/^\.\//, "");
		// Already prefixed with this course: do not prefix it again.
		if (coursePrefix && (rel === coursePrefix || rel.startsWith(`${coursePrefix}/`))) {
			rel = rel.slice(coursePrefix.length).replace(/^\/+/, "");
		}
		if (!rel) return tag;
		const encoded = rel.split("/").map(encodeURIComponent).join("/");
		return tag.replace(m[0], ` src="${base}/${encoded}"`);
	});
}
