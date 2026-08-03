import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Canvas-based PDF viewer (pdf.js) styled after the user's zen-pdf-viewer:
 * pageless continuous scroll, every page on a transparent shell (no colored
 * background — the app surface shows through), subtle page shadows, zen
 * toolbar. Android Chrome has no built-in PDF renderer, so iframes would
 * just download — canvas rendering works everywhere.
 */

interface PageCanvasProps {
  doc: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  width: number
}

function PageCanvas({ doc, pageNumber, width }: PageCanvasProps) {
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
        page.render({ canvas, viewport: vp }).promise.catch(() => undefined)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, width])

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
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null)

  // Load the document; render pages progressively (visible ones first).
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setNumPages(0)
    setError('')
    setZoom(1)
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
        // seed the first page immediately, then fill the rest
        const first: number[] = [1]
        setPages(first)
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

  // Track the container width for fit-width rendering (debounced via rAF).
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

  return (
    <div className="pdf-viewer" ref={containerRef}>
      <div className="viewer-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out">
          −
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }} title="Scroll to read">
          {numPages} page{numPages === 1 ? '' : 's'}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {doc &&
          pages.map((n) => (
            <PageCanvas key={n} doc={doc} pageNumber={n} width={Math.floor(fitWidth * zoom)} />
          ))}
      </div>
    </div>
  )
}
