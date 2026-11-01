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
  return [
    join(coreRoot, 'src/fonts/libre-baskerville-latin-500.woff2'),
    join(coreRoot, 'src/fonts/libre-baskerville-latin-ext-500.woff2'),
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
