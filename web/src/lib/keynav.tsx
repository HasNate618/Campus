import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Keyboard navigation core (vim-style, normal mode only).
 *
 * Zones: 1 = sidebar, 2 = course/main, 3 = chat. Keys never fire while an
 * input/textarea is focused — Escape blurs it (returns to normal mode),
 * then 1/2/3 + hjkl work. Each pane registers a handler for its zone; the
 * provider routes keys to the ACTIVE zone's handlers in registration order
 * (child components register first, so pages see keys before their
 * parents — e.g. ContentPage handles j/k, CourseLayout handles [ ]).
 */

export type KeyZone = 'sidebar' | 'course' | 'chat'

type KeyHandler = (key: string, e: KeyboardEvent) => boolean

interface KeyNavValue {
  zone: KeyZone
  setZone: (z: KeyZone) => void
  /** Register a handler for a zone; returns an unregister function. */
  register: (zone: KeyZone, h: KeyHandler) => () => void
}

const KeyNavContext = createContext<KeyNavValue | null>(null)

/** Pane roots add `kbd-active` when their zone is the active one. */
export function useKeyNav(): KeyNavValue {
  const v = useContext(KeyNavContext)
  if (!v) throw new Error('useKeyNav must be used inside KeyNavProvider')
  return v
}

/** Register a key handler for a zone. The handler is called through a ref,
 *  so it always sees the latest closure without re-registering on every
 *  render (registration happens once per zone). */
export function useZoneKeys(zone: KeyZone, handler: KeyHandler) {
  const { register } = useKeyNav()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => register(zone, (k, e) => ref.current(k, e)), [zone, register])
}

/**
 * List cursor for j/k/g/G navigation. `count` = number of rows; attach
 * `ref={setRef(i)}` to each row and `kbd-cursor` class when cursor === i.
 */
export function useListCursor(count: number) {
  const [cursor, setCursor] = useState(-1)
  const refs = useRef<(HTMLElement | null)[]>([])

  // clamp when the list shrinks
  useEffect(() => {
    setCursor((c) => (c >= count ? count - 1 : c))
  }, [count])

  // keep the cursor row in view
  useEffect(() => {
    const el = cursor >= 0 ? refs.current[cursor] : null
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const move = useCallback(
    (d: number) => {
      setCursor((c) => {
        if (count === 0) return -1
        if (c === -1) return d > 0 ? 0 : count - 1
        return Math.max(0, Math.min(count - 1, c + d))
      })
    },
    [count],
  )
  const toTop = useCallback(() => setCursor(count > 0 ? 0 : -1), [count])
  const toBottom = useCallback(() => setCursor(count > 0 ? count - 1 : -1), [count])
  const setRef = useCallback((i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el
  }, [])

  return { cursor, setCursor, move, toTop, toBottom, setRef, refs }
}

/** Shared j/k/g/G/Enter handling for list zones. Returns true if handled. */
export function listKeys(
  key: string,
  c: { cursor: number; move: (d: number) => void; toTop: () => void; toBottom: () => void },
  onEnter: () => void,
): boolean {
  switch (key) {
    case 'j':
    case 'ArrowDown':
      c.move(1)
      return true
    case 'k':
    case 'ArrowUp':
      c.move(-1)
      return true
    case 'g':
    case 'Home':
      c.toTop()
      return true
    case 'G':
    case 'End':
      c.toBottom()
      return true
    case 'Enter':
    case 'l':
      if (c.cursor >= 0) onEnter()
      return true
    default:
      return false
  }
}

const HELP: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Global',
    rows: [
      ['1 / 2 / 3', 'Focus sidebar / course / chat'],
      ['Alt+1 / 2 / 3', 'Toggle sidebar / course / chat'],
      ['?', 'Show this help'],
      ['Esc', 'Leave input or close popups'],
    ],
  },
  {
    title: 'Sidebar',
    rows: [
      ['j / k', 'Move cursor'],
      ['Enter / l', 'Open item'],
      ['g / G', 'First / last'],
      ['c', 'Collapse sidebar'],
    ],
  },
  {
    title: 'Course',
    rows: [
      ['j / k', 'Move cursor'],
      ['Enter / l', 'Open topic'],
      ['h', 'Back / collapse module'],
      ['Tab', 'Switch tree ⇄ content'],
      ['[ / ]', 'Previous / next tab'],
      ['f', 'Split / full-width view'],
      ['m', 'PDF: extracted text ⇄ original'],
      ['Esc (PDF)', 'Return to sidebar control'],
      ['g / G', 'First / last'],
    ],
  },
  {
    title: 'Chat',
    rows: [
      ['j / k', 'Scroll'],
      ['g / G', 'Top / bottom'],
      ['Enter / i', 'Focus the input'],
      ['m', 'Model selector'],
      ['n', 'New chat'],
      ['r', 'Regenerate last answer'],
      ['h', 'Chat history'],
    ],
  },
]

