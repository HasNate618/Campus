import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Trash2, Wrench } from 'lucide-react'
import { streamChat } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/types'

interface Props {
  courseId: number | null
  fullScreen?: boolean
}

export function ChatPanel({ courseId, fullScreen }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const userMsg = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: userMsg }])
    setStreaming(true)

    let assistantText = ''
    setMessages((m) => [...m, { role: 'assistant', content: '' }])

    try {
      await streamChat(userMsg, courseId, (event, data) => {
        const d = data as Record<string, string>
        if (event === 'tool_start') {
          setMessages((m) => [...m, { role: 'tool', content: d.tool, tool: d.tool }])
        } else if (event === 'tool_end') {
          setMessages((m) => [...m, { role: 'tool', content: `${d.tool} → ${d.result}`, toolResult: d.result }])
        } else if (event === 'token') {
          assistantText += d.text ?? ''
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = assistantText
            return [...copy]
          })
        }
      })
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e}` }])
    } finally {
      setStreaming(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={cn('chat-panel flex h-full flex-col', fullScreen && 'chat-panel--fullscreen')}>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">Chat</p>
          <p className="text-xs text-muted-foreground">
            {courseId ? `Course ${courseId}` : 'All courses'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setMessages([])} disabled={!messages.length}>
          <Trash2 className="size-3.5" />
          Clear
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-4 py-4">
          {messages.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask about syllabus, deadlines, or course content. Conversations aren&apos;t saved between visits.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'flex flex-col gap-1',
                m.role === 'user' && 'items-end',
              )}
            >
              {m.role === 'tool' ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground">
                  <Wrench className="size-3 shrink-0 text-primary" />
                  {m.content}
                </div>
              ) : m.role === 'user' ? (
                <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm">
                  {m.content}
                </div>
              ) : (
                <div className="max-w-[95%] text-sm leading-relaxed text-foreground/90">
                  {m.content}
                  {streaming && i === messages.length - 1 && !m.content && (
                    <Loader2 className="mt-1 size-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex flex-col gap-2 p-3">
        {streaming && (
          <Badge variant="secondary" className="w-fit gap-1">
            <Loader2 className="size-3 animate-spin" />
            Running tools…
          </Badge>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask anything… (Enter to send)"
            disabled={streaming}
            rows={2}
            className="min-h-[52px] resize-none"
          />
          <Button onClick={send} disabled={streaming || !input.trim()} size="icon" className="shrink-0">
            {streaming ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  )
}
