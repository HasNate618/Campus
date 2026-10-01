import { useMemo, useRef } from 'react'
import '@/styles/zen.css'
import { parseMarkdown, type CitationMeta } from './md'
import { useZenPostProcess } from './zenMd'

/**
 * The ONE markdown renderer for the whole app — chat messages, course
 * content, workspace preview, dashboard digest. Everything goes through
 * the shared parser (LaTeX, footnotes, citation chips) + the shared post-process
 * (highlight.js, mermaid, code-block copy headers), and every context uses
 * the same `.md` typography, so tables, code blocks and markdown look
 * identical everywhere.
 */
export function ZenMarkdown({
  content,
  className,
  citations,
  frozen = true,
}: {
  content: string
  className?: string
  citations?: Record<number, CitationMeta>
  /** False while the content can still change (a live chat turn) — the
   *  post-process is skipped so injected diagrams/copy headers can't be wiped
   *  by the next token re-render and re-added, which flickers. */
  frozen?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => parseMarkdown(content ?? '', citations), [content, citations])
  useZenPostProcess(ref, [html], frozen)
  return (
    <div
      ref={ref}
      className={`md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
