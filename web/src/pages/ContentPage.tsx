import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'
import type { ContentNode, FileRecord } from '../types'

export function ContentPage() {
  const { courseId, nodeId } = useParams()
  const cid = Number(courseId)
  const nid = nodeId ? Number(nodeId) : null
  const [nodes, setNodes] = useState<ContentNode[]>([])
  const [files, setFiles] = useState<FileRecord[]>([])
  const [content, setContent] = useState('')
  const [tab, setTab] = useState<'markdown' | 'pdf'>('markdown')
  const [selectedNode, setSelectedNode] = useState<ContentNode | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null)

  useEffect(() => {
    api.contentTree(cid).then(({ nodes: n, files: f }) => {
      setNodes(n)
      setFiles(f)
    }).catch(console.error)
  }, [cid])

  useEffect(() => {
    if (!nid) {
      setSelectedNode(null)
      setSelectedFile(null)
      setContent('')
      return
    }
    const node = nodes.find((n) => n.id === nid) ?? null
    setSelectedNode(node)
    const file = files.find((f) => f.content_node_id === nid) ?? null
    setSelectedFile(file)
    if (file?.processed) {
      api.fileContent(file.id).then((c) => setContent(c.content)).catch(console.error)
    } else {
      setContent('')
    }
  }, [nid, nodes, files])

  const modules = nodes.filter((n) => n.parent_id === null)
  const children = (parentId: number) => nodes.filter((n) => n.parent_id === parentId)

  const fileForNode = (nodeId: number) => files.find((f) => f.content_node_id === nodeId)

  return (
    <div>
      <h1 className="page-title">Content</h1>
      <div className="content-split">
        <div className="card" style={{ overflowY: 'auto' }}>
          {modules.map((mod) => (
            <div key={mod.id}>
              <div className="tree-node module">{mod.title}</div>
              {children(mod.id).map((topic) => {
                const f = fileForNode(topic.id)
                return (
                  <Link
                    key={topic.id}
                    to={`/courses/${cid}/content/${topic.id}`}
                    className={`tree-node topic${nid === topic.id ? ' selected' : ''}`}
                    style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                  >
                    {topic.title}
                    {f && <span className="badge" style={{ marginLeft: '0.35rem' }}>📄</span>}
                    {f?.processed ? <span className="badge processed" style={{ marginLeft: '0.25rem' }}>✓</span> : null}
                  </Link>
                )
              })}
            </div>
          ))}
          {modules.length === 0 && <p className="empty-state">No content synced</p>}
        </div>

        <div className="card">
          {!selectedNode ? (
            <p className="empty-state">Select a topic from the tree</p>
          ) : (
            <>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: 600 }}>{selectedNode.title}</div>
                {selectedFile && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedFile.path}</div>
                )}
              </div>
              {selectedFile ? (
                <>
                  <div className="viewer-tabs">
                    <button className={tab === 'markdown' ? 'active' : 'secondary'} onClick={() => setTab('markdown')}>
                      Markdown
                    </button>
                    <button className={tab === 'pdf' ? 'active' : 'secondary'} onClick={() => setTab('pdf')}>
                      PDF
                    </button>
                  </div>
                  {tab === 'markdown' ? (
                    content ? (
                      <div className="markdown-body"><ReactMarkdown>{content}</ReactMarkdown></div>
                    ) : (
                      <p className="empty-state">Processing… PDF tab may still be available.</p>
                    )
                  ) : (
                    <p className="empty-state">
                      PDF viewer (pdf.js) — stub for {selectedFile.path}
                    </p>
                  )}
                </>
              ) : (
                <p className="empty-state">No file attached to this topic</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
