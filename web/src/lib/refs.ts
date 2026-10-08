/**
 * Pure decisions behind an inline file reference. Kept out of the components
 * so they can be unit-tested without a DOM: which tab a resolved reference
 * opens, and how the two URLs are built.
 *
 * Dependency-free for the same reason as fileRefs.ts — Node's test runner
 * cannot load anything that reaches CSS, marked or dompurify.
 */

/** Shape returned by `api.resolveRef` (mirrors api/routers/courses.py:166). */
export interface ResolvedRef {
  kind: string
  courseId: number
  nodeId?: number
  fileId?: number
  ref?: string
  isPdf?: boolean
}

export type RefTarget =
  | { kind: 'content'; fileId?: number; nodeId?: number }
  | { kind: 'workspace' }

/**
 * Where a reference should open. A corpus hit — anything resolve_ref could
 * map to a file or a node — goes to the Content tab, which knows how to show
 * a PDF page, an assignment or a module. Everything else is a workspace path.
 *
 * `null` is the normal workspace case, not a failure: `resolveRef` throws a
 * 404 for a path that is not in the corpus, and the caller passes null.
 */
export function refTarget(resolved: ResolvedRef | null): RefTarget {
  if (resolved && (resolved.fileId != null || resolved.nodeId != null)) {
    return { kind: 'content', fileId: resolved.fileId, nodeId: resolved.nodeId }
  }
  return { kind: 'workspace' }
}

/** Deep link that selects a file in the Workspace tab. */
export function workspaceHref(courseId: number, path: string): string {
  return `/courses/${courseId}/workspace?path=${encodeURIComponent(path)}`
}

/** Directories a workspace path sits under, shallowest first — for expanding
 *  the tree so the selected file is visible. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * URL for a file under the data root. Segments are encoded but the `/`
 * separators are kept: the route is `/api/assets/{rel_path:path}`, so an
 * encoded separator would not match. Without this, a filename containing `#`
 * or `?` produces a broken link (services.workspace_read interpolates the raw
 * path into the URL it returns).
 */
export function assetHref(path: string): string {
  return `/api/assets/${path.split('/').map(encodeURIComponent).join('/')}`
}
