// Headless renderer tests. Plain Node environment — no jsdom, no canvas
// stubs: if this package needed a browser global, these tests would fail.

import { describe, it, expect } from 'vitest'
import { Canvas } from 'skia-canvas'
import { Store, THEMES } from '@quickdrawjs/core'

import { renderPng, RenderError } from '../src/index.js'
import {
  PNG_SIG, pngMeta, readPixels, px, countOpaque,
  kitchenSink, testImageURL, snapshotWithImage,
} from './helpers.mjs'

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

describe('basics', () => {
  it('returns a real PNG Buffer with a valid signature', async () => {
    const png = await renderPng(kitchenSink().getSnapshot(), { width: 800, height: 500 })
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(pngMeta(png).signature).toBe(PNG_SIG)
  })

  it('output dimensions always match the request, even odd sizes', async () => {
    for (const [w, h] of [[1, 1], [333, 177], [1920, 1080]]) {
      const png = await renderPng(kitchenSink().getSnapshot(), { width: w, height: h, padding: 0 })
      expect(pngMeta(png)).toMatchObject({ width: w, height: h })
    }
  })

  it('blank snapshot renders a blank image (documented empty-document policy)', async () => {
    const empty = new Store().getSnapshot()
    const clear = await renderPng(empty, { width: 200, height: 100 })
    expect(pngMeta(clear)).toMatchObject({ width: 200, height: 100 })
    const pixels = await readPixels(clear)
    expect(countOpaque(pixels)).toBe(0)

    const paper = await renderPng(empty, { width: 64, height: 64, background: 'theme', padding: 8 })
    const pp = await readPixels(paper)
    expect(countOpaque(pp)).toBe(64 * 64)
    expect(px(pp, 0, 0).slice(0, 3)).toEqual(hex(THEMES.light.background))
  })
})

describe('no browser globals', () => {
  it('renders every shape kind with window/document/OffscreenCanvas/Image/Path2D absent', async () => {
    for (const g of ['window', 'document', 'OffscreenCanvas', 'Image', 'Path2D']) {
      delete globalThis[g]
    }
    expect([
      globalThis.window, globalThis.document, globalThis.OffscreenCanvas,
      globalThis.Image, globalThis.Path2D,
    ].every((v) => v === undefined)).toBe(true)

    const store = kitchenSink()
    store.put({ id: 'asset:img1', typeName: 'asset', src: await testImageURL(), w: 8, h: 8 })
    store.put({
      id: 'shape:image1', typeName: 'shape', type: 'image', x: 620, y: 300, rot: 0, z: 30,
      props: { w: 80, h: 80, assetId: 'asset:img1' },
    })
    const png = await renderPng(store.getSnapshot(), { width: 800, height: 500, theme: 'dark' })
    const pixels = await readPixels(png)
    // the full board draws a lot of ink in either theme
    expect(countOpaque(pixels)).toBeGreaterThan(20_000)
  })
})

