// renderPng(): the headless render pass. Loads a Store from the snapshot,
// preloads image assets, establishes the viewport transform on a Skia canvas
// and calls the core shape renderer — the same drawShape() the browser uses,
// so output tracks the editor instead of reimplementing it.
//
// The full Editor is never instantiated here: it owns DOM canvases, event
// listeners and animation frames. Only the document (Store), the renderer
// (drawShape) and the theme/geometry helpers cross into Node.

import { Canvas, Path2D } from 'skia-canvas'
import {
  Store,
  themeOf,
  pageBounds,
  boundsUnion,
  boundsExpand,
  drawShape,
  sortShapesForRender,
} from '@quickdrawjs/core'

import { installPlatform } from './platform.js'
import { referencedAssets, loadAssets } from './assets.js'
import { RenderError } from './errors.js'

export { RenderError }

export const DEFAULTS = {
  width: 1920,
  height: 1080,
  theme: 'light',
  background: 'transparent',
  fit: 'content',
  padding: 40,
}

// Guards against unbounded work from untrusted snapshots or options.
export const LIMITS = {
  maxDimension: 8192,
  maxPixels: 48_000_000,
  maxRecords: 100_000,
  // Page-space slack around content-fit bounds so strokes, arrowheads and
  // shadows are not clipped at the export edges (mirrors editor export).
  visualMargin: 48,
  // Content-fit never zooms past this: single-point drawings stay sensible.
  maxFitScale: 8,
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

function checkOptions(options = {}) {
  const o = { ...DEFAULTS, ...options }
  if (!Number.isInteger(o.width) || o.width < 1 || o.width > LIMITS.maxDimension) {
    throw new RenderError(
      'INVALID_DIMENSIONS',
      `width must be an integer 1..${LIMITS.maxDimension} (got ${o.width}).`,
    )
  }
  if (!Number.isInteger(o.height) || o.height < 1 || o.height > LIMITS.maxDimension) {
    throw new RenderError(
      'INVALID_DIMENSIONS',
      `height must be an integer 1..${LIMITS.maxDimension} (got ${o.height}).`,
    )
  }
  if (o.width * o.height > LIMITS.maxPixels) {
    throw new RenderError(
      'INVALID_DIMENSIONS',
      `Output is ${o.width}x${o.height} (${o.width * o.height} pixels, limit ${LIMITS.maxPixels}).`,
    )
  }
  if (o.theme !== 'light' && o.theme !== 'dark') {
    throw new RenderError('INVALID_THEME', `theme must be 'light' or 'dark' (got ${o.theme}).`)
  }
  if (typeof o.background !== 'string' || o.background.length === 0) {
    throw new RenderError(
      'INVALID_BACKGROUND',
      `background must be 'transparent', 'theme' or a CSS color string.`,
    )
  }
  if (o.fit !== 'content' && o.fit !== 'viewport') {
    throw new RenderError('INVALID_FIT', `fit must be 'content' or 'viewport' (got ${o.fit}).`)
  }
  if (!isFiniteNumber(o.padding) || o.padding < 0) {
    throw new RenderError('INVALID_PADDING', `padding must be a number >= 0 (got ${o.padding}).`)
  }
  if (o.padding * 2 >= Math.min(o.width, o.height)) {
    throw new RenderError(
      'INVALID_PADDING',
      `padding ${o.padding} leaves no room in a ${o.width}x${o.height} image.`,
    )
  }
  let viewport = null
  if (o.fit === 'viewport') {
    viewport = checkViewport(o.viewport)
  } else if (o.viewport !== undefined && o.viewport !== null) {
    // Explicit rect + content fit is contradictory — fail loudly, not silently.
    throw new RenderError(
      'INVALID_VIEWPORT',
      `viewport is only used with fit: 'viewport'. Omit it or set fit: 'viewport'.`,
    )
  }
  return { ...o, viewport }
}

function checkViewport(v) {
  if (!v || typeof v !== 'object') {
    throw new RenderError(
      'INVALID_VIEWPORT',
      `fit: 'viewport' needs viewport: { x, y, w, h } in page units.`,
    )
  }
  for (const k of ['x', 'y', 'w', 'h']) {
    if (!isFiniteNumber(v[k])) {
      throw new RenderError('INVALID_VIEWPORT', `viewport.${k} must be a finite number.`)
    }
  }
  if (v.w <= 0 || v.h <= 0) {
    throw new RenderError('INVALID_VIEWPORT', `viewport w/h must be positive (got ${v.w}x${v.h}).`)
  }
  if (Math.abs(v.x) > 1e7 || Math.abs(v.y) > 1e7 || v.w > 1e7 || v.h > 1e7) {
    throw new RenderError('INVALID_VIEWPORT', `viewport is out of range.`)
  }
  return { x: v.x, y: v.y, w: v.w, h: v.h }
}

function checkSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new RenderError(
      'INVALID_SNAPSHOT',
      'snapshot must be the object returned by store.getSnapshot(): { document: { store: { id: record } } }.',
    )
  }
  const records = snapshot.document?.store
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new RenderError(
      'INVALID_SNAPSHOT',
      'snapshot.document.store is missing: not a Quickdraw snapshot envelope.',
    )
  }
  const n = Object.keys(records).length
  if (n > LIMITS.maxRecords) {
    throw new RenderError(
      'SNAPSHOT_TOO_LARGE',
      `Snapshot holds ${n} records (limit ${LIMITS.maxRecords}).`,
    )
  }
  return records
}

