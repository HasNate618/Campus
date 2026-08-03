import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Canvas-based PDF viewer (pdf.js) — Android Chrome has no built-in PDF
 * renderer, so iframes just download. Renders on a transparent canvas so
 * the app background shows through (no white box behind the document).
 */
export function PdfViewer({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState('')
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null)

  useEffect(() => {
    let cancelled = false
    setPage(1)
    setNumPages(0)
    setError('')
    taskRef.current?.destroy()
    taskRef.current = null
    const task = pdfjsLib.getDocument({ url: src })
    taskRef.current = task
    task.promise
      .then((doc) => {
        if (cancelled) return
        setNumPages(doc.numPages)
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!taskRef.current || !canvas || page < 1 || page > numPages) return
    let cancelled = false
    taskRef.current.promise.then((doc) => {
      if (cancelled) return
      doc.getPage(page).then((p) => {
        if (cancelled) return
        const base = Math.min(canvas.parentElement?.clientWidth ?? 800, 1000)
        const viewport = p.getViewport({ scale: 1 })
        const scale = base / viewport.width
        const out = p.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1
        canvas.width = out.width * dpr
        canvas.height = out.height * dpr
        canvas.style.width = `${out.width}px`
        canvas.style.height = `${out.height}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.scale(dpr, dpr)
        p.render({ canvas, viewport: out }).promise.catch(() => undefined)
      })
    })
    return () => {
      cancelled = true
    }
  }, [page, numPages])

  if (error) return <div className="empty compact">Couldn&apos;t render PDF: {error}</div>

  return (
    <div className="pdf-viewer" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto', background: 'transparent' }} />
      {numPages > 0 && (
        <div className="viewer-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹ Prev
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {page} / {numPages}
          </span>
          <button className="btn btn-outline btn-sm" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>
            Next ›
          </button>
        </div>
      )}
    </div>
  )
}
