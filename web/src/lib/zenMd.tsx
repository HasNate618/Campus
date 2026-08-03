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

export function useZenPostProcess(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return

    // 1. Mermaid blocks → SVG diagrams
    const mermaidBlocks = Array.from(
      root.querySelectorAll<HTMLElement>('pre > code.language-mermaid:not([data-zen-processed])'),
    )
    if (mermaidBlocks.length) {
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
      btn.textContent = 'Copy'
      btn.addEventListener('click', () => {
        const text = code.textContent ?? ''
        const done = () => {
          btn.textContent = 'Copied'
          window.setTimeout(() => (btn.textContent = 'Copy'), 1500)
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
    // 3. Mermaid zoom-on-click: click a rendered diagram → fullscreen overlay
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
    return () => root.removeEventListener('click', onClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
