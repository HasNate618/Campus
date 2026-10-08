import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ancestorDirs, assetHref, refTarget, workspaceHref } from './refs.ts'

describe('refTarget', () => {
  it('routes a resolved corpus file to the content tab', () => {
    assert.deepEqual(refTarget({ kind: 'file', courseId: 1, fileId: 7, nodeId: 3 }), {
      kind: 'content',
      fileId: 7,
      nodeId: 3,
    })
  })

  it('routes a node-only hit to the content tab', () => {
    assert.deepEqual(refTarget({ kind: 'overview', courseId: 1, nodeId: 9 }), {
      kind: 'content',
      fileId: undefined,
      nodeId: 9,
    })
  })

  it('routes an unresolved path to the workspace', () => {
    // api.resolveRef THROWS (404) for a workspace path; the caller catches and
    // passes null. That null is the workspace case, not an error.
    assert.deepEqual(refTarget(null), { kind: 'workspace' })
  })

  it('treats a hit with no ids as a workspace path', () => {
    assert.deepEqual(refTarget({ kind: 'file', courseId: 1 }), { kind: 'workspace' })
  })
})

describe('workspaceHref', () => {
  it('encodes the path into the query string', () => {
    assert.equal(
      workspaceHref(4, 'uploads/a b#c.md'),
      '/courses/4/workspace?path=uploads%2Fa%20b%23c.md',
    )
  })
})

describe('ancestorDirs', () => {
  it('lists the directories a file sits under, shallowest first', () => {
    assert.deepEqual(ancestorDirs('uploads/sub/deep.md'), ['uploads', 'uploads/sub'])
  })

  it('returns nothing for a top-level file', () => {
    assert.deepEqual(ancestorDirs('syllabus.md'), [])
  })
})

describe('assetHref', () => {
  it('encodes each segment but keeps the separators', () => {
    // The route is /api/assets/{rel_path:path} — a %2F would break routing.
    assert.equal(
      assetHref('2026F/CS1100A/content/Course Overview/a#b.pdf'),
      '/api/assets/2026F/CS1100A/content/Course%20Overview/a%23b.pdf',
    )
  })
})
