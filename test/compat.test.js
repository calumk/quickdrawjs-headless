// Compat-mode tests: rendering against UNPATCHED core releases via shims.
// Plain Node environment. Tests that force `compat: 'monkeypatch'` are
// meaningful everywhere; the strict-mode refusal test only applies where the
// installed core lacks the seam (it returns early on seamed cores, where the
// rest of the suite already covers strict rendering).

import { describe, it, expect, afterEach } from 'vitest'
import { Canvas } from 'skia-canvas'
import * as coreNs from '@quickdrawjs/core'

import { renderPng, RenderError } from '../src/index.js'
import {
  hasSeam, resolveMode, installGlobals, uninstallGlobals,
  legacySort, patchFontStacks, warmImageCache,
} from '../src/compat.js'
import {
  pngMeta, readPixels, px, countOpaque, kitchenSink, testImageURL,
} from './helpers.mjs'

const ORIGINAL_DRAW = coreNs.FONTS.draw

afterEach(() => {
  uninstallGlobals()
  coreNs.FONTS.draw = ORIGINAL_DRAW
})

describe('mode resolution', () => {
  const seamed = { setShapePlatform() {}, sortShapesForRender() {}, textLayout() {} }

  it('detects the seam by capability, never by version', () => {
    expect(hasSeam({})).toBe(false)
    expect(hasSeam({ setShapePlatform() {} })).toBe(false)
    expect(hasSeam(seamed)).toBe(true)
  })

  it('defaults to strict and validates the compat option', () => {
    expect(resolveMode(seamed)).toBe('strict')
    expect(resolveMode(seamed, 'strict')).toBe('strict')
    expect(resolveMode({}, 'monkeypatch')).toBe('monkeypatch')
    expect(() => resolveMode(seamed, 'cover')).toThrowError(
      expect.objectContaining({ code: 'INVALID_COMPAT' }),
    )
  })

  it('strict mode refuses unpatched core with a clear error', async () => {
    if (hasSeam(coreNs)) return // strict rendering is covered elsewhere here
    await expect(
      renderPng(new coreNs.Store().getSnapshot(), { width: 32, height: 32, padding: 0 }),
    ).rejects.toMatchObject({ name: 'RenderError', code: 'CORE_TOO_OLD' })
  })
})

describe('global shims', () => {
  it('installs only absent globals and removes what it added', () => {
    for (const g of ['window', 'document', 'OffscreenCanvas', 'Image', 'Path2D']) {
      delete globalThis[g]
    }
    globalThis.window = { real: true } // must never be clobbered
    try {
      const added = installGlobals()
      expect(added.sort()).toEqual(['Image', 'OffscreenCanvas', 'Path2D', 'document'])
      expect(globalThis.window).toEqual({ real: true })
      expect(typeof globalThis.OffscreenCanvas).toBe('function')
      // second install is a no-op for already-present keys
      expect(installGlobals()).toEqual([])
      uninstallGlobals()
      for (const g of ['document', 'OffscreenCanvas', 'Image', 'Path2D']) {
        expect(globalThis[g]).toBe(undefined)
      }
      expect(globalThis.window).toEqual({ real: true })
    } finally {
      delete globalThis.window
      uninstallGlobals()
    }
  })

  it('points the draw stack at the registered alias, restorably', () => {
    const restore = patchFontStacks(coreNs)
    expect(coreNs.FONTS.draw.startsWith("'QuickdrawHand'")).toBe(true)
    restore()
    expect(coreNs.FONTS.draw).toBe(ORIGINAL_DRAW)
  })

  it('orders highlight-beneath like released core', () => {
    const s = (id, type, z) => ({ id, type, z })
    expect(legacySort([
      s('geo-hi', 'geo', 99), s('hl-lo', 'highlight', 1), s('img', 'image', 50),
    ]).map((x) => x.id)).toEqual(['hl-lo', 'img', 'geo-hi'])
  })
})

