import { useEffect, useMemo } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import '@/styles/zen.css'

/**
 * Zen markdown rendering — ported from the user's zen-markdown-viewer
 * (marked.parse + highlight.js, GitHub-dark typography). Only the rendering
 * pipeline + styles; no polling, overlays, mermaid, or keyboard features.
 */
export function ZenMarkdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(
    () => (typeof marked.parse === 'function' ? (marked.parse(content ?? '') as string) : ''),
    [content],
  )

  useEffect(() => {
    document.querySelectorAll('.zen-md pre code:not(.language-mermaid)').forEach((block) => {
      hljs.highlightElement(block as HTMLElement)
    })
  }, [html])

  return (
    <div
      className={`zen-md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
