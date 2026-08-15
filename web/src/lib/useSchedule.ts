import { useEffect, useState } from 'react'
import type { ScheduleCourse } from '@/types'

// Module-level cache: the timetable is static per session, so fetch it once
// and share the promise across every caller (SchedulePage, etc.).
let schedulePromise: Promise<ScheduleCourse[]> | null = null

function fetchSchedule(): Promise<ScheduleCourse[]> {
  if (!schedulePromise) {
    schedulePromise = fetch('/api/courses/schedule').then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    })
  }
  return schedulePromise
}

export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchSchedule()
      .then((data) => {
        if (!alive) return
        setSchedule(data)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return { schedule, loading, error }
}
