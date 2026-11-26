export function parseDate(s?: string | null): Date | null {
  if (!s) return null
  // Three shapes come back from the harness:
  //   '2026-12-07T04:59:59.000Z'  UTC, keep the Z (correct instant)
  //   '2026-11-19 10:00:51'       SQLite datetime('now') — UTC, NO marker.
  //   '2026-12-01'                date-only, a local calendar day from the LMS.
  // A space-separated naive string is NOT valid JS Date input, so a sync-run
  // timestamp rendered as "Invalid Date" in the dashboard. Convert it to ISO
  // with an explicit Z before parsing.
  let t: string
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    t = `${s.replace(' ', 'T')}Z`
  } else if (s.includes('T')) {
    t = s.replace(' ', 'T')
  } else {
    // Date-only strings must parse as LOCAL time: new Date('2026-09-18')
    // is UTC midnight, which renders as the previous day in UTC-5 (and
    // misplaces calendar columns + isPast). Noon is DST-safe.
    t = `${s}T12:00`
  }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(s?: string | null): string {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateTime(s?: string | null): string {
  const d = parseDate(s)
  if (!d) return '—'
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export function fmtTime(s?: string | null): string {
  const d = parseDate(s)
  if (!d) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Format a harness timestamp in an EXPLICIT IANA zone.
 *
 * Sync runs are stored as UTC (`2026-11-26 10:00:39`) but the configured slot
 * is 05:00 America/Toronto. Using the DEVICE zone meant a laptop in Toronto
 * showed 5am while a phone set to UTC showed 10am — the same run, two times.
 * The server publishes its configured zone at /api/sync/status.auto_sync.timezone;
 * pass it here so every device agrees.
 */
export function fmtDateTimeInZone(
  s: string | null | undefined,
  timeZone?: string | null,
): string {
  const d = parseDate(s)
  if (!d) return '—'
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }
  if (timeZone) opts.timeZone = timeZone
  // en-CA keeps the 'Nov 26, 5:00 a.m.' shape stable across browser locales.
  return d.toLocaleString('en-CA', opts)
}

export function fmtRelative(s?: string | null): string {
  const d = parseDate(s)
  if (!d) return '—'
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(s)
}

export function fmtDue(s?: string | null): string {
  const d = parseDate(s)
  if (!d) return 'no due date'
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export function isPast(s?: string | null): boolean {
  const d = parseDate(s)
  return d != null && d.getTime() < Date.now()
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function eventDayKey(e: { starts_at: string }): string {
  const d = parseDate(e.starts_at)
  return d ? dayKey(d) : ''
}
