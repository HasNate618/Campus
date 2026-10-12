/**
 * Pure decisions behind an inline file reference. Kept out of the components
 * so they can be unit-tested without a DOM: which tab a resolved reference
 * opens, and the one URL the client builds itself.
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
  /**
   * Course-relative path for a workspace file, supplied by the SERVER.
   *
   * The client cannot derive it itself: a `[[file:…]]` marker carries the
   * data-root-relative path (`2026F/CS1100A/notes/x.md`) while the workspace
   * tree speaks course-relative (`notes/x.md`), and the client does not
   * reliably know the term/code prefix. (It once tried — and built broken
   * download URLs from the wrong form.)
   */
  rel?: string
}

export type RefTarget =
  | { kind: 'content'; fileId?: number; nodeId?: number }
  | { kind: 'workspace'; rel: string }

/**
 * Where a reference should open. A corpus hit — anything resolve_ref could map
 * to a file or a node — goes to the Content tab, which knows how to show a PDF
 * page, an assignment or a module. A workspace file goes to the Workspace tab
 * with that file selected.
 *
 * `null` is the miss: resolve_ref throws a 404 for a path that is neither
 * corpus nor a workspace file, and the caller turns that into null.
 */
export function refTarget(resolved: ResolvedRef | null): RefTarget {
  if (resolved && (resolved.fileId != null || resolved.nodeId != null)) {
    return { kind: 'content', fileId: resolved.fileId, nodeId: resolved.nodeId }
  }
  return { kind: 'workspace', rel: resolved?.rel ?? '' }
}

/** Deep link that selects a file in the Workspace tab. */
export function workspaceHref(courseId: number, path: string): string {
  return `/courses/${courseId}/workspace?path=${encodeURIComponent(path)}`
}

/**
 * Directories a workspace path sits under, shallowest first — for expanding
 * the tree so the selected file is visible.
 */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * A chip click posts this so the workspace selects its file directly. The URL
 * param alone cannot do it: react-router does not re-render on a redundant
 * navigation, so clicking the same chip twice while that file's URL is already
 * open would never reach the effect.
 */
export const WORKSPACE_OPEN_EVENT = 'campus:open-workspace-file'
