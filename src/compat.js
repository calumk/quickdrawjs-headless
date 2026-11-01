// Compat mode for UNPATCHED @quickdrawjs/core releases.
//
// The default ('strict') path needs the small server-renderer seam in core
// (setShapePlatform, sortShapesForRender, layout/geometry exports) and throws
// CORE_TOO_OLD without it. With `compat: 'monkeypatch'`, this module bridges
// a stock core release instead — explicitly opt-in, never silent:
//
// - Missing browser globals (Path2D, OffscreenCanvas, Image, document) are
//   defined from Skia equivalents, only when absent (never clobbered).
// - Helpers absent from core's public exports (boundsUnion, boundsExpand)
//   are deep-imported from its files by path.
// - The paint order core's Editor uses is vendored (highlighter-beneath,
//   rest by z — matching released core; custom layering needs patched core).
// - The bundled hand face is pointed at via the mutable FONTS object.
//
// What stays unsupported without the seam: custom font stacks (no
// fontStackOf), per-render image/pattern isolation (unpatched core keeps one
// global image cache and one pattern cache — fine for repeated renders, but
// shared process-wide), and the image-bottom layering.

import { Canvas, Path2D, Image, loadImage } from 'skia-canvas'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { RenderError } from './errors.js'
import { getUsableAsset } from './assets.js'

// The seam, feature-detected (never version-sniffed): a core with it renders
// the strict path, one without needs compat mode.
export const hasSeam = (coreNs) =>
  typeof coreNs?.setShapePlatform === 'function' &&
  typeof coreNs?.sortShapesForRender === 'function' &&
  typeof coreNs?.textLayout === 'function'

// Resolve and validate the compat option. Throws INVALID_COMPAT, or
// CORE_TOO_OLD when the seam is absent and monkeypatch was not requested.
export function resolveMode(coreNs, compat) {
  const mode = compat ?? 'strict'
  if (mode !== 'strict' && mode !== 'monkeypatch') {
    throw new RenderError(
      'INVALID_COMPAT',
      `compat must be 'strict' or 'monkeypatch' (got ${compat}).`,
    )
  }
  if (mode === 'strict' && !hasSeam(coreNs)) {
    throw new RenderError(
      'CORE_TOO_OLD',
      'Installed @quickdrawjs/core lacks the server-renderer exports ' +
        '(setShapePlatform, sortShapesForRender, textLayout). Either upgrade ' +
        `to a core release that includes them, or pass compat: 'monkeypatch' ` +
        'to render against a stock core with shims (see README).',
    )
  }
  return mode
}

const installedGlobals = []

// Define the browser globals unpatched core reads, from Skia equivalents —
// only when absent, so real browser globals (or a test harness) are never
// clobbered. Returns the keys this call defined.
export function installGlobals() {
  const added = []
  const put = (key, value) => {
    if (globalThis[key] === undefined) {
      globalThis[key] = value
      installedGlobals.push(key)
      added.push(key)
    }
  }
  put('Path2D', Path2D)
  put('OffscreenCanvas', class OffscreenCanvas extends Canvas {})
  put('Image', Image)
  put('document', {
    createElement: (tag) => {
      if (String(tag).toLowerCase() !== 'canvas') {
        throw new RenderError('CORE_TOO_OLD', 'compat shims only implement canvas element creation.')
      }
      return new Canvas()
    },
  })
  return added
}

// Remove globals installGlobals() defined. Renderers reinstall per call, so
// tests can isolate themselves; normal use never needs this.
export function uninstallGlobals() {
  for (const key of installedGlobals.splice(0)) {
    try {
      delete globalThis[key]
    } catch {
      globalThis[key] = undefined
    }
  }
}

// Import a core-internal module by file path, bypassing the exports map
// (which only exposes the public face on unpatched releases).
export async function coreModuleFile(subpath) {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('@quickdrawjs/core/package.json'))
  try {
    return await import(pathToFileURL(join(root, subpath)).href)
  } catch (e) {
    throw new RenderError(
      'CORE_TOO_OLD',
      `Installed @quickdrawjs/core has an unfamiliar layout (missing ${subpath}). ` +
        `Upgrade core or pass compat: 'monkeypatch' against a stock release.`,
    )
  }
}

// A helper by public export first, deep file import second.
export async function resolveHelper(coreNs, name, file) {
  if (typeof coreNs?.[name] === 'function') return coreNs[name]
  const mod = await coreModuleFile(file)
  if (typeof mod[name] !== 'function') {
    throw new RenderError(
      'CORE_TOO_OLD',
      `Installed @quickdrawjs/core exposes no ${name} (publicly or under ${file}).`,
    )
  }
  return mod[name]
}

// The paint order released core versions implement in Editor.shapesSorted():
// highlighters beneath, everything else by z. Used only in monkeypatch mode
// (patched cores export their own ordering, which may layer further).
export const legacySort = (shapes) => [...shapes].sort(
  (a, b) =>
    ((a.type === 'highlight' ? 0 : 1) - (b.type === 'highlight' ? 0 : 1)) ||
    a.z - b.z ||
    (a.id < b.id ? -1 : 1),
)

// Point the default draw stack at the registered single-word alias. The
// FONTS object itself is mutable (only the module binding is frozen), so this
// works on unpatched cores where setFontStacks does not exist. Returns a
// restore function for tests; renderers leave it installed.
export function patchFontStacks(coreNs) {
  const stacks = coreNs?.FONTS
  if (!stacks || typeof stacks.draw !== 'string') {
    throw new RenderError('CORE_TOO_OLD', 'Installed @quickdrawjs/core exposes no FONTS.draw stack to point at the hand face.')
  }
  const prev = stacks.draw
  stacks.draw = "'QuickdrawHand', 'Quickdraw Hand', 'Libre Baskerville', 'Baskerville', Georgia, serif"
  return () => {
    stacks.draw = prev
  }
}

// Warm unpatched core's global image cache through its own assetImage(), so
// the synchronous draw pass finds real bitmaps instead of placeholders.
// Decodability is pre-validated with loadImage (core wires onload only, so a
// corrupt asset would otherwise hang the wait). Validation errors surface
// with the same ASSET_* codes as the strict path.
export async function warmImageCache(store, assetIds, coreNs) {
  const assetImage = await resolveHelper(coreNs, 'assetImage', 'src/shapes.js')
  await Promise.all(
    assetIds.map(async (id) => {
      const asset = getUsableAsset(store, id)
      try {
        await loadImage(asset.src)
      } catch {
        throw new RenderError('ASSET_DECODE_FAILED', `Image asset '${id}' could not be decoded.`)
      }
      await new Promise((resolve) => {
        const img = assetImage(store, id, resolve)
        if (img) resolve()
      })
    }),
  )
}
