// Headless rendering backend: installs Skia equivalents into the core
// engine's explicit injection point (setShapePlatform) and registers the
// bundled Quickdraw fonts. Browser code never imports this module, so the
// browser path is untouched; nothing here patches window/document/Path2D.

import { Canvas, Path2D, FontLibrary } from 'skia-canvas'
import { setShapePlatform } from '@quickdrawjs/core'

import { registerFonts } from './fonts.js'

let installed = false

// A small shared canvas whose context serves text measurement. Use is
// strictly synchronous (set font, measure immediately), so sharing it across
// concurrent renders is safe: synchronous JS cannot interleave mid-measure.
let measureCanvas = null

export function installPlatform() {
  if (installed) return
  registerFonts()
  measureCanvas = new Canvas(16, 16)
  setShapePlatform({
    Path2D,
    measureCtx: measureCanvas.getContext('2d'),
    tileCanvas: (w, h) => new Canvas(w, h),
  })
  installed = true
}

// Visible for tests: which backend pieces are active.
export function platformInfo() {
  return {
    installed,
    hasFontLibrary: typeof FontLibrary?.use === 'function',
    families: (() => {
      try {
        return FontLibrary.families?.() ?? null
      } catch {
        return null
      }
    })(),
  }
}
