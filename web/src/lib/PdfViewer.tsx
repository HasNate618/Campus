import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { applyZenFilter } from './zenPdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Canvas-based PDF viewer (pdf.js) styled after the user's zen-pdf-viewer.
 * Zen mode: per-pixel luma inversion (dark-on-light PDFs become light-on-dark)
 * with the paper dropped to transparency (pageless) or a dark shade (paged).
 * Toggles: Zen (inverted) and Pageless (continuous scroll vs one page).
 * Android Chrome has no built-in PDF renderer, so iframes would download —
 * canvas rendering works everywhere.
 */

interface PageCanvasProps {
  doc: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  width: number
  zen: boolean
  pageless: boolean
}

function PageCanvas({ doc, pageNumber, width, zen, pageless }: PageCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let cancelled = false
    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = width / base.width
        const vp = page.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        canvas.style.width = `${Math.floor(vp.width)}px`
        canvas.style.height = `${Math.floor(vp.height)}px`
        return page.render({ canvas, viewport: vp }).promise.then(() => {
          if (!cancelled && zen) applyZenFilter(canvas, pageless, true)
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, width, zen, pageless])

  return (
    <div
      className="pageShell"
      style={{ width: 'fit-content', margin: '0 auto', background: 'transparent' }}
    >
      <canvas ref={ref} style={{ background: 'transparent' }} />
    </div>
  )
}

export function PdfViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(800)
  const [pages, setPages] = useState<number[]>([])
  const [zen, setZen] = useState(true)
  const [pageless, setPageless] = useState(true)
  const [page, setPage] = useState(1)
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null)

  // Load the document; render pages progressively (visible ones first).
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setNumPages(0)
    setError('')
    setZoom(1)
    setPage(1)
    setPages([])
    taskRef.current?.destroy()
    taskRef.current = null
    const task = pdfjsLib.getDocument({ url: src })
    taskRef.current = task
    task.promise
      .then((d) => {
        if (cancelled) return
        setDoc(d)
        setNumPages(d.numPages)
        setPages([1])
        let n = 1
        const timer = window.setInterval(() => {
          n += 1
          if (n > d.numPages) {
            window.clearInterval(timer)
            return
          }
          setPages((prev) => (prev.includes(n) ? prev : [...prev, n]))
        }, 120)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e))
      })
    return () => {
      cancelled = true
      taskRef.current?.destroy()
      taskRef.current = null
    }
  }, [src])

  // Track the container width for fit-width rendering.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setFitWidth(Math.max(320, el.clientWidth - 24))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const resetZoom = useCallback(() => setZoom(1), [])

  if (error) return <div className="empty compact">Couldn&apos;t render PDF: {error}</div>

  const toggleCls = (on: boolean) =>
    `btn btn-outline btn-sm${on ? ' zen-active' : ''}`

  return (
    <div className="pdf-viewer" ref={containerRef}>
      <div
        className="viewer-actions"
        style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 10, flexWrap: 'wrap' }}
      >
        <button className={toggleCls(zen)} onClick={() => setZen((v) => !v)} title="Inverted dark look">
          Zen
        </button>
        <button className={toggleCls(pageless)} onClick={() => setPageless((v) => !v)} title="Continuous scroll vs one page at a time">
          Pageless
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">
          −
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {pageless ? `${numPages} page${numPages === 1 ? '' : 's'}` : `${page} / ${numPages}`}
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} title="Zoom in">
          +
        </button>
        {zoom !== 1 && (
          <button className="btn btn-outline btn-sm" onClick={resetZoom} title="Fit width">
            Fit
          </button>
        )}
      </div>

      {pageless ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {doc &&
            pages.map((n) => (
              <PageCanvas
                key={`${n}-${zen}-${pageless}`}
                doc={doc}
                pageNumber={n}
                width={Math.floor(fitWidth * zoom)}
                zen={zen}
                pageless
              />
            ))}
        </div>
      ) : (
        <>
          {doc && (
            <PageCanvas
              key={`${page}-${zen}-${pageless}`}
              doc={doc}
              pageNumber={page}
              width={Math.floor(fitWidth * zoom)}
              zen={zen}
              pageless={false}
            />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹ Prev
            </button>
            <button className="btn btn-outline btn-sm" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>
              Next ›
            </button>
          </div>
        </>
      )}
    </div>
  )
}
