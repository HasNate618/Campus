import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, FileText } from 'lucide-react'
import { api } from '@/api/client'
import type { ContentNode, FileRecord } from '@/types'

export function ContentPage() {
  const { courseId, nodeId } = useParams()
  const cid = Number(courseId)
  const nid = nodeId ? Number(nodeId) : null
  const [nodes, setNodes] = useState<ContentNode[]>([])
  const [files, setFiles] = useState<FileRecord[]>([])
  const [content, setContent] = useState('')
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
    if (!selectedFile?.processed) {
      setContent('')
      return
    }
    setLoadingContent(true)
    api
      .fileContent(selectedFile.id)
      .then((c) => setContent(c.content))
      .catch(console.error)
      .finally(() => setLoadingContent(false))
  }, [selectedFile?.id, selectedFile?.processed])

  const modules = nodes.filter((n) => n.parent_id === null)
  const children = (parentId: number) => nodes.filter((n) => n.parent_id === parentId)
  const fileForNode = (id: number) => files.find((f) => f.content_node_id === id)

  return (
    <div className="split">
      <div className="card" style={{ padding: '10px 8px', maxHeight: '70vh', overflowY: 'auto' }}>
        {modules.length === 0 && <div className="empty compact">No content synced.</div>}
        {modules.map((mod) => (
          <div key={mod.id}>
            <div className="tree-module">{mod.title}</div>
            {children(mod.id).map((topic) => {
              const f = fileForNode(topic.id)
              return (
                <Link
                  key={topic.id}
                  to={`/courses/${cid}/content/${topic.id}`}
                  className={`tree-topic${nid === topic.id ? ' selected' : ''}`}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {topic.title}
                  </span>
                  {f?.processed ? <span className="chip" style={{ padding: '1px 6px' }}>md</span> : null}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      <div className="card" style={{ minHeight: 300 }}>
        {!selectedNode ? (
          <div className="empty">Select a topic from the tree.</div>
        ) : (
          <>
            <div className="viewer-head">
              <Link to={`/courses/${cid}/content`} className="mobile-only" style={{ color: 'var(--violet)', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                <ArrowLeft size={13} /> All topics
              </Link>
              <div className="viewer-title">{selectedNode.title}</div>
              {selectedFile && <div className="viewer-path">{selectedFile.path}</div>}
            </div>
            {!selectedFile ? (
              <div className="empty compact">No file attached to this topic.</div>
            ) : loadingContent ? (
              <div className="empty compact">Loading…</div>
            ) : content ? (
              <div className="md">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            ) : (
              <div className="empty compact">
                <FileText size={16} style={{ display: 'block', margin: '0 auto 6px' }} />
                This file hasn&apos;t been processed yet — markdown extraction pending.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
