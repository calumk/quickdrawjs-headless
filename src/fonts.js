// Bundled-font registration for server-side text. The engine's `draw` stack
// starts with the Quickdraw Hand face (Libre Baskerville, OFL 1.1), `sans`
// with Roboto and `mono` with Roboto Mono (both Apache 2.0) — all shipped
// inside @quickdrawjs/core and registered here with Skia before any text is
// measured or drawn. Deterministic: the same files load on every server
// instead of whatever the OS happens to have.
//
// Three skia-canvas quirks dictate the packaging (see README):
// woff2 files parse but never shape, multi-word family names never match
// inside font lists, and for a multi-file family only the last file serves
// text. So each family registers as ONE merged TTF under a SINGLE-WORD alias
// that heads its stack: 'QuickdrawHand', 'Roboto', 'RobotoMono'.

import { FontLibrary } from 'skia-canvas'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const FAMILIES = [
  { name: 'QuickdrawHand', files: ['libre-baskerville-500.ttf'] },
  { name: 'Roboto', files: ['roboto-500.ttf'] },
  { name: 'RobotoMono', files: ['roboto-mono-500.ttf'] },
]

const registered = new Set()

export function fontFiles() {
  const require = createRequire(import.meta.url)
  const coreRoot = dirname(require.resolve('@quickdrawjs/core/package.json'))
  const dir = join(coreRoot, 'src/fonts')
  return FAMILIES.flatMap((f) => f.files.map((file) => join(dir, file))).filter((f) =>
    existsSync(f),
  )
}

export function registerFonts() {
  const require = createRequire(import.meta.url)
  const coreRoot = dirname(require.resolve('@quickdrawjs/core/package.json'))
  const dir = join(coreRoot, 'src/fonts')
  for (const f of FAMILIES) {
    if (registered.has(f.name)) continue
    const files = f.files.map((file) => join(dir, file)).filter((p) => existsSync(p))
    if (files.length === 0) continue
    FontLibrary.use(f.name, files)
    registered.add(f.name)
  }
  return fontsReady()
}

// True once every bundled family is usable for measurement and drawing.
export function fontsReady() {
  return FAMILIES.every((f) => registered.has(f.name))
}

// Family names the server registers (what the stacks' first entries match).
export function fontFamilies() {
  return FAMILIES.map((f) => f.name)
}
