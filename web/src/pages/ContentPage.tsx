import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ChevronRight, Columns2, Download, ExternalLink, Maximize2 } from 'lucide-react'
import { api } from '@/api/client'
import { listKeys, useKeyNav, useListCursor, useZoneKeys } from '@/lib/keynav'
import { sanitizeHtml } from '@/lib/sanitize'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import type { ContentNode, FileContent, FileFormat, FileRecord } from '@/types'

const CODE_EXTS = new Set([
  'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'java', 'js', 'json', 'jsx',
  'kt', 'm', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'swift', 'toml',
  'ts', 'tsx', 'xml', 'yaml', 'yml',
])

function fileExt(path: string): string {
  const i = path.lastIndexOf('.')
  return i >= 0 ? path.slice(i + 1).toLowerCase() : ''
}

/** Content page view modes: two-pane desktop layout vs single-panel. */
type ViewMode = 'sideBySide' | 'fullWidth'

/** Per-kind chip for the tree + viewer, derived from the file path/format. */
function kindChip(file: FileRecord, format?: FileFormat): { label: string; cls: string } {
  const ext = fileExt(file.path)
  const fmt: FileFormat | undefined =
    format ??
    (ext === 'pdf'
      ? 'pdf'
      : ext === 'html' || ext === 'htm'
        ? 'html'
        : ext === 'zip'
          ? 'download'
          : ext === 'md' || ext === 'markdown'
            ? 'markdown'
            : CODE_EXTS.has(ext)
              ? 'code'
              : undefined)
  switch (fmt) {
    case 'pdf':
      return { label: 'pdf', cls: 'chip red' }
    case 'html':
      return { label: 'html', cls: 'chip' }
    case 'code':
      return { label: 'code', cls: 'chip violet' }
    case 'download':
      return { label: 'zip', cls: 'chip amber' }
    case 'markdown':
      return { label: 'md', cls: 'chip green' }
    default:
      return { label: ext || file.kind || 'file', cls: 'chip' }
  }
}

function filenameOf(file: FileRecord): string {
  return file.path.split('/').pop() ?? file.path
}

function EmptyFile({ rawUrl, filename }: { rawUrl: string | null; filename: string }) {
  if (!rawUrl) return <div className="empty compact">This file has no content yet.</div>
  return (
    <div className="empty compact" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <p style={{ margin: 0 }}>No preview available for this file.</p>
      <a className="btn btn-outline btn-sm" href={rawUrl} target="_blank" rel="noreferrer noopener">
        <Download size={13} /> Open {filename}
      </a>
    </div>
  )
}

/**
 * The REAL zen-pdf-viewer (github.com/HasNate618/zen-pdf-viewer), served
 * statically from /zen-pdf/viewer.html and embedded full-bleed. The viewer
 * is driven entirely by URL params: ?file= (absolute same-origin raw pdf),
 * zen=1 (per-pixel luma inversion, paper detection → transparent pages),
 * pageless=1 (continuous scroll, visible-page rendering, MRU page cache),
 * plus its own text layer, zoom, rotation and keyboard nav. Rendering
 * happens inside the iframe via pdf.js (canvas/SVG), so this works on
 * Android too — an iframe pointing at the RAW pdf would trigger a download
 * there; this points at an HTML page instead.
 */
function ZenPdfFrame({
  rawUrl,
  fileId,
  filename,
  frameRef,
}: {
  rawUrl: string
  fileId: number
  filename: string
  frameRef?: Ref<HTMLIFrameElement>
}) {
  const src = useMemo(() => {
    const abs = `${window.location.origin}${rawUrl}`
    const q = new URLSearchParams({ file: abs, zen: '1', pageless: '1', t: String(fileId) })
    return `/zen-pdf/viewer.html?${q.toString()}`
  }, [rawUrl, fileId])
  // key remounts the frame per file so switching PDFs never reuses stale
  // viewer state (scroll position, loaded pages).
  return <iframe key={fileId} ref={frameRef} className="zen-pdf-frame" src={src} title={filename} allow="fullscreen" />
}

