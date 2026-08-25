import { useEffect, useState } from 'react'

// Stale-while-revalidate for page-level GETs. Top-level pages remount on
// every mobile tab switch; without a cache each one paints empty until its
// fetch resolves. With it, the last-known value renders instantly and a
// background revalidation refreshes it. Keys are process-lifetime (static
// strings), matching the "one app session" usage here — same idea as the
// promise cache in useSchedule.ts.
const cache = new Map<string, unknown>()

/**
 * @param key      stable request key ('courses', 'digest', …)
 * @param fetcher  called on every mount to revalidate
 * @param initial  value before the first fetch resolves
 * @returns [data, loading] — loading is true only when nothing is cached yet
 */
export function useSWR<T>(key: string, fetcher: () => Promise<T>, initial: T): [T, boolean] {
  const [data, setData] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : initial))
  const [loading, setLoading] = useState(() => !cache.has(key))

  useEffect(() => {
    let alive = true
    fetcher()
      .then((d) => {
        if (!alive) return
        cache.set(key, d)
        setData(d)
      })
      .catch(console.error) // keep whatever we already have on failure
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // `key` identifies the request; fetcher identity changes every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [data, loading]
}
