/**
 * Zen PDF pixel pipeline — faithful TypeScript port of the canvas treatment
 * from https://github.com/HasNate618/zen-pdf-viewer (viewer.html):
 * detect the page's paper background, drop it (pageless: transparent) or
 * shade it (paged: dark), then invert luma so dark text becomes light.
 * Images keep their hue via HSL lightness inversion unless grayscale.
 */

const ZEN = {
  pageShade: 18, // paged mode: paper replaced with this gray
  paperLumaMin: 232,
  paperChromaMax: 16,
  haloLumaMin: 205,
  haloChromaMax: 32,
  bgEdgeCoverageMin: 0.5,
  bgRgbTol: 38,
  bgLumaTol: 32,
  bgFringeLuma: 44,
}

interface PageBg {
  r: number
  g: number
  b: number
  luma: number
  chroma: number
  isDark: boolean
}

function pixelLumaChroma(r: number, g: number, b: number): { luma: number; chroma: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, chroma: max - min }
}

function rgbToHsl255(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0)
        break
      case gn:
        h = (bn - rn) / d + 2
        break
      default:
        h = (rn - gn) / d + 4
    }
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb255(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

function zenRecolorRgb(r: number, g: number, b: number, keepImagesColor: boolean, pageBg: PageBg | null): [number, number, number] {
  if (pageBg?.isDark) {
    if (keepImagesColor) return [r, g, b]
    const { luma } = pixelLumaChroma(r, g, b)
    const inv = 255 - luma
    return [inv, inv, inv]
  }
  if (keepImagesColor) {
    const [h, s, l] = rgbToHsl255(r, g, b)
    return hslToRgb255(h, s, 1 - l)
  }
  const { luma } = pixelLumaChroma(r, g, b)
  const inv = 255 - luma
  return [inv, inv, inv]
}

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function detectCanvasBackground(d: Uint8ClampedArray, w: number, h: number): PageBg | null {
  if (w < 3 || h < 3) return null
  const border = Math.max(1, Math.floor(Math.min(w, h) * 0.02))
  const samples: { r: number; g: number; b: number; luma: number; chroma: number }[] = []
  const sampleAt = (x: number, y: number): void => {
    const i = (y * w + x) * 4
    if (d[i + 3] < 4) return
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const { luma, chroma } = pixelLumaChroma(r, g, b)
    if (chroma > ZEN.paperChromaMax + 10) return
    samples.push({ r, g, b, luma, chroma })
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < border || x >= w - border || y < border || y >= h - border) sampleAt(x, y)
    }
  }
  if (samples.length < 12) return null
  const r = Math.round(medianOf(samples.map((s) => s.r)))
  const g = Math.round(medianOf(samples.map((s) => s.g)))
  const b = Math.round(medianOf(samples.map((s) => s.b)))
  const { luma, chroma } = pixelLumaChroma(r, g, b)
  const isDark = luma < 128
  let matching = 0
  for (const sample of samples) {
    if (sample.chroma > ZEN.paperChromaMax + 6) continue
    if (rgbDistance(sample.r, sample.g, sample.b, r, g, b) <= ZEN.bgRgbTol) matching++
  }
  if (matching / samples.length < ZEN.bgEdgeCoverageMin) return null
  return { r, g, b, luma, chroma, isDark }
}

function isBackgroundPixel(r: number, g: number, b: number, a: number, pageBg: PageBg | null): boolean {
  if (a < 4) return true
  const { luma, chroma } = pixelLumaChroma(r, g, b)
  if (pageBg) {
    if (chroma > ZEN.paperChromaMax + (pageBg.isDark ? 12 : 4)) return false
    if (rgbDistance(r, g, b, pageBg.r, pageBg.g, pageBg.b) > ZEN.bgRgbTol) return false
    if (pageBg.isDark) return luma <= pageBg.luma + ZEN.bgLumaTol
    return luma >= pageBg.luma - ZEN.bgLumaTol
  }
  return luma >= ZEN.paperLumaMin && chroma <= ZEN.paperChromaMax
}

function applyPaperTreatment(data: Uint8ClampedArray, index: number, pageless: boolean): void {
  if (pageless) {
    data[index + 3] = 0 // drop the paper entirely — app surface shows through
    return
  }
  data[index] = ZEN.pageShade
  data[index + 1] = ZEN.pageShade
  data[index + 2] = ZEN.pageShade
  data[index + 3] = 255
}

function buildBackgroundMask(d: Uint8ClampedArray, w: number, h: number, pageBg: PageBg | null): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    if (d[i + 3] === 0) continue
    if (isBackgroundPixel(d[i], d[i + 1], d[i + 2], d[i + 3], pageBg)) mask[p] = 1
  }
  // fringe: pixels hugging the paper get the paper treatment too (anti-aliasing)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (mask[p]) continue
      const i = p * 4
      if (d[i + 3] === 0) continue
      const { luma, chroma } = pixelLumaChroma(d[i], d[i + 1], d[i + 2])
      if (chroma > ZEN.haloChromaMax) continue
      let nearBg = false
      for (let dy = -2; dy <= 2 && !nearBg; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (mask[(y + dy) * w + (x + dx)] === 1) {
            nearBg = true
            break
          }
        }
      }
      if (!nearBg) continue
      if (pageBg?.isDark) {
        if (luma <= pageBg.luma + ZEN.bgFringeLuma && chroma <= ZEN.paperChromaMax + 8) mask[p] = 1
      } else if (luma >= ZEN.haloLumaMin && chroma <= ZEN.haloChromaMax) {
        mask[p] = 1
      }
    }
  }
  return mask
}

/**
 * Apply the zen treatment to a rendered page canvas.
 * @param canvas  rendered page canvas
 * @param pageless  true: paper becomes transparent; false: paper becomes dark shade
 * @param keepImagesColor  true: invert lightness only (hue preserved)
 */
export function applyZenFilter(canvas: HTMLCanvasElement, pageless: boolean, keepImagesColor = true): void {
  const w = canvas.width
  const h = canvas.height
  if (w < 2 || h < 2) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const pageBg = detectCanvasBackground(d, w, h)

  if (pageless && w > 2 && h > 2) {
    const bgMask = buildBackgroundMask(d, w, h, pageBg)
    for (let p = 0; p < w * h; p++) {
      if (!bgMask[p]) continue
      applyPaperTreatment(d, p * 4, pageless)
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    if (a === 0) continue
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    if (!pageless && isBackgroundPixel(r, g, b, a, pageBg)) {
      applyPaperTreatment(d, i, pageless)
      continue
    }
    const [nr, ng, nb] = zenRecolorRgb(r, g, b, keepImagesColor, pageBg)
    d[i] = nr
    d[i + 1] = ng
    d[i + 2] = nb
    if (pageless && !pageBg?.isDark) {
      const post = pixelLumaChroma(nr, ng, nb)
      if (post.luma < 14) d[i + 3] = 0 // pure-black content dropped on the transparent page
    }
  }
  ctx.putImageData(img, 0, 0)
}