/** Render just the banner images from a module's Unit Introduction topic
 *  inline on the unit landing page — not the whole topic (that would clone
 *  the intro text into the section page). */
function ModuleIntro({ file }: { file: FileRecord }) {
  const [info, setInfo] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .fileContent(file.id)
      .then((c) => {
        if (!cancelled) setInfo(c)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file.id])
  if (loading) return <div className="empty compact">Loading…</div>
  if (!info || info.format !== 'html' || !info.content) return null
  // pull just the <img> elements out of the intro HTML
  const imgs = (info.content.match(/<img[^>]+>/gi) ?? []).slice(0, 3)
  if (imgs.length === 0) return null
  return (
    <div
      className="md html module-intro-banners"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(imgs.join('\n')) }}
    />
  )
}

function ViewerBody({
  node,
  file,
  introFile,
  contentInfo,
  loading,
  showMd,
  frameRef,
}: {
  node: ContentNode
  file: FileRecord | null
  introFile: FileRecord | null
  contentInfo: FileContent | null
  loading: boolean
  showMd: boolean
  frameRef?: Ref<HTMLIFrameElement>
}) {
  // Module landing page (Brightspace HTML).
  if (node.node_type === 'module') {
    const desc = node.description?.trim() ?? ''
    const hasDesc = desc.length > 0
    // Brightspace mirrors the unit banner INTO the module description (the
    // description renders it + the landing text). The Unit Introduction
    // topic holds the SAME banner (plus the Western logo) — re-extracting
    // it here would duplicate both. Only fall back to the intro topic's
    // images when the description has none of its own.
    const descHasImages = /<img\b/i.test(desc)
    return (
      <>
        {hasDesc && (
          <div className="md html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(desc) }} />
        )}
        {!descHasImages && introFile ? (
          <ModuleIntro file={introFile} />
        ) : !descHasImages && file ? (
          <FileBody file={file} contentInfo={contentInfo} loading={loading} showMd={showMd} frameRef={frameRef} />
        ) : !hasDesc ? (
          <div className="empty compact">This module has no landing page content.</div>
        ) : null}
      </>
    )
  }

  // External link topic. Brightspace stores tool links (dropbox, quiz,
  // gradescope) as RELATIVE /d2l/... quickLink dialogs — target=_blank
  // against the SPA origin would hit the catch-all route (home screen),
  // so rebase them onto Brightspace for the new tab.
  if (node.topic_type === 'link' && node.url) {
    const href = node.url.startsWith('/d2l/')
      ? 'https://westernu.brightspace.com' + node.url
      : node.url
    return (
      <div className="empty compact" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <p style={{ margin: 0 }}>This topic links to an external page.</p>
        <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={14} /> Open link in new tab
        </a>
      </div>
    )
  }

  // HTML-typed topic with embedded description but no linked file.
  if (!file && node.description?.trim()) {
    return <div className="md html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(node.description) }} />
  }

  if (!file) return <div className="empty compact">No file attached to this topic.</div>
  return <FileBody file={file} contentInfo={contentInfo} loading={loading} showMd={showMd} frameRef={frameRef} />
}

