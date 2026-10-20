import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { rewriteImageSrcs } from './imgSrc.ts'

const BASE = '/api/assets/2026F/SE3310A'

describe('rewriteImageSrcs', () => {
  it('points a bare filename at the course asset route', () => {
    assert.equal(
      rewriteImageSrcs('<img src="a2-q1.1.png" alt="graph">', BASE),
      `<img src="${BASE}/a2-q1.1.png" alt="graph">`,
    )
  })

  it('keeps nested paths and encodes spaces, leaving separators literal', () => {
    assert.equal(
      rewriteImageSrcs('<img src="./work/my plot.png">', BASE),
      `<img src="${BASE}/work/my%20plot.png">`,
    )
  })

  it('tolerates a trailing slash on the base', () => {
    assert.equal(
      rewriteImageSrcs('<img src="a.png">', `${BASE}/`),
      `<img src="${BASE}/a.png">`,
    )
  })

  it('leaves srcs that already resolve alone', () => {
    for (const src of [
      'https://example.test/a.png',
      'data:image/png;base64,AAAA',
      'blob:https://campus.local/1234',
      '/api/assets/2026F/SE3310A/a.png',
      '//cdn.example.test/a.png',
    ]) {
      const html = `<img src="${src}" alt="">`
      assert.equal(rewriteImageSrcs(html, BASE), html, src)
    }
  })

  it('handles single-quoted and multiple img tags', () => {
    const out = rewriteImageSrcs(
      `<img src='one.png'><img src="two.png">`,
      BASE,
    )
    assert.match(out, /one\.png/)
    assert.ok(out.includes(`${BASE}/one.png`))
    assert.ok(out.includes(`${BASE}/two.png`))
  })

  it('is a no-op without a base', () => {
    const html = '<img src="a.png" alt="">'
    assert.equal(rewriteImageSrcs(html, ''), html)
  })

  it('leaves non-image markup untouched', () => {
    const html = '<p>see <a href="a.png">this</a></p>'
    assert.equal(rewriteImageSrcs(html, BASE), html)
  })
})