// Validate a CSS color without trusting it: assign on the live context and
// confirm it took (invalid assignments are ignored per canvas spec).
function resolveBackground(ctx, background, theme) {
  if (background === 'transparent') return null
  if (background === 'theme') return theme.background
  for (const sentinel of ['#000001', '#fffffe']) {
    ctx.fillStyle = sentinel
    ctx.fillStyle = background
    if (ctx.fillStyle !== sentinel) return ctx.fillStyle
  }
  throw new RenderError(
    'INVALID_BACKGROUND',
    `background '${background}' is not 'transparent', 'theme' or a valid CSS color.`,
  )
}

// Page rect -> output transform: fit inside the padded area, centered.
function fitTransform(rect, width, height, padding, maxScale = Infinity) {
  const availW = width - padding * 2
  const availH = height - padding * 2
  const s = Math.min(maxScale, availW / rect.w, availH / rect.h)
  const ox = padding + (availW - rect.w * s) / 2 - rect.x * s
  const oy = padding + (availH - rect.h * s) / 2 - rect.y * s
  return { scale: s, ox, oy }
}

/**
 * Render a Quickdraw snapshot to a PNG buffer — Node.js only, no browser.
 *
 * @param {object} snapshot store.getSnapshot() output.
 * @param {object} [options]
 * @param {number} [options.width=1920] output pixels (1..8192).
 * @param {number} [options.height=1080] output pixels (1..8192).
 * @param {'light'|'dark'} [options.theme='light']
 * @param {string} [options.background='transparent'] 'transparent', 'theme' or a CSS color.
 * @param {'content'|'viewport'} [options.fit='content'] 'content' fits all shapes;
 *   'viewport' fits options.viewport exactly.
 * @param {{x,y,w,h}} [options.viewport] page-space rect, required with fit 'viewport'.
 * @param {number} [options.padding=40] output-pixel margin around the fitted rect.
 * @returns {Promise<Buffer>} PNG bytes. Always resolves after all assets are
 *   decoded and drawing is complete.
 *
 * Empty documents render as a blank image (background only) at the requested
 * size. Invalid input throws RenderError with a stable `code`.
 */
export async function renderPng(snapshot, options = {}) {
  installPlatform()
  const o = checkOptions(options)
  checkSnapshot(snapshot)

  const store = new Store()
  store.loadSnapshot(snapshot)
  const theme = themeOf(o.theme)
  const shapes = sortShapesForRender(store.shapes())

  // Decode every referenced image before a single shape is drawn.
  const images = await loadAssets(store, referencedAssets(shapes))

  const canvas = new Canvas(o.width, o.height)
  const ctx = canvas.getContext('2d')
  const bg = resolveBackground(ctx, o.background, theme)
  if (bg === null) ctx.clearRect(0, 0, o.width, o.height)
  else {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, o.width, o.height)
  }

  let rect = null
  if (o.fit === 'viewport') {
    rect = o.viewport
  } else if (shapes.length > 0) {
    let b = null
    for (const s of shapes) {
      try {
        b = boundsUnion(b, pageBounds(s))
      } catch {
        // A malformed shape record must not sink the whole export.
        continue
      }
    }
    // Guard against empty/zero-size unions (single-point drawings).
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.w >= 0 && b.h >= 0) {
      rect = boundsExpand(b, LIMITS.visualMargin)
      if (rect.w <= 0) rect.w = 1
      if (rect.h <= 0) rect.h = 1
    }
  }
  // rect === null: empty document — background only, still exact dimensions.

  if (rect) {
    const cap = o.fit === 'content' ? LIMITS.maxFitScale : Infinity
    const { scale, ox, oy } = fitTransform(rect, o.width, o.height, o.padding, cap)
    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    const patternCache = new Map() // per render: no cross-request state
    for (const s of shapes) {
      drawShape(ctx, s, { theme, store, zoom: scale, images, patternCache, Path2D })
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  const png = await canvas.toBuffer('png')
  return Buffer.isBuffer(png) ? png : Buffer.from(png)
}