function FileBody({
  file,
  contentInfo,
  loading,
  showMd,
  frameRef,
}: {
  file: FileRecord
  contentInfo: FileContent | null
  loading: boolean
  showMd: boolean
  frameRef?: Ref<HTMLIFrameElement>
}) {
  if (loading) return <div className="empty compact">Loading…</div>
  if (!contentInfo) return <div className="empty compact">Couldn&apos;t load this file.</div>

  const { content, format, rawUrl } = contentInfo
  const filename = filenameOf(file)

  switch (format) {
    case 'markdown':
      return content ? (
        <ZenMarkdown content={content} />
      ) : (
        <EmptyFile rawUrl={rawUrl} filename={filename} />
      )
    case 'html':
      return content ? (
        <div className="md html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
      ) : (
        <EmptyFile rawUrl={rawUrl} filename={filename} />
      )
    case 'code':
      return (
        <pre className="code-view">
          <code>{content || '// (empty file)'}</code>
        </pre>
      )
    case 'pdf':
      return (
        <div className="pdf-zen">
          {showMd && content ? (
            <div className="pdf-text-view">
              <ZenMarkdown content={content} />
            </div>
          ) : rawUrl ? (
            <ZenPdfFrame rawUrl={rawUrl} fileId={file.id} filename={filename} frameRef={frameRef} />
          ) : content ? (
            <div className="pdf-text-view">
              <ZenMarkdown content={content} />
            </div>
          ) : (
            <div className="empty compact">PDF unavailable.</div>
          )}
        </div>
      )
    case 'download':
      return (
        <div className="empty compact" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <p style={{ margin: 0 }}>This topic has an attached file.</p>
          <a className="btn btn-primary" href={rawUrl ?? '#'} download={filename}>
            <Download size={14} /> Download {filename}
          </a>
        </div>
      )
    default:
      return rawUrl ? (
        <div className="empty compact" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <a className="btn btn-outline btn-sm" href={rawUrl} target="_blank" rel="noreferrer noopener">
            <Download size={13} /> Open {filename}
          </a>
        </div>
      ) : (
        <div className="empty compact">No preview available for this file.</div>
      )
  }
}

