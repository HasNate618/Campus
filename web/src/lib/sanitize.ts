/**
 * Minimal HTML sanitizer for Brightspace-authored content (module landing
 * pages, html files). Zero-dependency: parses with DOMParser in a detached
 * document, then rebuilds only allowlisted tags/attributes.
 *
 * NOT a replacement for DOMPurify in hostile contexts — Brightspace HTML is
 * semi-trusted; this is an accident-prevention layer (strip scripts, event
 * handlers, unsafe URLs, iframes, styles).
 */

const ALLOWED_TAGS = new Set([
  'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'FIGCAPTION',
  'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'LI',
  'OL', 'P', 'PRE', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
])

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'colspan', 'height', 'href', 'rel', 'rowspan', 'src',
  'target', 'title', 'width',
])

/** Only http(s), mailto, anchors, and relative URLs survive. */
function safeUrl(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (v.startsWith('#') || v.startsWith('/')) return v
  try {
    const u = new URL(v)
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return v
  } catch {
    return null
  }
  return null
}

/** Brightspace-hosted images need the token-authed proxy (browser has no
 *  Brightspace session — direct img srcs 401). */
const PROXY_HOSTS = new Set(['westernu.brightspace.com', 's.brightspace.com'])

function proxifyUrl(value: string): string {
  try {
    const u = new URL(value)
    if (PROXY_HOSTS.has(u.hostname)) {
      return `/api/proxy?url=${encodeURIComponent(value)}`
    }
  } catch {
    /* keep as-is */
  }
  return value
}

function sanitizeNode(node: Node, out: HTMLElement): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(document.createTextNode(child.textContent ?? ''))
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as HTMLElement
    const tag = el.tagName
    if (!ALLOWED_TAGS.has(tag)) continue // drop script/iframe/style/etc.

    const clone = document.createElement(tag)
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (!ALLOWED_ATTRS.has(name)) continue
      let value = attr.value
      if (name === 'href' || name === 'src') {
        const url = safeUrl(value)
        if (!url) continue
        value = url
      }
      // Never allow javascript: or data: URLs even through case tricks.
      if (/^\s*(javascript|data|vbscript):/i.test(value)) continue
      if (name === 'src' && tag === 'IMG') value = proxifyUrl(value)
      clone.setAttribute(name, value)
    }
    if (tag === 'A') {
      clone.setAttribute('rel', 'noreferrer noopener')
      if (!clone.hasAttribute('target')) clone.setAttribute('target', '_blank')
    }
    if (tag === 'IMG' && !clone.hasAttribute('alt')) clone.setAttribute('alt', '')
    sanitizeNode(el, clone)
    out.appendChild(clone)
  }
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = document.createElement('div')
  sanitizeNode(doc.body, out)
  return out.innerHTML
}
