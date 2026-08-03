import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: register the service worker (secure contexts only — plain-HTTP LAN
// hosts skip this silently; the Tailscale HTTPS host gets full install).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not a secure context or SW unsupported — fine on http:// LAN hosts */
    })
  })
}
