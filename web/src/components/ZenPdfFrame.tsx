import { useMemo, type Ref } from 'react'

/**
 * The zen-pdf-viewer, served from /zen-pdf/viewer.html and embedded as an
 * iframe. A raw PDF iframe would depend on the browser's built-in PDF support
 * (and trigger a download on Android), so every PDF in the app goes through
 * this HTML viewer instead.
 *
 * `fileId` is only a cache/remount key; workspace files can pass their path.
 */
export function ZenPdfFrame({
  rawUrl,
  fileId,
  filename,
  frameRef,
  startPage,
}: {
  rawUrl: string
  fileId: number | string
  filename: string
  frameRef?: Ref<HTMLIFrameElement>
  startPage?: number | null
}) {
  const src = useMemo(() => {
    const abs = `${window.location.origin}${rawUrl}`
    const q = new URLSearchParams({
      file: abs,
      zen: '1',
      pageless: '1',
      embed: '1',
      t: String(fileId),
    })
    if (startPage != null && startPage >= 1) q.set('page', String(startPage))
    return `/zen-pdf/viewer.html?${q.toString()}`
  }, [rawUrl, fileId, startPage])

  return (
    <iframe
      key={String(fileId)}
      ref={frameRef}
      className="zen-pdf-frame"
      src={src}
      title={filename}
      allow="fullscreen"
    />
  )
}
