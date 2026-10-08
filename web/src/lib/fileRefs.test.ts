import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { escapeHtml, renderFileRefs } from './fileRefs.ts'

describe('renderFileRefs', () => {
  it('turns a file marker into a chip carrying the path', () => {
    const html = renderFileRefs('see [[file:2026F/CS1100A/uploads/slides.pdf]]')
    assert.ok(html.includes('data-file-path="2026F/CS1100A/uploads/slides.pdf"'))
    assert.ok(html.includes('>slides.pdf</button>'))
  })

  it('labels the chip with the basename, not the whole path', () => {
    const html = renderFileRefs('[[file:a/b/c.md]]')
    assert.ok(html.includes('>c.md</button>'))
    assert.ok(html.includes('title="a/b/c.md"'))
  })

  it('leaves a traversal path as literal text', () => {
    const md = '[[file:../../etc/passwd]]'
    assert.equal(renderFileRefs(md), md)
  })

  it('leaves a half-typed marker as literal text', () => {
    const md = 'see [[file:abc'
    assert.equal(renderFileRefs(md), md)
  })

  it('escapes the path so it cannot break out of the attribute', () => {
    const html = renderFileRefs('[[file:a/"onmouseover=alert(1)]]')
    assert.ok(!html.includes('"onmouseover='))
    assert.ok(html.includes('&quot;'))
  })

  it('renders both marker kinds in one message', () => {
    const html = renderFileRefs('a [cite:3] b [[file:x/y.md]]')
    assert.ok(html.includes('[cite:3]'))
    assert.ok(html.includes('data-file-path="x/y.md"'))
  })

  it('leaves an ordinary markdown link alone', () => {
    const md = 'see [docs](https://example.com)'
    assert.equal(renderFileRefs(md), md)
  })
})

describe('escapeHtml', () => {
  it('escapes the four characters that matter in an attribute or text node', () => {
    assert.equal(escapeHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e')
  })
})
