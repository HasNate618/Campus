import { refTarget, workspaceHref } from './refs.ts';
import type { ResolvedRef } from './refs.ts';

/**
 * What to do when a `[[file:path]]` chip is clicked.
 *
 * Extracted from ChatView so the routing decision can be tested — the DOM
 * wiring around it cannot be, without a test runner the project has chosen not
 * to add. This is the same seam as `renderFileRefs` in md.ts.
 */
export type FileRefAction =
  | { kind: 'content'; courseId: number; nodeId?: number; fileId?: number }
  | { kind: 'workspace'; courseId: number; href: string; path: string };

/**
 * A chip resolves to course material when the ref maps to a corpus node, and
 * to the workspace otherwise. The marker is written by the model, so a wrong
 * path still has to land somewhere useful: the resolver throws 404 for a
 * workspace path and the caller passes `null`, which is the workspace case,
 * not an error.
 */
export function fileRefAction(
  resolved: ResolvedRef | null,
  courseId: number | null | undefined,
): FileRefAction | null {
  if (!courseId) return null;
  const target = refTarget(resolved);
  if (target.kind === 'content') {
    return { kind: 'content', courseId, nodeId: target.nodeId, fileId: target.fileId };
  }
  // Without the server's course-relative `rel` we still reach the workspace,
  // just with no file selected — the client cannot derive the term/code prefix.
  return {
    kind: 'workspace',
    courseId,
    href: target.rel ? workspaceHref(courseId, target.rel) : `/courses/${courseId}/workspace`,
    path: target.rel,
  };
}
