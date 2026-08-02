import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, Check, ChevronDown, GraduationCap, Loader2, Wrench } from 'lucide-react'
import { COURSES, SCRIPTED, SUGGESTIONS } from './mock'

type Msg =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming: boolean }
  | { kind: 'tool'; done: boolean }

const SCOPES = ['All courses', ...COURSES.map((c) => c.code)]

export function DemoChat() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [scopeIdx, setScopeIdx] = useState(0)
  const [toolOpen, setToolOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setBusy(true)
    setInput('')
    setToolOpen(false)
    setMessages((m) => [...m, { kind: 'user', text }])

    timers.current.push(
      setTimeout(() => {
        setMessages((m) => [...m, { kind: 'tool', done: false }])
      }, 500),
    )

    timers.current.push(
      setTimeout(() => {
        setMessages((m) =>
          m.map((msg) => (msg.kind === 'tool' ? { ...msg, done: true } : msg)),
        )
        setMessages((m) => [...m, { kind: 'assistant', text: '', streaming: true }])

        let i = 0
        const tick = setInterval(() => {
          i += 3
          const slice = SCRIPTED.reply.slice(0, i)
          setMessages((m) =>
            m.map((msg) =>
              msg.kind === 'assistant' && msg.streaming ? { ...msg, text: slice } : msg,
            ),
          )
          if (i >= SCRIPTED.reply.length) {
            clearInterval(tick)
            setMessages((m) =>
              m.map((msg) =>
                msg.kind === 'assistant' && msg.streaming ? { ...msg, streaming: false } : msg,
              ),
            )
            setBusy(false)
          }
        }, 14)
        timers.current.push(tick as unknown as ReturnType<typeof setTimeout>)
      }, 1600),
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${e.target.scrollHeight}px`
  }

  return (
    <div className="demo-chat">
      <div className="demo-chat-head">
        <button
          className="demo-scope-pill"
          onClick={() => setScopeIdx((i) => (i + 1) % SCOPES.length)}
        >
          {SCOPES[scopeIdx]}
          <ChevronDown size={13} />
        </button>
      </div>

      <div className="demo-chat-scroll" ref={scrollRef}>
        <div className="demo-chat-col">
          {messages.length === 0 ? (
            <div className="demo-empty">
              <div className="demo-logo-mark">
                <GraduationCap size={24} />
              </div>
              <p className="demo-greeting">Good evening, Nate</p>
              <p className="demo-empty-sub">
                Ask about deadlines, course content, or what's on this week.
              </p>
              <div className="demo-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="demo-suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                {m.kind === 'user' && <div className="demo-msg-user">{m.text}</div>}
                {m.kind === 'assistant' && (
                  <div className="demo-msg-assistant">
                    {m.text}
                    {m.streaming && <span className="demo-cursor" />}
                  </div>
                )}
                {m.kind === 'tool' && (
                  <>
                    <button className="demo-tool" onClick={() => setToolOpen((o) => !o)}>
                      {m.done ? <Check size={13} /> : <Loader2 size={13} className="animate-spin" />}
                      <Wrench size={13} />
                      {SCRIPTED.tool.name}
                      <span style={{ opacity: 0.6 }}>{m.done ? '· 4 results' : '· running'}</span>
                    </button>
                    {toolOpen && m.done && (
                      <div className="demo-tool-detail">{SCRIPTED.tool.detail}</div>
                    )}
                  </>
                )}
              </motion.div>
            ))
          )}
        </div>
      </div>

      <div className="demo-input-dock">
        <div className="demo-input">
          <textarea
            value={input}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
            placeholder="Ask anything…"
            rows={1}
            disabled={busy}
          />
          <button
            className="demo-send"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
