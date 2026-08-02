import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
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
      <PageHeader title="Content" />
      <div className="content-split">
        <Card padding="sm">
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
                    {f?.processed && <span className="badge badge--accent" style={{ marginLeft: '0.375rem' }}>md</span>}
                  </Link>
                )
              })}
            </div>
          ))}
          {modules.length === 0 && <EmptyState compact>No content synced</EmptyState>}
        </Card>

        <Card>
          {!selectedNode ? (
            <EmptyState>Select a topic from the tree</EmptyState>
          ) : (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{selectedNode.title}</div>
                {selectedFile && (
                  <div className="list-item__meta" style={{ marginTop: '0.25rem' }}>{selectedFile.path}</div>
                )}
              </div>
              {selectedFile ? (
                <>
                  <div className="viewer-tabs">
                    <Button variant={tab === 'markdown' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('markdown')}>Markdown</Button>
                    <Button variant={tab === 'pdf' ? 'primary' : 'ghost'} size="sm" onClick={() => setTab('pdf')}>PDF</Button>
                  </div>
                  {tab === 'markdown' ? (
                    content ? (
                      <div className="markdown-body"><ReactMarkdown>{content}</ReactMarkdown></div>
                    ) : (
                      <EmptyState compact>Processing… try the PDF tab.</EmptyState>
                    )
                  ) : (
                    <EmptyState compact>PDF viewer (pdf.js) — stub for {selectedFile.path}</EmptyState>
                  )}
                </>
              ) : (
                <EmptyState compact>No file attached to this topic</EmptyState>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