export function ContentPage() {
  const { courseId, nodeId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const fileParam = searchParams.get('file') ? Number(searchParams.get('file')) : null
  const cid = Number(courseId)
  const nid = nodeId ? Number(nodeId) : null
  const [nodes, setNodes] = useState<ContentNode[]>([])
  const [files, setFiles] = useState<FileRecord[]>([])
  const [fileTopics, setFileTopics] = useState<{ file_id: number; topic_id: number }[]>([])
  const [contentInfo, setContentInfo] = useState<FileContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  // The tree hides (display:none) while a topic is viewed in full-width
  // mode — hiding zeroes its scrollTop, and the reset happens inside React
  // Router's navigation transition, so no scroll-event guard can tell it
  // from a real scroll. Capture the position at CLICK time instead (the
  // tree is fully laid out then) and restore it when returning to the list.
  const treeRef = useRef<HTMLDivElement>(null)
  const treeScrollRef = useRef(0)
  const prevNidRef = useRef(nid)
  // PDF keyboard flow: opening a PDF hands input to the viewer (its own
  // j/k, g/G, zoom keys); Escape inside posts a message back so we return
  // to normal app control (sidebar zone).
  const pdfFrameRef = useRef<HTMLIFrameElement>(null)
  // Tab toggles keyboard focus between the tree and the content viewer.
  const [viewerFocus, setViewerFocus] = useState(false)
  const { setZone } = useKeyNav()

  useEffect(() => {
    if (nid === null && prevNidRef.current !== null && treeRef.current) {
      requestAnimationFrame(() => {
        if (treeRef.current) treeRef.current.scrollTop = treeScrollRef.current
      })
    }
    prevNidRef.current = nid
  }, [nid])

  // When the topic changes, viewer focus returns to the tree.
  useEffect(() => setViewerFocus(false), [nid])

  // Escape/Tab inside the zen-pdf viewer → back to app control (Escape →
  // sidebar zone, Tab → tree focus).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'zenpdf-escape') {
        setZone('sidebar')
        pdfFrameRef.current?.blur()
      } else if (e.data?.type === 'zenpdf-tab') {
        setViewerFocus(false)
        pdfFrameRef.current?.blur()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [setZone])

  useEffect(() => {
    setNodes([])
    setFiles([])
    setFileTopics([])
    api
      .contentTree(cid)
      .then(({ nodes: n, files: f, file_topics: ft }) => {
        setNodes(n)
        setFiles(f)
        setFileTopics(ft)
      })
      .catch(console.error)
  }, [cid])

  const selectedNode = nid != null ? nodes.find((n) => n.id === nid) ?? null : null
  // Module-media files can display under MANY topics (file_topics): a topic's
  // files are its primary link (content_node_id) plus any linked rows.
  const filesByTopic = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const ft of fileTopics) {
      const arr = m.get(ft.topic_id) ?? []
      arr.push(ft.file_id)
      m.set(ft.topic_id, arr)
    }
    return m
  }, [fileTopics])
  const filesForNode = (id: number) =>
    files.filter(
      (f) => f.content_node_id === id || (filesByTopic.get(id)?.includes(f.id) ?? false),
    )
  const selectedFile = nid != null
    ? (fileParam != null
        ? files.find((f) => f.id === fileParam) ?? null
        : files.find(
            (f) =>
              f.content_node_id === nid || (filesByTopic.get(nid)?.includes(f.id) ?? false),
          ) ?? null)
    : null
  // Unit landing pages: Brightspace keeps the banner inside the Unit
  // Introduction topic — surface it on the module page too.
  const introFile =
    selectedNode?.node_type === 'module'
      ? (() => {
          const intro = nodes.find((n) => n.parent_id === selectedNode.id && /intro/i.test(n.title))
          return intro ? (files.find((f) => f.content_node_id === intro.id) ?? null) : null
        })()
      : null
  // PDFs: original file by default; extracted text (zen-rendered) as an option.
  const [showMd, setShowMd] = useState(false)
  useEffect(() => setShowMd(false), [nid])

  // When a PDF is shown (not the extracted-text view), keyboard control
  // belongs to the viewer: focus its iframe so j/k/g/G/zoom work there.
  // (viewerFocus starts true so the next Tab returns to the tree.)
  useEffect(() => {
    if (contentInfo?.format === 'pdf' && !showMd && pdfFrameRef.current) {
      pdfFrameRef.current.focus()
      setViewerFocus(true)
    }
  }, [contentInfo?.format, selectedFile?.id, showMd])

  useEffect(() => {
    if (!selectedFile) {
      setContentInfo(null)
      return
    }
    let cancelled = false
    setLoadingContent(true)
    api
      .fileContent(selectedFile.id)
      .then((c) => {
        if (!cancelled) setContentInfo(c)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFile?.id])

  const modules = nodes.filter((n) => n.parent_id === null)
  const children = (parentId: number) => nodes.filter((n) => n.parent_id === parentId)
  const fileName = (f: FileRecord) => f.path.split('/').pop() ?? f.path
  // View mode (toggled from the viewer header): 'fullWidth' (default) = one
  // panel at a time; 'sideBySide' = tree beside the viewer.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem('hc.content.viewMode') === 'sideBySide' ? 'sideBySide' : 'fullWidth'
    } catch {
      return 'fullWidth'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('hc.content.viewMode', viewMode)
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [viewMode])

  // Collapsible tree (per-module).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggleModule = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Flat keyboard-navigable rows in render order (collapsed modules hide
  // their children). Each row maps to the same DOM a recursive render
  // would produce — depth drives the indent, kind drives the classes.
  type TreeRow = { node: ContentNode; depth: number; file?: FileRecord }
  const flatRows = useMemo(() => {
    const out: TreeRow[] = []
    const walk = (node: ContentNode, depth: number) => {
      if (node.node_type === 'module') {
        out.push({ node, depth })
        if (depth === 0 && collapsed.has(node.id)) return
        for (const ch of children(node.id)) walk(ch, depth + 1)
      } else {
        const fs = filesForNode(node.id)
        out.push({ node, depth, file: fs[0] ?? undefined })
        for (const ff of fs.slice(1)) out.push({ node, depth, file: ff })
      }
    }
    for (const m of modules) walk(m, 0)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, collapsed, fileTopics, files])

  const treeCursor = useListCursor(flatRows.length)

  // scroll the content pane (non-PDF viewer mode): the tree and viewer
  // share the course-scroll container
  const scrollViewer = (dy: number) => {
    const el = treeRef.current?.closest('.course-scroll') as HTMLElement | null
    el?.scrollBy({ top: dy })
  }

  useZoneKeys('course', (key) => {
    const row = flatRows[treeCursor.cursor]
    const openRow = (r: TreeRow) => {
      if (!r) return
      const isModule = r.node.node_type === 'module'
      // module: expand when collapsed, else open its landing page
      if (isModule && r.depth === 0 && collapsed.has(r.node.id)) {
        toggleModule(r.node.id)
        return
      }
      const base = `/courses/${cid}/content/${r.node.id}`
      navigate(base + (r.file && r.file.id !== filesForNode(r.node.id)[0]?.id ? `?file=${r.file.id}` : ''))
    }
    // Tab: switch keyboard focus between the tree and the content viewer.
    if (key === 'Tab') {
      if (viewerFocus) {
        // back to the tree — reveal it if full-width was hiding it
        setViewerFocus(false)
        pdfFrameRef.current?.blur()
        if (viewMode === 'fullWidth' && nid != null) setViewMode('sideBySide')
      } else {
        setViewerFocus(true)
        if (contentInfo?.format === 'pdf' && !showMd && pdfFrameRef.current) {
          pdfFrameRef.current.focus()
        }
      }
      return true
    }
    // viewer mode: j/k/g/G scroll the content (a focused PDF iframe owns
    // its own keys and never reaches this handler)
    if (viewerFocus && nid != null) {
      switch (key) {
        case 'j':
        case 'ArrowDown':
          scrollViewer(120)
          return true
        case 'k':
        case 'ArrowUp':
          scrollViewer(-120)
          return true
        case 'g':
        case 'Home':
          scrollViewer(-1e9)
          return true
        case 'G':
        case 'End':
          scrollViewer(1e9)
          return true
        case 'h':
          navigate(`/courses/${cid}/content`)
          return true
        default:
          return false
      }
    }
    if (listKeys(key, treeCursor, () => openRow(row))) return true
    switch (key) {
      case 'h':
        // back to the topic list when viewing something, else collapse the
        // module under the cursor
        if (nid != null) navigate(`/courses/${cid}/content`)
        else if (row?.node.node_type === 'module') toggleModule(row.node.id)
        return true
      case 'f':
        setViewMode((m) => (m === 'fullWidth' ? 'sideBySide' : 'fullWidth'))
        return true
      case 'm':
        if (contentInfo?.format === 'pdf') setShowMd((s) => !s)
        return true
      default:
        return false
    }
  })

  // Recursive tree: courses nest modules arbitrarily deep (SE 2203B:
  // Week 1 → Readings → file topics), so render every level. Depth-based
  // indent keeps the flat pilot tree (depth ≤ 1) pixel-identical.
  const treeIndent = (depth: number) => (depth === 0 ? 8 : 26 + (depth - 1) * 18)
  const renderFlatRow = (row: TreeRow, i: number) => {
    const { node, depth } = row
    const cls = treeCursor.cursor === i ? ' kbd-cursor' : ''
    if (node.node_type === 'module') {
      if (depth > 0) {
        // Nested module = subtopic row (plain, no chevron, always expanded)
        // — only top-level modules read as bold sections with a collapse
        // toggle. Children render beneath regardless. These rows are
        // HTML landing pages — tag them like the pilot's html topics so
        // every topic-style row carries a kind chip (html/pdf/zip/code).
        const descChip = node.description ? (
          <span className="chip" style={{ padding: '1px 6px' }}>html</span>
        ) : null
        return (
          <Link
            key={`n-${node.id}`}
            ref={treeCursor.setRef(i)}
            to={`/courses/${cid}/content/${node.id}`}
            className={`tree-topic tree-submodule${nid === node.id ? ' selected' : ''}${cls}`}
            style={{ paddingLeft: treeIndent(depth) }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.title}
            </span>
            {descChip}
          </Link>
        )
      }
      return (
        <Link
          key={`n-${node.id}`}
          ref={treeCursor.setRef(i)}
          to={`/courses/${cid}/content/${node.id}`}
          className={`tree-module${nid === node.id ? ' selected' : ''}${collapsed.has(node.id) ? ' collapsed' : ''}${cls}`}
          style={{ paddingLeft: treeIndent(depth) }}
        >
          <ChevronRight
            size={13}
            className="tree-module-chevron"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              toggleModule(node.id)
            }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>{node.title}</span>
        </Link>
      )
    }
    const f = row.file ?? null
    const isExtraFile = row.file && filesForNode(node.id)[0]?.id !== row.file.id
    const chip = f ? kindChip(f) : null
    if (isExtraFile) {
      return (
        <Link
          key={`f-${f!.id}`}
          ref={treeCursor.setRef(i)}
          to={`/courses/${cid}/content/${node.id}?file=${f!.id}`}
          className={`tree-file${selectedFile?.id === f!.id ? ' selected' : ''}${cls}`}
          title={f!.path}
          style={{ paddingLeft: treeIndent(depth) + 18 }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName(f!)}
          </span>
          <span className={chip!.cls} style={{ padding: '1px 6px' }}>{chip!.label}</span>
        </Link>
      )
    }
    return (
      <Link
        key={`n-${node.id}`}
        ref={treeCursor.setRef(i)}
        to={`/courses/${cid}/content/${node.id}`}
        className={`tree-topic${nid === node.id ? ' selected' : ''}${cls}`}
        style={{ paddingLeft: treeIndent(depth) }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.title}
        </span>
        {chip && <span className={chip.cls} style={{ padding: '1px 6px' }}>{chip.label}</span>}
      </Link>
    )
  }

  return (
    <div className={`split split-mode-${viewMode === 'sideBySide' ? 'split' : 'full'}${nid != null ? ' has-selection' : ''}`}>
      <div
        className="card split-tree"
        ref={treeRef}
        onClickCapture={() => {
          // capture the tree's position at the moment a topic is clicked
          // (before the router's transition hides the tree)
          if (treeRef.current) treeScrollRef.current = treeRef.current.scrollTop
        }}
      >
        {modules.length === 0 && <div className="empty compact">No content synced.</div>}
        {flatRows.map((row, i) => renderFlatRow(row, i))}
      </div>

      <div className={`card split-viewer${contentInfo?.format === 'pdf' ? ' pdf-mode' : ''}`} style={{ minHeight: 300 }}>
        {!selectedNode ? (
          <div className="empty">Select a topic from the tree.</div>
        ) : (
          <>
            <div className="viewer-head">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
                <Link
                  to={`/courses/${cid}/content`}
                  style={{ color: 'var(--violet)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content' }}
                >
                  <ArrowLeft size={13} /> All topics
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {contentInfo?.format === 'pdf' && selectedFile && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setShowMd((s) => !s)}
                      title="Toggle between the original PDF and the extracted text"
                    >
                      {showMd ? 'Original PDF' : 'Extracted text'}
                    </button>
                  )}
                  <button
                    onClick={() => setViewMode((m) => (m === 'fullWidth' ? 'sideBySide' : 'fullWidth'))}
                    title={viewMode === 'fullWidth' ? 'Show the content tree beside the viewer' : 'Show one panel at a time'}
                    className="icon-btn view-toggle"
                  >
                    {viewMode === 'fullWidth' ? <Columns2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                </div>
              </div>
              <div className="viewer-title">{selectedNode.title}</div>
              {selectedFile && <div className="viewer-path">{selectedFile.path}</div>}
            </div>
            <motion.div
              key={nid ?? 'none'}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <ViewerBody
                node={selectedNode}
                file={selectedFile}
                introFile={introFile}
                contentInfo={contentInfo}
                loading={loadingContent}
                showMd={showMd}
                frameRef={pdfFrameRef}
              />
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
