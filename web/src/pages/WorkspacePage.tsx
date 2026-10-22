import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Bot, ChevronRight, Download, Eye, FileAudio, FileCode2, FileImage,
  FileText, FileType, FileVideo, Folder, FolderLock, FolderPlus, Lock,
  Pencil, Plus, RefreshCw, Trash2, Upload,
} from 'lucide-react'
import { api } from '@/api/client'
import { ZenPdfFrame } from '@/components/ZenPdfFrame'
import { listKeys, useListCursor, useZoneKeys } from '@/lib/keynav'
import { WORKSPACE_OPEN_EVENT, ancestorDirs } from '@/lib/refs'
import { ZenMarkdown } from '@/lib/ZenMarkdown'
import { sanitizeHtml } from '@/lib/sanitize'
import type { WorkspaceNode, WorkspaceTree } from '@/types'

const TEXT_KINDS = new Set(['md', 'txt', 'html', 'htm', 'json', 'yaml', 'yml', 'csv', 'py', 'ts', 'tsx', 'js', 'css', 'nix', 'sh'])
// Kinds where the rendered view is markdown; the rest get a plain read-only
// view (running a .py file through a markdown renderer mangles it).
const PROSE_KINDS = new Set(['md', 'txt', 'html', 'htm'])
// Formats the browser can display directly from the asset URL.
const IMAGE_KINDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])
const AUDIO_KINDS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'])
const VIDEO_KINDS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v'])

function kindIcon(kind?: string) {
  if (!kind) return <FileCode2 size={13} />
  if (IMAGE_KINDS.has(kind)) return <FileImage size={13} />
  if (AUDIO_KINDS.has(kind)) return <FileAudio size={13} />
  if (VIDEO_KINDS.has(kind)) return <FileVideo size={13} />
  if (kind === 'md' || kind === 'txt') return <FileText size={13} />
  if (kind === 'pdf' || kind === 'doc' || kind === 'docx') return <FileType size={13} />
  return <FileCode2 size={13} />
}

/** Depth-first search of the workspace tree. Pure, so it lives at module scope:
 *  a component-scoped copy is redefined every render, which makes it unusable
 *  as an effect dependency. */
function findNode(nodes: WorkspaceNode[], path: string): WorkspaceNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const f = findNode(n.children, path)
      if (f) return f
    }
  }
  return null
}

