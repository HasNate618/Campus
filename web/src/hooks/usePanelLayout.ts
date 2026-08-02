import { useCallback, useEffect, useState } from 'react'

const NARROW_BREAKPOINT = 1280

export function usePanelLayout() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < NARROW_BREAKPOINT : false,
  )
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= NARROW_BREAKPOINT : true,
  )
  const [chatOpen, setChatOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= NARROW_BREAKPOINT : true,
  )

  useEffect(() => {
    const onResize = () => {
      const isNarrow = window.innerWidth < NARROW_BREAKPOINT
      setNarrow(isNarrow)
      if (isNarrow) {
        setSidebarOpen(false)
        setChatOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  const toggleChat = useCallback(() => setChatOpen((v) => !v), [])

  const openSidebar = useCallback(() => setSidebarOpen(true), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const openChat = useCallback(() => setChatOpen(true), [])
  const closeChat = useCallback(() => setChatOpen(false), [])

  return {
    narrow,
    sidebarOpen,
    chatOpen,
    toggleSidebar,
    toggleChat,
    openSidebar,
    closeSidebar,
    openChat,
    closeChat,
  }
}
