import { useCallback, useRef, useState, type ReactNode } from 'react'

interface Props {
  left: ReactNode
  right: ReactNode
  storageKey: string
  defaultPct?: number
  minPct?: number
  maxPct?: number
}

function loadPct(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key))
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

export function SplitPane({ left, right, storageKey, defaultPct = 50, minPct = 25, maxPct = 75 }: Props) {
  const [pct, setPct] = useState(() => loadPct(storageKey, defaultPct))
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const applyPct = useCallback(
    (next: number, persist: boolean) => {
      const clamped = Math.min(maxPct, Math.max(minPct, next))
      setPct(clamped)
      if (persist) localStorage.setItem(storageKey, String(clamped))
    },
    [maxPct, minPct, storageKey],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    applyPct(((e.clientX - rect.left) / rect.width) * 100, false)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    localStorage.setItem(storageKey, String(pct))
  }

  return (
    <div className="split-pane" ref={containerRef}>
      <div className="split-left" style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div
        className={`split-divider${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onDoubleClick={() => applyPct(defaultPct, true)}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to reset"
      />
      <div className="split-right">{right}</div>
    </div>
  )
}
