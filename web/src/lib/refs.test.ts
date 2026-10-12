import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ancestorDirs, refTarget, workspaceHref } from './refs.ts'

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

  it('passes through the course-relative path the server resolved', () => {
    // The server strips the term/code prefix the client cannot know about.
    assert.deepEqual(refTarget({ kind: 'workspace', courseId: 1, rel: 'notes/x.md' }), {
      kind: 'workspace',
      rel: 'notes/x.md',
    })
  })

  it('routes an unresolved path to the workspace with no path', () => {
    // api.resolveRef THROWS (404) for a path that is neither; the caller catches
    // and passes null. That is a miss, not an error.
    assert.deepEqual(refTarget(null), { kind: 'workspace', rel: '' })
  })

  it('treats a hit with no ids and no rel as a miss', () => {
    assert.deepEqual(refTarget({ kind: 'file', courseId: 1 }), { kind: 'workspace', rel: '' })
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
