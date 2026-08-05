import { useEffect, type RefObject } from 'react'

/**
 * Shared markdown post-processing (used by both the chat renderer and the
 * zen content renderer) — upgrades marked output in place:
 *   1. Mermaid: ```mermaid fences → rendered SVG (lazy import, dark theme)
 *   2. Code blocks: wrapped with a header bar (language + copy button)
 * Elements are marked with data-zen-processed so re-runs (per token while
 * streaming) never duplicate work.
 */

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })
      return m.default
    })
  }
  return mermaidPromise
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Minimal inline SVG helper for the copy/check icons (lucide-style). */
function iconSvg(paths: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const COPY_ICON = iconSvg(
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
)
const CHECK_ICON = iconSvg('<path d="M20 6 9 17l-5-5"/>')

export function useZenPostProcess(ref: RefObject<HTMLElement | null>, _deps: unknown[]): void {
  // Runs after EVERY render (no deps array): any re-render that resets the
  // message DOM (e.g. reload, context updates) gets re-decorated within the
  // debounce window — without this, a reset left the raw markdown stuck
  // (code blocks/mermaid flashed decorated, then reverted permanently).
  useEffect(() => {
    const root = ref.current
    if (!root) return

    // The heavy DOM scanning below is trailing-debounced (~250ms): during
    // token streaming the text renders at frame rate and the decorations
    // (copy buttons, mermaid) settle right after the message stops growing.
    // Blocks inside a still-streaming message (.streaming) are skipped so
    // the header doesn't flicker on every token.
    const scanTimer = window.setTimeout(() => {
    if (!root.isConnected) return
    const streaming = !!root.closest('.streaming')

    // 1. Mermaid blocks → SVG diagrams
    const mermaidBlocks = Array.from(
      root.querySelectorAll<HTMLElement>('pre > code.language-mermaid:not([data-zen-processed])'),
    )
    if (mermaidBlocks.length && !streaming) {
      loadMermaid().then((mm) => {
        mermaidBlocks.forEach((code) => {
          code.setAttribute('data-zen-processed', '1')
          const pre = code.parentElement
          if (!pre) return
          const source = code.textContent ?? ''
          const wrap = document.createElement('div')
          wrap.className = 'mermaid-wrap'
          wrap.innerHTML = '<div class="mermaid"></div>'
          pre.replaceWith(wrap)
          const slot = wrap.querySelector('.mermaid') as HTMLElement
          const id = 'mmd' + Math.random().toString(36).slice(2, 10)
          void mm
            .render(id, source)
            .then((res) => {
              slot.innerHTML = res.svg
            })
            .catch(() => {
              wrap.outerHTML = `<pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>`
            })
        })
      })
    }

    // 2. Code blocks: header bar with language label + copy button
    root.querySelectorAll<HTMLElement>('pre > code:not([data-zen-processed])').forEach((code) => {
      if (streaming) return
      code.setAttribute('data-zen-processed', '1')
      const pre = code.parentElement
      if (!pre) return
      const langMatch = (code.className || '').match(/language-([\w+#.-]+)/)
      const lang = langMatch ? langMatch[1] : 'text'
      const header = document.createElement('div')
      header.className = 'code-header'
      const langEl = document.createElement('span')
      langEl.className = 'lang'
      langEl.textContent = lang
      const btn = document.createElement('button')
      btn.className = 'copy-btn'
      btn.type = 'button'
      btn.title = 'Copy'
      btn.innerHTML = COPY_ICON
      btn.addEventListener('click', () => {
        const text = code.textContent ?? ''
        const done = () => {
          btn.innerHTML = CHECK_ICON
          btn.title = 'Copied'
          window.setTimeout(() => {
            btn.innerHTML = COPY_ICON
            btn.title = 'Copy'
          }, 1500)
        }
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(done)
        } else {
          // execCommand fallback
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          try {
            document.execCommand('copy')
          } catch {
            /* ignore */
          }
          document.body.removeChild(ta)
          done()
        }
      })
      header.appendChild(langEl)
      header.appendChild(btn)
      pre.prepend(header)
    })

    // 3. Images: a src that can't load (dead URL, broken path) degrades to
    //    a styled placeholder instead of a bare broken-image icon.
    root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      if (img.dataset.fb) return
      img.dataset.fb = '1'
      const fallback = () => {
        const span = document.createElement('span')
        span.className = 'md-img-fallback'
        span.textContent = img.alt || 'image'
        img.replaceWith(span)
      }
      // already-failed images (loaded before the listener attached)
      if (img.complete && img.naturalWidth === 0) {
        fallback()
        return
      }
      img.addEventListener('error', fallback, { once: true })
    })
    // 4. Mermaid zoom-on-click: click a rendered diagram → fullscreen overlay
    }, 250)
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const wrap = target.closest('.mermaid-wrap')
      if (!wrap || !root.contains(wrap)) return
      const svg = wrap.querySelector('svg')
      if (!svg) return
      const overlay = document.createElement('div')
      overlay.className = 'mermaid-overlay'
      overlay.innerHTML = `<div class="mermaid-overlay-inner"><button class="mermaid-overlay-close" title="Close">✕</button><div class="mermaid-overlay-body"></div></div>`
      ;(overlay.querySelector('.mermaid-overlay-body') as HTMLElement).appendChild(
        svg.cloneNode(true) as Node,
      )
      overlay.addEventListener('click', () => overlay.remove())
      document.body.appendChild(overlay)
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      window.clearTimeout(scanTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })
}
