import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

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

  const subtitle = [
    'Generated from harness DB',
    generatedAt && new Date(generatedAt).toLocaleString('en-CA'),
    source && `source: ${source}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="page">
      <PageHeader title="Morning digest" subtitle={subtitle} />
      <Card>
        <div className="markdown-body">
          <ReactMarkdown>{markdown || 'Loading…'}</ReactMarkdown>
        </div>
      </Card>
    </div>
  )
}
