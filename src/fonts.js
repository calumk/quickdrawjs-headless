// Bundled-font registration for server-side text. Quickdraw's hand font is
// Libre Baskerville (OFL 1.1, shipped inside @quickdrawjs/core), and the
// canvas font stacks reference it first — so register it with Skia before
// any text is measured or drawn. Deterministic: the same files load on every
// server instead of whatever the OS happens to have.

import { FontLibrary } from 'skia-canvas'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const FAMILY = 'Quickdraw Hand'

let registered = false

export function fontFiles() {
  const require = createRequire(import.meta.url)
  const coreRoot = dirname(require.resolve('@quickdrawjs/core/package.json'))
  const dir = join(coreRoot, 'src/fonts')
  // Prefer TTF: skia-canvas parses woff2 metadata but cannot shape from it
  // (silently falls back to a wrong face), while TTF renders the true face.
  // The browser keeps using woff2 via quickdraw.css — same licensed files.
  const ttf = [
    join(dir, 'libre-baskerville-latin-500.ttf'),
    join(dir, 'libre-baskerville-latin-ext-500.ttf'),
  ]
  if (ttf.every((f) => existsSync(f))) return ttf
  return [
    join(dir, 'libre-baskerville-latin-500.woff2'),
    join(dir, 'libre-baskerville-latin-ext-500.woff2'),
  ]
}

export function registerFonts() {
  if (registered) return true
  const files = fontFiles().filter((f) => existsSync(f))
  if (files.length === 0) return false
  FontLibrary.use(FAMILY, files)
  registered = true
  return true
}

// True once the hand font is usable for measurement and drawing.
export function fontsReady() {
  return registered
}
