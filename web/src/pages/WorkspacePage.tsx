import { Fragment, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bot, ChevronDown, ChevronRight, FileText, FileCode2, FileType,
  Folder, FolderLock, Lock, Pencil, Plus, RefreshCw, Save, Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import type { WorkspaceNode, WorkspaceTree } from '@/types'

const TEXT_KINDS = new Set(['md', 'txt', 'html', 'htm', 'json', 'yaml', 'yml', 'csv', 'py', 'ts', 'tsx', 'js', 'css', 'nix', 'sh'])

function kindIcon(kind?: string) {
  if (kind === 'md' || kind === 'txt') return <FileText size={13} />
  if (kind === 'pdf' || kind === 'doc' || kind === 'docx') return <FileType size={13} />
  return <FileCode2 size={13} />
}

function TreeNode({
  node, depth, cid, openDirs, openPath, onToggle, onOpen,
}: {
  node: WorkspaceNode
  depth: number
  cid: number
  openDirs: Set<string>
  openPath: string | null
  onToggle: (p: string) => void
  onOpen: (n: WorkspaceNode) => void
}) {
  const isDir = node.type === 'dir'
  const open = openDirs.has(node.path)
  const active = openPath === node.path && !isDir
  return (
    <Fragment>
      <button
        className={`ws-node${active ? ' active' : ''}${node.writable && !isDir ? '' : ' ro'}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (isDir ? onToggle(node.path) : onOpen(node))}
        title={isDir ? (node.writable ? 'editable' : 'read-only') : `${node.path}${node.writable ? '' : ' · read-only'}`}
      >
        {isDir ? (
          open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>{kindIcon(node.kind)}</span>
        )}
        <span className="ws-name">{node.name}</span>
        {isDir ? (
          node.writable ? <Pencil size={10} className="ws-badge" /> : <Lock size={10} className="ws-badge" />
        ) : (
          node.writable ? null : <Lock size={10} className="ws-badge" />
        )}
      </button>
      {isDir && open && node.children?.map((c) => (
        <TreeNode key={c.path} node={c} depth={depth + 1} cid={cid} openDirs={openDirs} openPath={openPath} onToggle={onToggle} onOpen={onOpen} />
      ))}
    </Fragment>
  )
}

export function WorkspacePage() {
  const { courseId } = useParams()
  const cid = Number(courseId)
  const [tree, setTree] = useState<WorkspaceTree | null>(null)
  // expanded DIRECTORY paths — a Set so subfolders can stay open under an
  // open parent (a single open-path string made any subfolder click
  // collapse its parent instead)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  // the currently OPEN FILE (shown in the editor)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [current, setCurrent] = useState<WorkspaceNode | null>(null)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [preview, setPreview] = useState(false)
  const [assetUrl, setAssetUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newFileDir, setNewFileDir] = useState<string>('notes')

  const loadTree = useCallback(() => {
    api.workspaceTree(cid).then(setTree).catch(() => setTree(null)).finally(() => setLoading(false))
  }, [cid])

  useEffect(() => { loadTree() }, [loadTree])

  const dirty = current != null && text !== savedText && !preview

  const openNode = async (n: WorkspaceNode) => {
    setCurrent(n)
    setOpenPath(n.path)
    setPreview(false)
    setAssetUrl(null)
    setNotice(null)
    if (n.type === 'file') {
      try {
        const r = await api.workspaceRead(cid, n.path)
        if (r.viewable) {
          setText(r.text ?? '')
          setSavedText(r.text ?? '')
        } else {
          setText('')
          setSavedText('')
          setAssetUrl(r.asset)
        }
      } catch {
        setNotice('Could not read the file.')
      }
    }
  }

  const save = async () => {
    if (!current || current.type !== 'file' || !current.writable) return
    setBusy(true)
    try {
      await api.workspaceWrite(cid, current.path, text)
      setSavedText(text)
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      setNotice(null)
      loadTree()
    } catch {
      setNotice('Save failed.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!current || current.type !== 'file' || !current.writable) return
    if (!confirm(`Delete ${current.path}?`)) return
    setBusy(true)
    try {
      await api.workspaceDelete(cid, current.path)
      setCurrent(null)
      setText('')
      setSavedText('')
      loadTree()
    } catch {
      setNotice('Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  const newFile = async () => {
    const name = prompt(`New file in ${newFileDir}/ (e.g. 2026-08-04-study-notes.md)`)
    if (!name) return
    const path = `${newFileDir}/${name}`
    try {
      await api.workspaceWrite(cid, path, '')
      loadTree()
      const node: WorkspaceNode = { name, path, type: 'file', writable: true, kind: name.split('.').pop() ?? 'md', size: 0 }
      await openNode(node)
    } catch {
      setNotice('Could not create the file.')
    }
  }

  const askAi = () => {
    if (!current) return
    const instruction = prompt('What should the AI do with this file? (it will answer in the chat and can edit the file itself)', 'Give me a brief summary of this file.')
    if (!instruction) return
    const tail = text.slice(-600)
    window.dispatchEvent(new CustomEvent('campus:ask-ai', {
      detail: { text: `[Workspace: ${current.path}]\n${instruction}\n\n--- current file content (tail) ---\n${tail}` },
    }))
  }

  const isText = current?.kind ? TEXT_KINDS.has(current.kind) : false

  return (
    <div className="ws-wrap">
      <div className="card ws-tree">
        <p className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <span><Folder size={13} style={{ verticalAlign: -2 }} /> Workspace</span>
          <button className="icon-btn" onClick={loadTree} title="Refresh"><RefreshCw size={12} /></button>
        </p>
        <div className="ws-tree-scroll">
          {loading && <div className="empty compact">Loading…</div>}
          {!loading && tree && tree.nodes.map((n) => (
            <TreeNode key={n.path} node={n} depth={0} cid={cid} openDirs={openDirs} openPath={openPath} onToggle={(p) => setOpenDirs((prev) => { const next = new Set(prev); if (next.has(p)) next.delete(p); else next.add(p); return next })} onOpen={openNode} />
          ))}
          {!loading && tree && tree.nodes.length === 0 && <div className="empty compact">No files yet.</div>}
        </div>
        <div className="ws-new">
          <select value={newFileDir} onChange={(e) => setNewFileDir(e.target.value)}>
            <option value="notes">notes/</option>
            <option value="work">work/</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={newFile}><Plus size={12} /> New file</button>
        </div>
      </div>

      <div className="card ws-editor">
        {!current && <div className="empty compact" style={{ margin: 'auto' }}>Select a file from the tree — notes/ and work/ are editable.</div>}
        {current && (
          <>
            <div className="ws-editor-head">
              <span className="ws-editor-path" title={current.path}>
                <FolderLock size={12} style={{ verticalAlign: -2 }} /> {current.path}
                {!current.writable && <Lock size={10} className="ws-badge" />}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {current.writable && isText && (
                  <>
                    <button className="btn btn-outline btn-sm" onClick={() => setPreview(!preview)}>
                      {preview ? 'Edit' : 'Preview'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={askAi} title="Ask the AI about this file — it can also edit it">
                      <Bot size={12} /> Ask AI
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>
                      <Save size={12} /> {dirty ? 'Save*' : 'Saved'}
                    </button>
                    <button className="icon-btn" onClick={remove} title="Delete"><Trash2 size={12} /></button>
                  </>
                )}
                {(!current.writable || !isText) && current.kind && (
                  <span className="chip">read-only</span>
                )}
              </div>
            </div>
            {notice && <p className="ws-notice">{notice}</p>}
            {savedAt && <p className="ws-saved">saved {savedAt}</p>}
            {assetUrl ? (
              <a className="empty compact" style={{ margin: 'auto', textDecoration: 'none' }} href={assetUrl} target="_blank" rel="noreferrer noopener">
                Open in viewer (read-only) →
              </a>
            ) : preview ? (
              <div className="ws-preview">
                <ZenMarkdown content={sanitizeHtml(text)} />
              </div>
            ) : (
              <textarea
                className="ws-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                placeholder={isText ? 'Start typing…' : 'This file type is read-only here.'}
                readOnly={!current.writable || !isText}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
