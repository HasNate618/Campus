import { Link, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'
import { api } from '@/api/client'
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
function ZenPdfFrame({ rawUrl, fileId, filename }: { rawUrl: string; fileId: number; filename: string }) {
  const src = useMemo(() => {
    const abs = `${window.location.origin}${rawUrl}`
    const q = new URLSearchParams({ file: abs, zen: '1', pageless: '1', t: String(fileId) })
    return `/zen-pdf/viewer.html?${q.toString()}`
  }, [rawUrl, fileId])
  // key remounts the frame per file so switching PDFs never reuses stale
  // viewer state (scroll position, loaded pages).
  return <iframe key={fileId} className="zen-pdf-frame" src={src} title={filename} allow="fullscreen" />
}

function ViewerBody({
  node,
  file,
  contentInfo,
  loading,
}: {
  node: ContentNode
  file: FileRecord | null
  contentInfo: FileContent | null
  loading: boolean
}) {
  // Module landing page (Brightspace HTML).
  if (node.node_type === 'module') {
    if (node.description?.trim()) {
      return <div className="md html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(node.description) }} />
    }
    if (file) return <FileBody file={file} contentInfo={contentInfo} loading={loading} />
    return <div className="empty compact">This module has no landing page content.</div>
  }

  // External link topic.
  if (node.topic_type === 'link' && node.url) {
    return (
      <div className="empty compact" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <p style={{ margin: 0 }}>This topic links to an external page.</p>
        <a className="btn btn-primary" href={node.url} target="_blank" rel="noreferrer noopener">
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
  return <FileBody file={file} contentInfo={contentInfo} loading={loading} />
}

function FileBody({
  file,
  contentInfo,
  loading,
}: {
  file: FileRecord
  contentInfo: FileContent | null
  loading: boolean
}) {
  // PDFs: original file by default; extracted text (zen-rendered) as an option.
  const [showMd, setShowMd] = useState(false)
  useEffect(() => setShowMd(false), [file.id])

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
          {(rawUrl || content) && (
            <div className="viewer-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              {rawUrl && (
                <button className="btn btn-outline btn-sm" onClick={() => setShowMd((s) => !s)}>
                  {showMd ? 'View original PDF' : 'View extracted text'}
                </button>
              )}
              {file.processed === 0 && (
                <span className="viewer-note">Text extraction pending — showing the original PDF.</span>
              )}
            </div>
          )}
          {showMd && content ? (
            <div className="pdf-text-view">
              <ZenMarkdown content={content} />
            </div>
          ) : rawUrl ? (
            <ZenPdfFrame rawUrl={rawUrl} fileId={file.id} filename={filename} />
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
  const cid = Number(courseId)
  const nid = nodeId ? Number(nodeId) : null
  const [nodes, setNodes] = useState<ContentNode[]>([])
  const [files, setFiles] = useState<FileRecord[]>([])
  const [contentInfo, setContentInfo] = useState<FileContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)

  useEffect(() => {
    setNodes([])
    setFiles([])
    api
      .contentTree(cid)
      .then(({ nodes: n, files: f }) => {
        setNodes(n)
        setFiles(f)
      })
      .catch(console.error)
  }, [cid])

  const selectedNode = nid != null ? nodes.find((n) => n.id === nid) ?? null : null
  const selectedFile = nid != null ? files.find((f) => f.content_node_id === nid) ?? null : null

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
  const fileForNode = (id: number) => files.find((f) => f.content_node_id === id)

  // Collapsible tree (per-module).
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggleModule = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={`split split-mode-full${nid != null ? ' has-selection' : ''}`}>
      <div className="card split-tree">
        {modules.length === 0 && <div className="empty compact">No content synced.</div>}
        {modules.map((mod) => (
          <div key={mod.id}>
            <Link
              to={`/courses/${cid}/content/${mod.id}`}
              className={`tree-module${nid === mod.id ? ' selected' : ''}${collapsed.has(mod.id) ? ' collapsed' : ''}`}
            >
              <ChevronRight
                size={13}
                className="tree-module-chevron"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleModule(mod.id)
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>{mod.title}</span>
            </Link>
            {!collapsed.has(mod.id) &&
              children(mod.id).map((topic) => {
                const f = fileForNode(topic.id)
                const chip = f ? kindChip(f) : null
                return (
                  <Link
                    key={topic.id}
                    to={`/courses/${cid}/content/${topic.id}`}
                    className={`tree-topic${nid === topic.id ? ' selected' : ''}`}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {topic.title}
                    </span>
                    {chip && <span className={chip.cls} style={{ padding: '1px 6px' }}>{chip.label}</span>}
                  </Link>
                )
              })}
          </div>
        ))}
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
              </div>
              <div className="viewer-title">{selectedNode.title}</div>
              {selectedFile && <div className="viewer-path">{selectedFile.path}</div>}
            </div>
            <ViewerBody
              node={selectedNode}
              file={selectedFile}
              contentInfo={contentInfo}
              loading={loadingContent}
            />
          </>
        )}
      </div>
    </div>
  )
}
