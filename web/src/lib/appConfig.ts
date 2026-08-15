// Boot-time config fetch: /api/config tells the frontend which Brightspace
// hosts the content proxy allows and the base URL for rebasing relative
// /d2l/ links. Empty lists = both features disabled (portable default).

import { setProxyHosts } from './sanitize'

let brightspaceBaseUrl = ''

export function getBrightspaceBaseUrl(): string {
  return brightspaceBaseUrl
}

export async function loadAppConfig(): Promise<void> {
  try {
    const r = await fetch('/api/config')
    if (!r.ok) return
    const cfg = await r.json()
    setProxyHosts(cfg.brightspace_hosts ?? [])
    brightspaceBaseUrl = cfg.brightspace_base_url ?? ''
  } catch {
    /* API not reachable (e.g. static dev) — leave defaults (disabled) */
  }
}

// Fire once at module load — the config fetch is fast and content renders
// after the first API call anyway, so it always lands before images.
void loadAppConfig()
