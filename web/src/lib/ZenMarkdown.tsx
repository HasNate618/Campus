import { useMemo, useRef, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import '@/styles/zen.css'
import { parseMarkdown, type CitationMeta } from './md'
import { isInternalHref } from './refs'
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
  assetBase,
}: {
  content: string
  className?: string
  citations?: Record<number, CitationMeta>
  /** Prefix that resolves RELATIVE image srcs to the workspace asset route,
   *  e.g. `/api/assets/2026F/SE3310A`. Omit where relative images cannot be
   *  resolved (the placeholder degradation still applies). */
  assetBase?: string
  /** False while the content can still change (a live chat turn) — the
   *  post-process is skipped so injected diagrams/copy headers can't be wiped
   *  by the next token re-render and re-added, which flickers. */
  frozen?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const html = useMemo(
    () => parseMarkdown(content ?? '', citations, assetBase),
    [content, citations, assetBase],
  )
  // Keep the dangerouslySetInnerHTML object identity stable. React compares
  // that prop by reference, so a fresh `{ __html }` on every parent re-render
  // makes it rewrite innerHTML — wiping injected mermaid/code decorations and
  // resetting the scroll position even when the markdown did not change.
  const inner = useMemo(() => ({ __html: html }), [html])
  useZenPostProcess(ref, [html], frozen)
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
    const href = anchor.getAttribute('href') || ''
    if (!isInternalHref(href)) return
    event.preventDefault()
    navigate(href)
  }
  return (
    <div
      ref={ref}
      className={`md${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={inner}
      onClick={onClick}
    />
  )
}
