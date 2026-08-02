import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'

export function DigestPage() {
  const [markdown, setMarkdown] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')
  const [source, setSource] = useState('')

  useEffect(() => {
    api.digest().then((d) => {
      setMarkdown(d.markdown)
      setGeneratedAt(d.generated_at)
      setSource(d.source)
    }).catch(console.error)
  }, [])

  return (
    <div>
      <h1 className="page-title">Morning digest</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Generated from harness DB · no live Brightspace
        {generatedAt && ` · ${new Date(generatedAt).toLocaleString('en-CA')}`}
        {source && ` · source: ${source}`}
      </p>
      <div className="card markdown-body">
        <ReactMarkdown>{markdown || 'Loading…'}</ReactMarkdown>
      </div>
    </div>
  )
}
