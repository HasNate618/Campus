import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fileRefAction } from './fileRefAction.ts';

const CID = 5;

describe('fileRefAction', () => {
  it('sends a corpus hit to the Content tab', () => {
    const a = fileRefAction({ kind: 'file', courseId: CID, fileId: 12 }, CID);
    assert.equal(a?.kind, 'content');
    assert.equal(a?.kind === 'content' && a.fileId, 12);
  });

  it('sends a node hit to the Content tab carrying the node id', () => {
    const a = fileRefAction({ kind: 'node', courseId: CID, nodeId: 7 }, CID);
    assert.ok(a?.kind === 'content' && a.nodeId === 7);
  });

  it('opens the workspace when the server supplies the course-relative path', () => {
    // The fix for the bug where the chip 404'd and selected nothing: the marker
    // path is data-root-relative, the tree is course-relative, and only the
    // server can translate between them.
    const a = fileRefAction(
      { kind: 'workspace', courseId: CID, ref: '2026F/ECE4436A/uploads/notes.txt', rel: 'uploads/notes.txt' },
      CID,
    );
    assert.ok(a?.kind === 'workspace');
    assert.equal(a.kind === 'workspace' && a.href, '/courses/5/workspace?path=uploads%2Fnotes.txt');
    assert.equal(a.kind === 'workspace' && a.path, 'uploads/notes.txt');
  });

  it('falls back to the workspace with nothing selected when rel is missing', () => {
    // A 404 from resolve_ref is the normal case for a workspace path, not an
    // error — the chip must still lead somewhere useful.
    const a = fileRefAction(null, CID);
    assert.ok(a?.kind === 'workspace');
    assert.equal(a.kind === 'workspace' && a.href, '/courses/5/workspace');
    assert.equal(a.kind === 'workspace' && a.path, '');
  });

  it('does nothing without a course', () => {
    assert.equal(fileRefAction(null, null), null);
    assert.equal(fileRefAction({ kind: 'file', courseId: 0, fileId: 1 }, 0), null);
  });

  it('treats a ref with neither fileId nor nodeId as the workspace case', () => {
    const a = fileRefAction({ kind: 'file', courseId: CID, ref: 'x.md', rel: 'notes/x.md' }, CID);
    assert.ok(a?.kind === 'workspace' && a.path === 'notes/x.md');
  });
});