export function WorkspacePage() {
  const { courseId } = useParams()
  const cid = Number(courseId)
  const [searchParams, setSearchParams] = useSearchParams()
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
  // Editable text files open in the RENDERED view. The header's View/Edit
  // control switches modes; Escape goes back to View.
  const [preview, setPreview] = useState(true)
  const [assetUrl, setAssetUrl] = useState<string | null>(null)
  // The server now returns `asset` for EVERY file (the Download control needs it
  // for text files too), so `viewable` — not assetUrl — decides which pane shows.
  const [viewable, setViewable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [newFileDir, setNewFileDir] = useState<string>('notes')
  const [externalChange, setExternalChange] = useState(false)
  const [uploading, setUploading] = useState(false)
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
  const previewRef = useRef<HTMLDivElement | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const openPathRef = useRef<string | null>(null)
  openPathRef.current = openPath
  // set when the Edit control is pressed; the focus effect below consumes it
  const focusOnEdit = useRef(false)
  // Serialized last tree. The poll runs every 8s even when nothing changed;
  // adopting an identical tree used to re-render the whole page and (via the
  // old innerHTML prop) reset the preview. Skip the state write instead.
  const treeKeyRef = useRef('')

  const applyTree = useCallback((next: WorkspaceTree | null) => {
    if (!next) {
      treeKeyRef.current = ''
      setTree(null)
      return
    }
    const key = JSON.stringify(next)
    if (key === treeKeyRef.current) return
    treeKeyRef.current = key
    setTree(next)
  }, [])

  const loadTree = useCallback(() => {
    api.workspaceTree(cid).then(applyTree).catch(() => applyTree(null)).finally(() => setLoading(false))
  }, [cid, applyTree])

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
      applyTree(t)
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

  // entering edit mode focuses the box, caret at the end
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
    // Keep the URL in step with the open file. This is what makes the ?path=
    // landing below idempotent: the tree poll replaces `tree` every few
    // seconds, so an effect guarded on "is the open file the param" only stays
    // quiet if a manual open also updates the param. `replace` keeps the back
    // button clean, and it makes a workspace view linkable.
    setSearchParams({ path: n.path }, { replace: true })
    setPreview(true)
    setViewable(false)
    setAssetUrl(null)
    setNotice(null)
    setExternalChange(false)
    mtimeRef.current = n.mtime ?? null
    if (n.type === 'file') {
      try {
        const r = await api.workspaceRead(cid, n.path)
        setViewable(r.viewable)
        // The server builds this: term/code prefix plus per-segment encoding for
        // anything with `#`, `?` or a space. The client cannot — tree paths are
        // course-relative while this URL is data-root-relative.
        setAssetUrl(r.asset)
        if (r.viewable) {
          setText(r.text ?? '')
          setSavedText(r.text ?? '')
        } else {
          setText('')
          setSavedText('')
        }
      } catch {
        setNotice('Could not read the file.')
      }
    }
  }

  // The ?path= effect below wants "the latest openNode", not "re-run whenever
  // openNode changes" — it is redefined every render, and depending on it would
  // repeat the tree walk on every render for no reason.
  const openNodeRef = useRef(openNode)
  openNodeRef.current = openNode

  // Two ways in, one selection path. A deep link or refresh arrives as
  // ?path=; a chat chip click arrives as an event. The event is necessary
  // because react-router does not re-render on a redundant navigation — without
  // it, clicking the same chip twice while that file's URL is already open
  // reached no effect at all and the chip did nothing.
  const [selectReq, setSelectReq] = useState<{ path: string; n: number } | null>(null)
  useEffect(() => {
    const onOpen = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) setSelectReq({ path, n: Date.now() })
    }
    window.addEventListener(WORKSPACE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(WORKSPACE_OPEN_EVENT, onOpen)
  }, [])

  const pathParam = searchParams.get('path')
  useEffect(() => {
    if (!pathParam) return
    // Skip when this is just openNode() echoing back a file we already
    // selected, or the two effects ping-pong.
    setSelectReq((prev) => (prev?.path === pathParam ? prev : { path: pathParam, n: Date.now() }))
  }, [pathParam])

  const pathMissRef = useRef<string | null>(null)
  useEffect(() => {
    const req = selectReq
    if (!req || !tree) return
    // Not "have I seen this param": once the URL and the open file agree this
    // returns, so the tree poll cannot yank the user back to a file they
    // browsed away from.
    if (openPathRef.current === req.path) return
    const node = findNode(tree.nodes, req.path)
    if (!node || node.type !== 'file') {
      // Once per path: setNotice with an identical string is a no-op anyway,
      // but this stops the effect re-walking the tree on every render.
      if (pathMissRef.current !== req.path) {
        pathMissRef.current = req.path
        setNotice("That file isn't in this workspace.")
      }
      return
    }
    setOpenDirs((prev) => {
      const next = new Set(prev)
      for (const d of ancestorDirs(req.path)) next.add(d)
      return next
    })
    void openNodeRef.current(node)
  }, [selectReq, tree])

  // auto-refresh: poll the tree; if the open file changed on disk (e.g. the
  // AI edited it via file_edit), reload when clean, flag it when dirty
  useEffect(() => {
    const iv = setInterval(async () => {
      const cur = current
      if (!cur || cur.type !== 'file' || document.hidden) return
      try {
        const t = await api.workspaceTree(cid)
        applyTree(t)
        const node = findNode(t.nodes, cur.path)
        if (!node || node.type !== 'file' || !node.mtime) return
        if (node.mtime === mtimeRef.current) return
        mtimeRef.current = node.mtime
        if (textRef.current === savedRef.current) {
          const r = await api.workspaceRead(cid, cur.path)
          // Only reload when the TEXT actually changed. The AI rewrites a file
          // in place (same bytes, new mtime) often enough that mtime alone is
          // not a real change — and every needless setText re-renders the
          // preview, which wipes the injected diagram/code decorations and
          // re-adds them, i.e. a visible flash for no reason.
          if (r.viewable && r.text !== null && r.text !== textRef.current) {
            // Keep the reader where they were when the file changes under
            // them; replacing the preview DOM otherwise jumps to the top.
            const top = previewRef.current?.scrollTop ?? 0
            setText(r.text)
            setSavedText(r.text)
            setSavedAt('updated')
            setExternalChange(false)
            requestAnimationFrame(() => {
              if (previewRef.current) previewRef.current.scrollTop = top
            })
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

  // Raw bytes into uploads/ — nothing is extracted here, so any format is
  // fine. The agent reads a file on demand (extract_file) when a chat turn
  // needs it; the workspace just stores it.
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.isArray(files) ? files : Array.from(files)
    if (!list.length) return
    setUploading(true)
    setNotice(null)
    let done = 0
    try {
      for (const file of list) {
        const path = `uploads/${file.name}`
        if (findNode(tree?.nodes ?? [], path) && !confirm(`${path} already exists — overwrite it?`)) continue
        await api.workspaceUpload(cid, path, file)
        done += 1
      }
      loadTree()
      if (done) setNotice(`Uploaded ${done} file${done === 1 ? '' : 's'} to uploads/.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const reloadExternal = async () => {
    if (!current) return
    try {
      const r = await api.workspaceRead(cid, current.path)
      if (r.viewable && r.text !== null) {
        const top = previewRef.current?.scrollTop ?? 0
        setText(r.text)
        setSavedText(r.text)
        setSavedAt('updated')
        requestAnimationFrame(() => {
          if (previewRef.current) previewRef.current.scrollTop = top
        })
      }
      const t = await api.workspaceTree(cid)
      applyTree(t)
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
  const kind = current?.kind ?? ''
  const isImage = IMAGE_KINDS.has(kind)
  const isPdf = kind === 'pdf'
  const isAudio = AUDIO_KINDS.has(kind)
  const isVideo = VIDEO_KINDS.has(kind)
  const hasInlineViewer = isImage || isPdf || isAudio || isVideo

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
      <div
        className="ws-tree"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault()
            void uploadFiles(e.dataTransfer.files)
          }
        }}
      >
        <div className="ws-tree-head">
          <span className="ws-tree-title"><Folder size={13} /> Workspace</span>
          <button className="icon-btn" onClick={loadTree} title="Refresh"><RefreshCw size={12} /></button>
        </div>
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
                className={`ws-node${isDir ? ' dir' : ''}${active ? ' active' : ''}${node.writable && !isDir ? '' : ' ro'}${wsCursor.cursor === i ? ' kbd-cursor' : ''}`}
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
          {/* Picks which WRITABLE root a new file/folder lands in: notes/,
              work/ and uploads/ are editable, everything else in the tree
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
            <option value="uploads">uploads/ — uploaded files</option>
          </select>
          <input
            ref={uploadInputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files)
              e.currentTarget.value = ''
            }}
          />
          <button className="btn btn-outline btn-sm" onClick={() => uploadInputRef.current?.click()} disabled={uploading} title="Upload files to uploads/ — any format">
            <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={newDir} title="New folder"><FolderPlus size={12} /> Folder</button>
          <button className="btn btn-outline btn-sm" onClick={newFile}><Plus size={12} /> New file</button>
        </div>
      </div>

      {/* Escape anywhere in the editor returns to the rendered view — the
          handler sits on the pane so it still works once focus has left the box */}
      <div className="ws-editor" onKeyDown={onEditorKeyDown}>
        {!current && <div className="empty compact" style={{ margin: 'auto' }}>Select a file from the tree — notes/, work/ and uploads/ are editable.</div>}
        {current && (
          <>
            <div className="ws-editor-head">
              <span className="ws-editor-path" title={current.path}>
                <FolderLock size={12} />
                <span className="ws-editor-path-text">{current.path}</span>
                {!current.writable && <Lock size={10} className="ws-badge" />}
              </span>
              <div className="ws-editor-actions">
                {canEdit && (
                  <div className="ws-mode" role="group" aria-label="File mode">
                    <button
                      type="button"
                      className={`ws-mode-btn${preview ? ' active' : ''}`}
                      onClick={() => setPreview(true)}
                      aria-pressed={preview}
                      title="View rendered file"
                    >
                      <Eye size={12} /> View
                    </button>
                    <button
                      type="button"
                      className={`ws-mode-btn${!preview ? ' active' : ''}`}
                      onClick={startEdit}
                      aria-pressed={!preview}
                      title="Edit file"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                  </div>
                )}
                {assetUrl && (
                  <a
                    className="icon-btn"
                    href={assetUrl}
                    download={current.name}
                    title="Download this file"
                    aria-label="Download this file"
                  >
                    <Download size={12} />
                  </a>
                )}
                {current.writable && (
                  <>
                    {isText && (
                      <button className="btn btn-outline btn-sm" onClick={askAi} title="Ask the AI about this file — it can also edit it">
                        <Bot size={12} /> Ask AI
                      </button>
                    )}
                    <button className="icon-btn" onClick={remove} disabled={busy} title="Delete"><Trash2 size={12} /></button>
                  </>
                )}
                {!current.writable && current.kind && (
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
            {hasInlineViewer && assetUrl ? (
              isImage ? (
                <div className="ws-media">
                  <img src={assetUrl} alt={current.name} />
                </div>
              ) : isPdf ? (
                <ZenPdfFrame rawUrl={assetUrl} fileId={current.path} filename={current.name} />
              ) : isVideo ? (
                <div className="ws-media">
                  <video src={assetUrl} controls />
                </div>
              ) : (
                <div className="ws-media">
                  <audio src={assetUrl} controls />
                </div>
              )
            ) : !viewable ? (
              <div className="ws-file-fallback">
                <FileType size={30} />
                <p className="ws-file-fallback-name">{current.name}</p>
                <p className="ws-file-fallback-note">This file type can't be previewed here.</p>
                <div className="ws-file-fallback-actions">
                  {assetUrl && (
                    <a className="btn btn-outline btn-sm" href={assetUrl} target="_blank" rel="noreferrer noopener">
                      <Eye size={12} /> Open in new tab
                    </a>
                  )}
                  {assetUrl && (
                    <a className="btn btn-outline btn-sm" href={assetUrl} download={current.name}>
                      <Download size={12} /> Download
                    </a>
                  )}
                </div>
              </div>
            ) : preview ? (
              <div className="ws-preview" ref={previewRef}>
                {prosePreview ? (
                  // HTML (semi-trusted Brightspace output) goes through the
                  // sanitizer. Markdown/text must NOT: sanitizeHtml rebuilds the
                  // document and returns innerHTML, and re-serializing escapes
                  // TEXT nodes — so every `-->`, `<`, `>` and `&` in a diagram or
                  // code block came back as `--&gt;` / `&lt;` / `&amp;`. Mermaid
                  // then failed to parse a diagram that is perfectly valid on
                  // disk ("this diagram could not be parsed"), and code blocks
                  // displayed entities. The chat renderer already passes markdown
                  // unsanitized, so this is consistent rather than a new risk.
                  <ZenMarkdown
                    content={
                      current?.kind === 'html' || current?.kind === 'htm'
                        ? sanitizeHtml(text)
                        : text
                    }
                  />
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