export function KeyNavProvider({ children }: { children: ReactNode }) {
  const [zone, setZone] = useState<KeyZone>('sidebar')
  const [helpOpen, setHelpOpen] = useState(false)
  const zoneRef = useRef(zone)
  zoneRef.current = zone
  const handlersRef = useRef<Record<KeyZone, KeyHandler[]>>({ sidebar: [], course: [], chat: [] })
  const helpRef = useRef(helpOpen)
  helpRef.current = helpOpen
  const { pathname } = useLocation()

  // route default: course pages → course, chat tab → chat, else sidebar
  useEffect(() => {
    if (pathname.startsWith('/courses')) setZone('course')
    else if (pathname.startsWith('/chat')) setZone('chat')
    else setZone('sidebar')
  }, [pathname])

  const register = useCallback((z: KeyZone, h: KeyHandler) => {
    handlersRef.current[z].push(h)
    return () => {
      handlersRef.current[z] = handlersRef.current[z].filter((x) => x !== h)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+1/2/3 toggle pane visibility (sidebar collapse, course, chat) —
      // handled before the browser-shortcut bail so they work anywhere.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
        const pane = e.key === '1' ? 'sidebar' : e.key === '2' ? 'course' : 'chat'
        window.dispatchEvent(new CustomEvent('campus:toggle-pane', { detail: { pane } }))
        e.preventDefault()
        return
      }
      // browser/OS shortcuts always pass through
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      // vim insert mode: while typing, only Escape exits to normal mode
      if (typing) {
        if (e.key === 'Escape') {
          ;(target as HTMLElement).blur()
          e.preventDefault()
        }
        return
      }

      if (helpRef.current) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault()
          setHelpOpen(false)
        }
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      const run = (key: string): boolean => {
        for (const h of handlersRef.current[zoneRef.current]) {
          if (h(key, e)) return true
        }
        return false
      }

      if (e.key === '1' || e.key === '2' || e.key === '3') {
        setZone(e.key === '1' ? 'sidebar' : e.key === '2' ? 'course' : 'chat')
        e.preventDefault()
        return
      }

      // native Enter/Space on a focused button/link must keep working
      const interactive =
        !!target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'SELECT')
      if (interactive && (e.key === 'Enter' || e.key === ' ')) return

      if (run(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Clicking a pane switches the active zone to it (the pane roots carry
  // data-kbd-zone="sidebar|course|chat"; the closest ancestor wins).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      const pane = t.closest('[data-kbd-zone]') as HTMLElement | null
      const z = pane?.dataset.kbdZone as KeyZone | undefined
      if (z && (z === 'sidebar' || z === 'course' || z === 'chat')) setZone(z)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [setZone])

  return (
    <KeyNavContext.Provider value={{ zone, setZone, register }}>
      {children}
      {helpOpen && (
        <div className="kbd-help-backdrop" onClick={() => setHelpOpen(false)}>
          <div className="kbd-help" onClick={(e) => e.stopPropagation()}>
            <h3 className="kbd-help-title">Keyboard shortcuts</h3>
            {HELP.map((s) => (
              <div key={s.title} className="kbd-help-section">
                <p className="kbd-help-heading">{s.title}</p>
                {s.rows.map(([keys, desc]) => (
                  <div key={keys} className="kbd-help-row">
                    <span className="kbd-help-keys">{keys}</span>
                    <span className="kbd-help-desc">{desc}</span>
                  </div>
                ))}
              </div>
            ))}
            <p className="kbd-help-hint">
              Esc leaves an input (normal mode) · ? or Esc closes this · keys never fire while typing
            </p>
          </div>
        </div>
      )}
    </KeyNavContext.Provider>
  )
}
