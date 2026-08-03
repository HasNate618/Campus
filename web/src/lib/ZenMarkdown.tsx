import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import '@/styles/zen.css'
import { useZenPostProcess } from './zenMd'

/**
 * Zen markdown rendering — ported from the user's zen-markdown-viewer
 * (marked.parse + highlight.js, GitHub-dark typography) + shared zen
 * post-processing: mermaid diagrams, code-block copy headers.
 */
export function ZenMarkdown({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(
    () => (typeof marked.parse === 'function' ? (marked.parse(content ?? '') as string) : ''),
    [content],
  )

  // highlight code after mount + re-run (runs before the post-process hook,
  // which adds the copy headers + mermaid rendering).
  useEffect(() => {
    ref.current?.querySelectorAll('pre code:not(.language-mermaid)').forEach((block) => {
      hljs.highlightElement(block as HTMLElement)
    })
  }, [html])

  useZenPostProcess(ref, [html])

  return (
    <div
      ref={ref}
      className={`zen-md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
