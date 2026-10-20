/**
 * Resolve RELATIVE image srcs to the workspace asset route.
 *
 * The agent writes what it just produced: `![](a2-q1.1.png)` or
 * `![](work/a2-q1.1.png)`. The browser resolves that against the SPA route, the
 * server answers with index.html, the decode fails, and the markdown
 * post-process replaces the <img> with a text placeholder — so an agent that has
 * already rendered a PNG still cannot show it.
 *
 * Kept apart from md.ts (which imports KaTeX CSS, so node cannot load it) so
 * the rewrite is unit-testable with node --test.
 */
export function rewriteImageSrcs(html: string, assetBase: string): string {
  const base = assetBase.replace(/\/+$/, '')
  if (!base) return html
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    if (!m) return tag
    const src = (m[1] ?? m[2] ?? '').trim()
    if (!src) return tag
    // Anything with a scheme (http:, https:, data:, blob:) already resolves, and
    // a same-origin path is deliberately pointing somewhere the caller chose.
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return tag
    if (src.startsWith('//') || src.startsWith('/')) return tag
    const rel = src.replace(/^\.\//, '')
    if (!rel) return tag
    const encoded = rel.split('/').map(encodeURIComponent).join('/')
    return tag.replace(m[0], ` src="${base}/${encoded}"`)
  })
}
