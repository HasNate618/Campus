import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bot, ChevronRight, FileText, FileCode2, FileType,
  Folder, FolderLock, FolderPlus, Lock, Pencil, Plus, RefreshCw, Trash2,
} from 'lucide-react'
import { api } from '@/api/client'
import { listKeys, useListCursor, useZoneKeys } from '@/lib/keynav'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import type { WorkspaceNode, WorkspaceTree } from '@/types'

const TEXT_KINDS = new Set(['md', 'txt', 'html', 'htm', 'json', 'yaml', 'yml', 'csv', 'py', 'ts', 'tsx', 'js', 'css', 'nix', 'sh'])
// Kinds where the rendered view is markdown; the rest get a plain read-only
// view (running a .py file through a markdown renderer mangles it).
const PROSE_KINDS = new Set(['md', 'txt', 'html', 'htm'])

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
  // Editable text files open in the RENDERED view; clicking the body switches
  // to the editor and Escape goes back — there is no Edit/Preview toggle.
  const [preview, setPreview] = useState(true)
  const [assetUrl, setAssetUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [newFileDir, setNewFileDir] = useState<string>('notes')
  const [externalChange, setExternalChange] = useState(false)
  const mtimeRef = useRef<string | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const savedRef = useRef(savedText)
  savedRef.current = savedText
  // Autosave plumbing. The pending write lives in a REF paired with the path it
  // was queued for, so a debounced save can never fire against whatever file
  // the user has since switched to.
  const pendingRef = useRef<{ path: string; text: string } | null>(null)
  const saveTimer = useRef<number | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const openPathRef = useRef<string | null>(null)
  openPathRef.current = openPath
  // set on a click-to-edit; the focus effect below consumes it
  const focusOnEdit = useRef(false)

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

  /**
   * Autosave. Writes whatever is pending FOR THE FILE IT WAS QUEUED FOR, so a
   * debounce landing after a file switch can never cross the streams. Called by
   * the typing debounce, by Escape, before a file switch, and on unmount —
   * this is what replaces the old Save button.
   */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    setSaving(true)
    try {
      await api.workspaceWrite(cid, p.path, p.text)
      // a flush can outlive a file switch: only adopt the text while that file
      // is still the open one
      if (p.path === openPathRef.current) {
        setSavedText(p.text)
        setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        setNotice(null)
        setExternalChange(false)
      }
      const t = await api.workspaceTree(cid)
      setTree(t)
      const node = findNode(t.nodes, p.path)
      if (p.path === openPathRef.current) mtimeRef.current = node?.mtime ?? null
    } catch {
      // keep the write queued: the next keystroke (or the switch/unmount flush)
      // retries it instead of silently dropping the edit
      pendingRef.current = p
      setNotice('Save failed.')
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid])

  const onEdit = (v: string) => {
    setText(v)
    const cur = current
    if (!cur || cur.type !== 'file' || !cur.writable) return
    pendingRef.current = { path: cur.path, text: v }
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => { void flushSave() }, 800)
  }

  const startEdit = () => {
    if (!current || current.type !== 'file' || !current.writable || !isText) return
    focusOnEdit.current = true
    setPreview(false)
  }

  const exitEdit = () => {
    void flushSave() // leaving edit mode persists immediately
    setPreview(true)
  }

  const onEditorKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || preview) return
    // Claim the key: keynav would otherwise blur the field first, making the
    // user press Escape twice to get back to the rendered view.
    e.preventDefault()
    e.stopPropagation()
    exitEdit()
  }

  // click-to-edit focuses the box, caret at the end
  useEffect(() => {
    if (preview || !focusOnEdit.current) return
    focusOnEdit.current = false
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    const end = ta.value.length
    ta.setSelectionRange(end, end)
  }, [preview])

  // unmount / course switch must not drop the last edit
  useEffect(() => () => { void flushSave() }, [flushSave])

  const openNode = async (n: WorkspaceNode) => {
    // persist anything still pending for the file we're leaving BEFORE `current`
    // is swapped out from under the debounce
    await flushSave()
    setCurrent(n)
    setOpenPath(n.path)
    setPreview(true)
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
  const canEdit = !!current && current.type === 'file' && !!current.writable && isText
  // prose renders as markdown; other text kinds get a plain read-only view
  const prosePreview = !!current?.kind && PROSE_KINDS.has(current.kind)

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
  // switching courses reuses the component — don't point at the old tree's row
  useEffect(() => {
    wsCursor.setCursor(-1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid])

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
          {/* Picks which of the two WRITABLE roots a new file/folder lands in:
              notes/ and work/ are editable, everything else in the tree
              (content/, Assignments/, memory-card.md) is read-only. */}
          <label className="ws-new-label" htmlFor="ws-new-dir">New in</label>
          <select
            id="ws-new-dir"
            value={newFileDir}
            onChange={(e) => setNewFileDir(e.target.value)}
            title="Where the New file / Folder buttons create things"
          >
            <option value="notes">notes/ — editable notes</option>
            <option value="work">work/ — scratch files</option>
          </select>
          <button className="btn btn-outline btn-sm" onClick={newDir} title="New folder"><FolderPlus size={12} /> Folder</button>
          <button className="btn btn-outline btn-sm" onClick={newFile}><Plus size={12} /> New file</button>
        </div>
      </div>

      {/* Escape anywhere in the editor returns to the rendered view — the
          handler sits on the card so it still works once focus has left the box */}
      <div className="card ws-editor" onKeyDown={onEditorKeyDown}>
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
                    <button className="btn btn-outline btn-sm" onClick={askAi} title="Ask the AI about this file — it can also edit it">
                      <Bot size={12} /> Ask AI
                    </button>
                    <button className="icon-btn" onClick={remove} disabled={busy} title="Delete"><Trash2 size={12} /></button>
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
            {(saving || savedAt) && (
              <p className="ws-saved">{saving ? 'saving…' : `saved ${savedAt}`}</p>
            )}
            {assetUrl ? (
              <a className="empty compact" style={{ margin: 'auto', textDecoration: 'none' }} href={assetUrl} target="_blank" rel="noreferrer noopener">
                Open in viewer (read-only) →
              </a>
            ) : preview ? (
              <div
                className={`ws-preview${canEdit ? ' editable' : ''}`}
                onClick={canEdit ? startEdit : undefined}
                title={canEdit ? 'Click to edit' : undefined}
              >
                {prosePreview ? (
                  <ZenMarkdown content={sanitizeHtml(text)} />
                ) : (
                  <pre className="ws-plain">{text}</pre>
                )}
              </div>
            ) : (
              <textarea
                ref={taRef}
                className="ws-textarea"
                value={text}
                onChange={(e) => onEdit(e.target.value)}
                spellCheck={false}
                placeholder="Start typing…"
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
