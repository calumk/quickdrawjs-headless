// Headless rendering backend: installs Skia equivalents into the core
// engine's explicit injection point (setShapePlatform) and registers the
// bundled Quickdraw fonts. Browser code never imports this module, so the
// browser path is untouched. In compat (monkeypatch) mode there is no
// injection point, so only the fonts register and the browser globals
// installed by compat.js carry the backend.

import { Canvas, Path2D, FontLibrary } from 'skia-canvas'

import { registerFonts } from './fonts.js'

let installed = false

// A small shared canvas whose context serves text measurement. Use is
// strictly synchronous (set font, measure immediately), so sharing it across
// concurrent renders is safe: synchronous JS cannot interleave mid-measure.
let measureCanvas = null

// setShapePlatform: core's setter on patched cores, null in compat mode.
export function installPlatform({ setShapePlatform } = {}) {
  if (installed) {
    // A later call may still supply the setter the first one lacked.
    if (typeof setShapePlatform === 'function' && !installPlatform.injected) {
      inject(setShapePlatform)
    }
    return
  }
  registerFonts()
  measureCanvas = new Canvas(16, 16)
  if (typeof setShapePlatform === 'function') inject(setShapePlatform)
  installed = true
}

function inject(setShapePlatform) {
  setShapePlatform({
    Path2D,
    measureCtx: measureCanvas.getContext('2d'),
    tileCanvas: (w, h) => new Canvas(w, h),
  })
  installPlatform.injected = true
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
