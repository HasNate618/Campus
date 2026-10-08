/**
 * The `[[file:path]]` marker transform.
 *
 * Deliberately dependency-free: this module imports nothing, so Node's built-in
 * test runner can load it directly. `md.ts` cannot be tested that way — it
 * imports katex's CSS, which Node refuses with ERR_UNKNOWN_FILE_EXTENSION.
 */

/** Escape the characters that would break out of an attribute or a text node.
 *  Shared with the citation chips in md.ts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Replace [[file:<data-root-relative path>]] with inline chips.
 *
 * Same seam as renderCitations: this runs on the RAW markdown, before
 * marked.parse, so the chip markup is injected as inline HTML and then
 * sanitized. `marked` does not treat [[…]] as a link (verified against
 * marked 18: `**[[file:x.md]]**` parses to <strong>[[file:x.md]]</strong>),
 * so the marker survives parsing intact.
 *
 * Unlike a citation, the path is written by the model rather than minted
 * server-side — that is the point (it can reference a file it only saw
 * listed), and it is why a path that tries to climb out of the data root is
 * left as literal text instead of becoming a control that cannot work.
 */
export function renderFileRefs(md: string): string {
  if (!/\[\[file:[^\]]+\]\]/.test(md)) return md
  return md.replace(/\[\[file:([^\]]+)\]\]/g, (marker, raw: string) => {
    const path = raw.trim()
    if (!path || path.split('/').includes('..')) return marker
    const label = escapeHtml(path.split('/').pop() || path)
    const attr = escapeHtml(path)
    return `<button type="button" class="file-chip" data-file-path="${attr}" title="${attr}">${label}</button>`
  })
}