describe('content fit', () => {
  it('centers content with padding and keeps transparency', async () => {
    const store = new Store()
    store.put({
      id: 'shape:one', typeName: 'shape', type: 'geo', x: -50, y: -25, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 100, h: 50, color: 'blue', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const png = await renderPng(store.getSnapshot(), { width: 400, height: 200, padding: 20 })
    const pixels = await readPixels(png)
    // symmetric content stays centered however the margin expands it
    expect(px(pixels, 200, 100).slice(0, 3)).toEqual(hex('#dfe5fb'))
    // ...and the padding ring stays transparent
    expect(px(pixels, 2, 2)[3]).toBe(0)
    expect(px(pixels, 397, 197)[3]).toBe(0)
  })

  it('finds drawings at negative coordinates', async () => {
    const store = new Store()
    store.put({
      id: 'shape:neg', typeName: 'shape', type: 'geo', x: -650, y: -450, rot: 0, z: 1,
      props: { geo: 'ellipse', w: 100, h: 80, color: 'red', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const png = await renderPng(store.getSnapshot(), { width: 400, height: 300 })
    const pixels = await readPixels(png)
    expect(px(pixels, 200, 150).slice(0, 3)).toEqual(hex('#f9dcdc'))
  })

  it('renders rotated shapes without clipping their corners', async () => {
    const store = new Store()
    store.put({
      id: 'shape:rot', typeName: 'shape', type: 'geo', x: 0, y: 0, rot: Math.PI / 4, z: 1,
      props: { geo: 'rectangle', w: 120, h: 60, color: 'green', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const png = await renderPng(store.getSnapshot(), { width: 400, height: 400, padding: 10 })
    expect(countOpaque(await readPixels(png))).toBeGreaterThan(1_000)
  })
})

describe('explicit viewport', () => {
  const viewport = { x: 0, y: 0, w: 200, h: 100 }

  it('maps page units 1:1 at matching output size with zero padding', async () => {
    const store = new Store()
    store.put({
      id: 'shape:r', typeName: 'shape', type: 'geo', x: 10, y: 10, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 100, h: 60, color: 'blue', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 200, height: 100, fit: 'viewport', viewport, padding: 0,
    })
    const pixels = await readPixels(png)
    expect(px(pixels, 60, 40).slice(0, 3)).toEqual(hex('#dfe5fb'))
    expect(px(pixels, 190, 90)[3]).toBe(0)
  })

  it('renders shapes that extend beyond the viewport', async () => {
    const store = new Store()
    store.put({
      id: 'shape:big', typeName: 'shape', type: 'geo', x: -500, y: -500, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 2000, h: 2000, color: 'green', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 200, height: 100, fit: 'viewport', viewport, padding: 0, background: 'theme',
    })
    const pixels = await readPixels(png)
    expect(px(pixels, 100, 50).slice(0, 3)).toEqual(hex('#d3ebe3'))
  })
})

describe('stacking order', () => {
  it('paints higher z-index shapes on top', async () => {
    const store = new Store()
    const rect = (id, x, y, z, color) => ({
      id, typeName: 'shape', type: 'geo', x, y, rot: 0, z,
      props: { geo: 'rectangle', w: 100, h: 60, color, size: 'm', dash: 'solid', fill: 'solid' },
    })
    store.put(rect('shape:bottom', 10, 10, 1, 'red'))
    store.put(rect('shape:top', 50, 30, 2, 'blue'))
    const png = await renderPng(store.getSnapshot(), {
      width: 200, height: 100, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 200, h: 100 }, padding: 0,
    })
    const pixels = await readPixels(png)
    expect(px(pixels, 75, 50).slice(0, 3)).toEqual(hex('#dfe5fb')) // top wins
    expect(px(pixels, 20, 20).slice(0, 3)).toEqual(hex('#f9dcdc')) // bottom alone
  })

  it('draws highlighters beneath other strokes, not over them', async () => {
    const store = new Store()
    store.put({
      id: 'shape:hl', typeName: 'shape', type: 'highlight', x: 0, y: 0, rot: 0, z: 99,
      props: { pts: [0, 50, 0.5, 200, 50, 0.5], size: 'm', color: 'yellow' },
    })
    store.put({
      id: 'shape:ink', typeName: 'shape', type: 'draw', x: 0, y: 0, rot: 0, z: 1,
      props: { pts: [0, 50, 0.5, 200, 50, 0.5], size: 'xl', color: 'black', dash: 'solid', done: true },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 200, height: 100, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 200, h: 100 }, padding: 0,
    })
    const pixels = await readPixels(png)
    // opaque ink on the centerline: pure stroke color, unmultiplied
    const [r, g, b] = px(pixels, 100, 50).slice(0, 3)
    const [er, eg, eb] = hex('#1d1d1d')
    expect(Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb)).toBeLessThanOrEqual(6)
  })
})

describe('text and sticky notes', () => {
  it('renders text glyphs and wrapped sticky-note text', async () => {
    const store = new Store()
    store.put({
      id: 'shape:text1', typeName: 'shape', type: 'text', x: 10, y: 10, rot: 0, z: 1,
      props: { text: 'Hello quickdraw', size: 'm', color: 'black', font: 'draw', align: 'start' },
    })
    store.put({
      id: 'shape:note1', typeName: 'shape', type: 'note', x: 10, y: 120, rot: 0, z: 2,
      props: {
        text: 'a sticky note with enough words that it must wrap onto several lines',
        size: 'm', color: 'yellow', font: 'draw', scale: 1,
      },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 260, height: 340, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 260, h: 340 }, padding: 0,
    })
    const pixels = await readPixels(png)
    const dark = (p) => p[0] < 90 && p[1] < 90 && p[2] < 90 && p[3] > 200
    let glyphs = 0
    for (let y = 10; y < 60; y++) for (let x = 10; x < 250; x++) if (dark(px(pixels, x, y))) glyphs++
    expect(glyphs).toBeGreaterThan(30)
    // sticky paper away from its centered text (note color 'yellow')
    expect(px(pixels, 30, 140).slice(0, 3)).toEqual(hex('#fbe5c0'))
    let noteGlyphs = 0
    for (let y = 120; y < 320; y++) for (let x = 10; x < 210; x++) if (dark(px(pixels, x, y))) noteGlyphs++
    expect(noteGlyphs).toBeGreaterThan(30)
  })

  it('wraps long note text onto multiple lines', async () => {
    const { noteLayout } = await import('@quickdrawjs/core')
    const layout = noteLayout({
      id: 'shape:n', typeName: 'shape', type: 'note', x: 0, y: 0, rot: 0, z: 1,
      props: { text: 'word '.repeat(40).trim(), size: 'm', color: 'yellow', font: 'draw' },
    })
    expect(layout.lines.length).toBeGreaterThan(2)
  })
})

describe('embedded images', () => {
  it('renders the actual image, scaled into its shape box', async () => {
    const png = await renderPng(snapshotWithImage(await testImageURL()), {
      width: 60, height: 60, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 60, h: 60 }, padding: 0,
    })
    const pixels = await readPixels(png)
    // solid center color survives the upscale
    expect(px(pixels, 30, 30).slice(0, 3)).toEqual(hex('#00c864'))
  })

  it('fails loudly on missing, external and corrupt assets', async () => {
    const missing = new Store()
    missing.put({
      id: 'shape:i', typeName: 'shape', type: 'image', x: 0, y: 0, rot: 0, z: 1,
      props: { w: 40, h: 40, assetId: 'asset:ghost' },
    })
    await expect(renderPng(missing.getSnapshot(), { width: 100, height: 100 }))
      .rejects.toMatchObject({ name: 'RenderError', code: 'ASSET_MISSING' })

    const external = new Store()
    external.put({ id: 'asset:e', typeName: 'asset', src: 'https://example.com/x.png', w: 8, h: 8 })
    external.put({
      id: 'shape:i', typeName: 'shape', type: 'image', x: 0, y: 0, rot: 0, z: 1,
      props: { w: 40, h: 40, assetId: 'asset:e' },
    })
    await expect(renderPng(external.getSnapshot(), { width: 100, height: 100 }))
      .rejects.toMatchObject({ name: 'RenderError', code: 'ASSET_EXTERNAL_URL' })

    await expect(renderPng(
      snapshotWithImage('data:image/png;base64,!!!not-an-image!!!'),
      { width: 100, height: 100 },
    )).rejects.toMatchObject({ name: 'RenderError', code: 'ASSET_DECODE_FAILED' })
  })
})

describe('fills, themes, backgrounds', () => {
  it('renders patterned fills as more than a flat color', async () => {
    const mk = (fill) => {
      const s = new Store()
      s.put({
        id: 'shape:g', typeName: 'shape', type: 'geo', x: 0, y: 0, rot: 0, z: 1,
        props: { geo: 'rectangle', w: 120, h: 80, color: 'blue', size: 'm', dash: 'solid', fill },
      })
      return s.getSnapshot()
    }
    const viewport = { x: 0, y: 0, w: 120, h: 80 }
    const patterned = await readPixels(await renderPng(mk('pattern'), {
      width: 120, height: 80, fit: 'viewport', viewport, padding: 0,
    }))
    const solid = await readPixels(await renderPng(mk('solid'), {
      width: 120, height: 80, fit: 'viewport', viewport, padding: 0,
    }))
    // hatch = translucent strokes over transparency: interior mixes
    // painted hatch pixels with untouched transparent gaps
    let minA = 255, maxA = 0
    for (let y = 30; y < 50; y++) {
      for (let x = 40; x < 80; x++) {
        const a = px(patterned, x, y)[3]
        if (a < minA) minA = a
        if (a > maxA) maxA = a
      }
    }
    expect(minA).toBe(0)
    expect(maxA).toBeGreaterThan(100)
    expect(countOpaque(patterned)).toBeGreaterThan(100)
    // solid interior pixel is the flat fill; patterned interior is not
    expect(px(solid, 60, 40).slice(0, 3)).toEqual(hex('#dfe5fb'))
    expect(px(patterned, 60, 40)).not.toEqual(px(solid, 60, 40))
  })

  it('supports light/dark themes and theme backgrounds', async () => {
    const store = new Store()
    store.put({
      id: 'shape:g', typeName: 'shape', type: 'geo', x: 0, y: 0, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 60, h: 40, color: 'black', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const viewport = { x: -20, y: -20, w: 100, h: 80 }
    const light = await readPixels(await renderPng(store.getSnapshot(), {
      width: 100, height: 80, fit: 'viewport', viewport, padding: 0,
      theme: 'light', background: 'theme',
    }))
    const dark = await readPixels(await renderPng(store.getSnapshot(), {
      width: 100, height: 80, fit: 'viewport', viewport, padding: 0,
      theme: 'dark', background: 'theme',
    }))
    expect(px(light, 5, 5).slice(0, 3)).toEqual(hex(THEMES.light.background))
    expect(px(dark, 5, 5).slice(0, 3)).toEqual(hex(THEMES.dark.background))
    // same shape, different per-theme fill
    expect(px(light, 50, 40).slice(0, 3)).toEqual(hex('#e8e8e8'))
    expect(px(dark, 50, 40).slice(0, 3)).toEqual(hex('#2c2c2c'))
  })

  it('accepts explicit CSS background colors', async () => {
    const png = await renderPng(new Store().getSnapshot(), {
      width: 32, height: 32, background: '#ff0000', padding: 0,
    })
    expect(px(await readPixels(png), 4, 4)).toEqual([255, 0, 0, 255])
  })
})

describe('fonts', () => {
  it('registers the true hand face — measurement never falls back silently', async () => {
    // ensure the platform (and its fonts) is installed
    await renderPng(new Store().getSnapshot(), { width: 32, height: 32, padding: 0 })
    const { fontsReady, fontFiles } = await import('../src/fonts.js')
    expect(fontsReady()).toBe(true)
    // Exactly one TTF per family: skia-canvas cannot shape from woff2, and for a
    // multi-file family only the last file serves text (the other range
    // degrades to .notdef) — each TTF is a merged latin+latin-ext face.
    const files = fontFiles()
    expect(files).toHaveLength(3)
    expect(files.every((f) => f.endsWith('.ttf'))).toBe(true)
    const c = new Canvas(8, 8)
    const ctx = c.getContext('2d')
    const probe = 'Remember: demo on Friday'
    // the alias must resolve identically alone and inside the full stack:
    // multi-word aliases fail inside font lists in skia-canvas, which is how
    // the fallback slipped in undetected the first time
    ctx.font = '500 20px QuickdrawHand'
    const aliasOnly = ctx.measureText(probe).width
    ctx.font = `500 20px 'QuickdrawHand', 'Quickdraw Hand', 'Libre Baskerville', Georgia, serif`
    const stacked = ctx.measureText(probe).width
    expect(stacked).toBeCloseTo(aliasOnly, 5)
    // ...and the bundled Baskerville must actually be active, not a fallback
    ctx.font = '500 20px serif'
    expect(Math.abs(stacked - ctx.measureText(probe).width)).toBeGreaterThan(10)
    // ...and rasterizes differently from a Georgia fallback
    const render = (font) => {
      const c2 = new Canvas(400, 60)
      const x2 = c2.getContext('2d')
      x2.fillStyle = 'white'
      x2.fillRect(0, 0, 400, 60)
      x2.fillStyle = 'black'
      x2.font = font
      x2.fillText(probe, 10, 40)
      return x2.getImageData(0, 0, 400, 60).data.join(',')
    }
    expect(render(`500 20px 'QuickdrawHand'`)).not.toBe(render('500 20px Georgia'))
  })

  it('resolves the bundled Roboto families identically alone and in-stack', async () => {
    await renderPng(new Store().getSnapshot(), { width: 32, height: 32, padding: 0 })
    const { FONTS } = await import('@quickdrawjs/core')
    const c = new Canvas(8, 8)
    const ctx = c.getContext('2d')
    const probe = 'Pack my box 0123456789'
    // stack measurement must equal the alias measurement: multi-word aliases
    // fail inside font lists, so both families register single-word names
    for (const [id, alias] of [['sans', 'Roboto'], ['mono', 'RobotoMono']]) {
      ctx.font = `500 20px ${alias}`
      const aliasOnly = ctx.measureText(probe).width
      expect(aliasOnly).toBeGreaterThan(0)
      ctx.font = `500 20px ${FONTS[id]}`
      expect(ctx.measureText(probe).width).toBeCloseTo(aliasOnly, 5)
    }
    // mono advances are uniform: every glyph advances (nearly) the same width
    ctx.font = '500 20px RobotoMono'
    const narrow = ctx.measureText('i').width
    const wide = ctx.measureText('W').width
    expect(Math.abs(narrow - wide)).toBeLessThanOrEqual(narrow * 0.02 + 0.5)
  })
})

describe('determinism and concurrency', () => {
  it('renders the same snapshot to identical bytes, repeatedly', async () => {
    const snap = kitchenSink().getSnapshot()
    const a = await renderPng(snap, { width: 640, height: 400 })
    const b = await renderPng(snap, { width: 640, height: 400 })
    expect(a.equals(b)).toBe(true)
  })

  it('renders different snapshots concurrently without mixing them', async () => {
    const red = new Store()
    red.put({
      id: 'shape:g', typeName: 'shape', type: 'geo', x: 0, y: 0, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 50, h: 50, color: 'red', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const blue = new Store()
    blue.put({
      id: 'shape:g', typeName: 'shape', type: 'geo', x: 0, y: 0, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 50, h: 50, color: 'blue', size: 'm', dash: 'solid', fill: 'solid' },
    })
    const viewport = { x: 0, y: 0, w: 50, h: 50 }
    const opts = { width: 50, height: 50, fit: 'viewport', viewport, padding: 0 }
    const [pr, pb] = await Promise.all([
      renderPng(red.getSnapshot(), opts).then(readPixels),
      renderPng(blue.getSnapshot(), opts).then(readPixels),
    ])
    expect(px(pr, 25, 25).slice(0, 3)).toEqual(hex('#f9dcdc'))
    expect(px(pb, 25, 25).slice(0, 3)).toEqual(hex('#dfe5fb'))
  })
})

describe('invalid input', () => {
  const snap = () => new Store().getSnapshot()

  it('throws RenderError with stable codes', async () => {
    const cases = [
      [null, {}, 'INVALID_SNAPSHOT'],
      [{}, {}, 'INVALID_SNAPSHOT'],
      [{ document: {} }, {}, 'INVALID_SNAPSHOT'],
      [snap(), { width: 0, height: 100 }, 'INVALID_DIMENSIONS'],
      [snap(), { width: 9000, height: 100 }, 'INVALID_DIMENSIONS'],
      [snap(), { width: 8000, height: 8000 }, 'INVALID_DIMENSIONS'],
      [snap(), { theme: 'sepia' }, 'INVALID_THEME'],
      [snap(), { background: 'not-a-color!!!' }, 'INVALID_BACKGROUND'],
      [snap(), { fit: 'cover' }, 'INVALID_FIT'],
      [snap(), { padding: -1 }, 'INVALID_PADDING'],
      [snap(), { width: 100, height: 100, padding: 60 }, 'INVALID_PADDING'],
      [snap(), { fit: 'viewport' }, 'INVALID_VIEWPORT'],
      [snap(), { fit: 'viewport', viewport: { x: 0, y: 0, w: 0, h: 10 } }, 'INVALID_VIEWPORT'],
      [snap(), { viewport: { x: 0, y: 0, w: 10, h: 10 } }, 'INVALID_VIEWPORT'],
    ]
    for (const [s, o, code] of cases) {
      await expect(renderPng(s, o), JSON.stringify(o)).rejects.toMatchObject({
        name: 'RenderError', code,
      })
    }
    // every RenderError is an Error with a helpful message
    const err = await renderPng(null).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RenderError)
    expect(typeof err.message).toBe('string')
  })

  it('rejects unbounded snapshots', async () => {
    const big = { document: { store: {} } }
    for (let i = 0; i < 10; i++) big.document.store[`shape:${i}`] = { id: `shape:${i}` }
    const { LIMITS } = await import('../src/render.js')
    expect(LIMITS.maxRecords).toBeLessThanOrEqual(1_000_000)
    await expect(renderPng({ document: { store: null } })).rejects.toMatchObject({
      code: 'INVALID_SNAPSHOT',
    })
  })
})

describe('dependency hygiene', () => {
  it('uses no Chromium, Puppeteer, Playwright or browser automation', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const deps = JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const banned of ['puppeteer', 'playwright', 'chromium', 'jsdom', 'happy-dom']) {
      expect(deps.toLowerCase()).not.toContain(banned)
    }
    const src = ['index.js', 'render.js', 'platform.js', 'assets.js', 'fonts.js', 'errors.js']
      .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
      .join('\n')
    // no browser-automation imports and no browser-global *use*:
    // document.createElement / new Image / new OffscreenCanvas / window.xxx
    for (const banned of [
      'puppeteer', 'playwright', 'chromium',
      'document.createElement', 'new Image(', 'new OffscreenCanvas(',
      'globalThis.window', 'globalThis.document',
    ]) {
      expect(src).not.toContain(banned)
    }
    // no browser-automation imports and no browser-global *use* in code
    // (error-message prose mentioning `document.store` is stripped first)
    const code = src.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/gs, '')
    expect(code).not.toMatch(/(^|[^.'"\w])(window|document)\.[a-zA-Z]/m)
  })
})
