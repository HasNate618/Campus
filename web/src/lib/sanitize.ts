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
  'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IFRAME', 'IMG',
  'LI', 'OL', 'P', 'PRE', 'SMALL', 'SOURCE', 'SPAN', 'STRONG', 'SUB', 'SUP',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL', 'VIDEO',
])

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'colspan', 'controls', 'height', 'href', 'poster', 'rel',
  'rowspan', 'src', 'target', 'title', 'type', 'width',
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
 *  Brightspace session — direct img srcs 401). The host allowlist is
 *  config-driven, fetched from /api/config at boot; empty = no proxying. */
let PROXY_HOSTS = new Set<string>()

export function setProxyHosts(hosts: string[]): void {
  PROXY_HOSTS = new Set(hosts)
}

/**
 * IFRAMES: allow ONLY YouTube embeds. The classic sanitizer risk is
 * arbitrary iframes (srcdoc injection, chrome-extension:, data:). We keep
 * it to a fixed host set + a fixed attribute list; everything else is
 * dropped with the iframe.
 */
const YOUTUBE_EMBED_RE = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\/[A-Za-z0-9_-]+/
const IFRAME_ATTRS = new Set([
  'allow', 'allowfullscreen', 'frameborder', 'height', 'loading',
  'referrerpolicy', 'title', 'width',
])

function sanitizeIframe(el: HTMLElement, clone: HTMLElement): boolean {
  const src = el.getAttribute('src') ?? ''
  if (!YOUTUBE_EMBED_RE.test(src.trim())) return false
  for (const attr of IFRAME_ATTRS) {
    if (el.hasAttribute(attr)) clone.setAttribute(attr, el.getAttribute(attr) ?? '')
  }
  clone.setAttribute('src', src.trim())
  clone.setAttribute('allowfullscreen', '')
  return true
}

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
    if (!ALLOWED_TAGS.has(tag)) continue // drop script/style/etc.

    const clone = document.createElement(tag)
    if (tag === 'IFRAME') {
      // strict YouTube-embed allowlist; drop anything else (no srcdoc,
      // no arbitrary hosts)
      if (sanitizeIframe(el, clone)) out.appendChild(clone)
      continue
    }
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
      // Only external links open in a new tab; campus-internal links
      // (relative or same-origin) must navigate in the current tab — this
      // also STRIPS a baked-in target="_blank" that came from Brightspace
      // (the sync rewrite localizes hrefs but keeps the original attribute).
      const href = clone.getAttribute('href') ?? ''
      const external = /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)
      if (external) {
        if (!clone.hasAttribute('target')) clone.setAttribute('target', '_blank')
      } else {
        clone.removeAttribute('target')
      }
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
