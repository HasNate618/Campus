/* HippoCampus service worker — app-shell cache.
 * - /api/* is NEVER cached (SSE chat + live data must stay network-only)
 * - hashed build assets are cache-first (immutable)
 * - navigations are network-first with an offline fallback to the shell
 * Bump VERSION to invalidate the cache on a new deploy.
 */
const VERSION = 'hippo-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(['/', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // live data + SSE — never cached

  // hashed build assets: cache-first
  if (/\/assets\/.+\.(js|css|png|woff2?)$/.test(url.pathname) || url.pathname.startsWith('/zen-pdf/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const clone = res.clone()
            caches.open(VERSION).then((c) => c.put(req, clone))
            return res
          }),
      ),
    )
    return
  }

  // navigations (and anything else): network-first, shell fallback offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.mode === 'navigate') {
          const clone = res.clone()
          caches.open(VERSION).then((c) => c.put('/', clone))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
  )
})