describe('shimmed image warming', () => {
  const warmingStore = async (src) => {
    const store = new coreNs.Store()
    store.put({ id: 'asset:w', typeName: 'asset', src, w: 8, h: 8 })
    return store
  }

  it('warms valid assets into core’s image cache', async () => {
    installGlobals()
    await warmImageCache(await warmingStore(await testImageURL()), ['asset:w'], coreNs)
  })

  it('reports missing, external and corrupt assets with ASSET_* codes', async () => {
    installGlobals()
    await expect(warmImageCache(new coreNs.Store(), ['asset:ghost'], coreNs))
      .rejects.toMatchObject({ code: 'ASSET_MISSING' })
    await expect(warmImageCache(await warmingStore('https://example.com/x.png'), ['asset:w'], coreNs))
      .rejects.toMatchObject({ code: 'ASSET_EXTERNAL_URL' })
    await expect(warmImageCache(await warmingStore('data:image/png;base64,!!!nope!!!'), ['asset:w'], coreNs))
      .rejects.toMatchObject({ code: 'ASSET_DECODE_FAILED' })
  })
})

describe('monkeypatch renders', () => {
  const mp = { compat: 'monkeypatch' }

  it('renders blank and shaped documents without browser globals', async () => {
    for (const g of ['window', 'document', 'OffscreenCanvas', 'Image', 'Path2D']) {
      delete globalThis[g]
    }
    const blank = await renderPng(new coreNs.Store().getSnapshot(), { width: 120, height: 60, padding: 0, ...mp })
    expect(pngMeta(blank)).toMatchObject({ width: 120, height: 60 })
    expect(countOpaque(await readPixels(blank))).toBe(0)

    const store = new coreNs.Store()
    store.put({
      id: 'shape:g', typeName: 'shape', type: 'geo', x: 10, y: 10, rot: 0, z: 1,
      props: { geo: 'rectangle', w: 80, h: 40, color: 'blue', size: 'm', dash: 'solid', fill: 'solid' },
    })
    store.put({
      id: 'shape:t', typeName: 'shape', type: 'text', x: 10, y: 70, rot: 0, z: 2,
      props: { text: 'shimmed type', size: 'm', color: 'black', font: 'draw' },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 200, height: 140, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 200, h: 140 }, padding: 0, ...mp,
    })
    const pixels = await readPixels(png)
    expect(px(pixels, 50, 30).slice(0, 3)).toEqual([223, 229, 251])
    expect(countOpaque(pixels)).toBeGreaterThan(500)
  })

  it('renders embedded images after warming (no placeholders)', async () => {
    const store = new coreNs.Store()
    store.put({ id: 'asset:img1', typeName: 'asset', src: await testImageURL(), w: 8, h: 8 })
    store.put({
      id: 'shape:image1', typeName: 'shape', type: 'image', x: 10, y: 10, rot: 0, z: 5,
      props: { w: 40, h: 40, assetId: 'asset:img1' },
    })
    const png = await renderPng(store.getSnapshot(), {
      width: 60, height: 60, fit: 'viewport',
      viewport: { x: 0, y: 0, w: 60, h: 60 }, padding: 0, ...mp,
    })
    // solid center color survives: the image decoded before drawing
    expect(px(await readPixels(png), 30, 30).slice(0, 3)).toEqual([0, 200, 100])
  })

  it('is deterministic across repeated monkeypatch renders', async () => {
    const snap = kitchenSink().getSnapshot()
    const opts = { width: 320, height: 200, ...mp }
    expect((await renderPng(snap, opts)).equals(await renderPng(snap, opts))).toBe(true)
  })

  it('matches strict rendering on seamed cores (imageless documents)', async () => {
    if (!hasSeam(coreNs)) return // nothing stricter to compare against here
    const snap = kitchenSink().getSnapshot()
    const strict = await renderPng(snap, { width: 320, height: 200 })
    const shimmed = await renderPng(snap, { width: 320, height: 200, ...mp })
    expect(shimmed.equals(strict)).toBe(true)
  })
})
