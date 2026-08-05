import { useMemo, useRef } from 'react'
import '@/styles/zen.css'
import { parseMarkdown } from './md'
import { useZenPostProcess } from './zenMd'

/**
 * The ONE markdown renderer for the whole app — chat messages, course
 * content, workspace preview, dashboard digest. Everything goes through
 * the shared parser (LaTeX, footnotes) + the shared post-process
 * (highlight.js, mermaid, code-block copy headers), and every context uses
 * the same `.md` typography, so tables, code blocks and markdown look
 * identical everywhere.
 */
export function ZenMarkdown({ content, className }: { content: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => parseMarkdown(content ?? ''), [content])
  useZenPostProcess(ref, [html])
  return (
    <div
      ref={ref}
      className={`md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
