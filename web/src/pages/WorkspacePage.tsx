import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bot, ChevronRight, FileText, FileCode2, FileType,
  Folder, FolderLock, FolderPlus, Lock, Pencil, Plus, RefreshCw, Save, Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { listKeys, useListCursor, useZoneKeys } from '@/lib/keynav'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import type { WorkspaceNode, WorkspaceTree } from '@/types'

const TEXT_KINDS = new Set(['md', 'txt', 'html', 'htm', 'json', 'yaml', 'yml', 'csv', 'py', 'ts', 'tsx', 'js', 'css', 'nix', 'sh'])

function kindIcon(kind?: string) {
  if (kind === 'md' || kind === 'txt') return <FileText size={13} />
  if (kind === 'pdf' || kind === 'doc' || kind === 'docx') return <FileType size={13} />
  return <FileCode2 size={13} />
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
  const [externalChange, setExternalChange] = useState(false)
  const mtimeRef = useRef<string | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const savedRef = useRef(savedText)
  savedRef.current = savedText

  const findNode = (nodes: WorkspaceNode[], path: string): WorkspaceNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n
      if (n.children) {
        const f = findNode(n.children, path)
        if (f) return f
      }
    }
    return null
  }

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
    setExternalChange(false)
    mtimeRef.current = n.mtime ?? null
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

  // auto-refresh: poll the tree; if the open file changed on disk (e.g. the
  // AI edited it via file_edit), reload when clean, flag it when dirty
  useEffect(() => {
    const iv = setInterval(async () => {
      const cur = current
      if (!cur || cur.type !== 'file') return
      try {
        const t = await api.workspaceTree(cid)
        setTree(t)
        const node = findNode(t.nodes, cur.path)
        if (!node || node.type !== 'file' || !node.mtime) return
        if (node.mtime === mtimeRef.current) return
        mtimeRef.current = node.mtime
        if (textRef.current === savedRef.current) {
          const r = await api.workspaceRead(cid, cur.path)
          if (r.viewable && r.text !== null) {
            setText(r.text)
            setSavedText(r.text)
            setSavedAt('updated')
            setExternalChange(false)
          }
        } else {
          setExternalChange(true)
        }
      } catch {
        /* transient — retry next tick */
      }
    }, 8000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, current])

  const save = async () => {
    if (!current || current.type !== 'file' || !current.writable) return
    setBusy(true)
    try {
      await api.workspaceWrite(cid, current.path, text)
      setSavedText(text)
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      setNotice(null)
      setExternalChange(false)
      const t = await api.workspaceTree(cid)
      setTree(t)
      const node = findNode(t.nodes, current.path)
      mtimeRef.current = node?.mtime ?? null
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
    const instruction = prompt('What should the AI do with this file? (it answers in the chat and can edit the file itself)')
    if (!instruction) return
    const kb = (text.length / 1024).toFixed(1)
    const cap = 8000
    const content = text.length > cap
      ? text.slice(0, cap) + `\n… [truncated — ${text.length} chars total; read more with content_read_file if needed]`
      : text
    window.dispatchEvent(new CustomEvent('campus:ask-ai', {
      detail: {
        text: `[File: ${current.path} — ${current.kind ?? 'text'}, ${kb} KB]\n` +
          `The user is working on this file and asked: "${instruction}"\n\n` +
          `Current content:\n--- BEGIN FILE ---\n${content}\n--- END FILE ---\n\n` +
          `If the request involves changing the file, apply the edits yourself with ` +
          `file_edit (scoped snippet edits) — don't just describe them. ` +
          `If it's a question about the file, answer it in the chat.`,
      },
    }))
  }

  const newDir = async () => {
    const name = prompt(`New folder in ${newFileDir}/ (e.g. 'projects' or 'projects/phase-1')`)
    if (!name) return
    try {
      await api.workspaceMkdir(cid, `${newFileDir}/${name}`)
      setNotice(null)
      loadTree()
    } catch {
      setNotice('Could not create the folder.')
    }
  }

  const reloadExternal = async () => {
    if (!current) return
    try {
      const r = await api.workspaceRead(cid, current.path)
      if (r.viewable && r.text !== null) {
        setText(r.text)
        setSavedText(r.text)
        setSavedAt('updated')
      }
      const t = await api.workspaceTree(cid)
      setTree(t)
      const node = findNode(t.nodes, current.path)
      mtimeRef.current = node?.mtime ?? null
      setExternalChange(false)
    } catch {
      setNotice('Could not reload the file.')
    }
  }

  const isText = current?.kind ? TEXT_KINDS.has(current.kind) : false

  // Flat visible rows for j/k navigation (children of collapsed dirs are
  // hidden, matching the recursive render).
  const flatNodes = useMemo(() => {
    const out: { node: WorkspaceNode; depth: number }[] = []
    const walk = (n: WorkspaceNode, depth: number) => {
      out.push({ node: n, depth })
      if (n.type === 'dir' && openDirs.has(n.path)) {
        for (const c of n.children ?? []) walk(c, depth + 1)
      }
    }
    for (const n of tree?.nodes ?? []) walk(n, 0)
    return out
  }, [tree, openDirs])

  const wsCursor = useListCursor(flatNodes.length)

  useZoneKeys('course', (key) => {
    const row = flatNodes[wsCursor.cursor]
    const activate = (r: { node: WorkspaceNode; depth: number }) => {
      if (!r) return
      if (r.node.type === 'dir') {
        setOpenDirs((prev) => {
          const next = new Set(prev)
          if (next.has(r.node.path)) next.delete(r.node.path)
          else next.add(r.node.path)
          return next
        })
      } else {
        void openNode(r.node)
      }
    }
    if (listKeys(key, wsCursor, () => activate(row))) return true
    if (key === 'h' && row?.node.type === 'dir' && openDirs.has(row.node.path)) {
      setOpenDirs((prev) => {
        const next = new Set(prev)
        next.delete(row.node.path)
        return next
      })
      return true
    }
    return false
  })

  return (
    <div className="ws-wrap">
      <div className="card ws-tree">
        <p className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
          <span><Folder size={13} style={{ verticalAlign: -2 }} /> Workspace</span>
          <button className="icon-btn" onClick={loadTree} title="Refresh"><RefreshCw size={12} /></button>
        </p>
        <div className="ws-tree-scroll">
          {loading && <div className="empty compact">Loading…</div>}
          {!loading && tree && flatNodes.map(({ node, depth }, i) => {
            const isDir = node.type === 'dir'
            const open = openDirs.has(node.path)
            const active = openPath === node.path && !isDir
            return (
              <button
                key={node.path}
                ref={wsCursor.setRef(i)}
                className={`ws-node${active ? ' active' : ''}${node.writable && !isDir ? '' : ' ro'}${wsCursor.cursor === i ? ' kbd-cursor' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
                onClick={() => (isDir
                  ? setOpenDirs((prev) => { const next = new Set(prev); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next })
                  : void openNode(node))}
                title={isDir ? (node.writable ? 'editable' : 'read-only') : `${node.path}${node.writable ? '' : ' · read-only'}`}
              >
                {isDir ? (
                  <ChevronRight size={12} className={`ws-chevron${open ? ' open' : ''}`} />
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
            )
          })}
          {!loading && tree && tree.nodes.length === 0 && <div className="empty compact">No files yet.</div>}
        </div>
        <div className="ws-new">
          <select value={newFileDir} onChange={(e) => setNewFileDir(e.target.value)}>
            <option value="notes">notes/</option>
            <option value="work">work/</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={newDir} title="New folder"><FolderPlus size={12} /> Folder</button>
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
            {externalChange && (
              <p className="ws-notice" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>File changed on disk (e.g. the AI edited it).</span>
                <button className="btn btn-outline btn-sm" onClick={reloadExternal}>Reload</button>
              </p>
            )}
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
