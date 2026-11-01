// Bundled-font registration for server-side text. Quickdraw's hand font is
// Libre Baskerville (OFL 1.1, shipped inside @quickdrawjs/core), and the
// canvas font stacks reference it first — so register it with Skia before
// any text is measured or drawn. Deterministic: the same files load on every
// server instead of whatever the OS happens to have.

import { FontLibrary } from 'skia-canvas'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

// 'QuickdrawHand' (single word, no space): skia-canvas matches multi-word
// family names only as a sole family, never inside a font list — and the
// engine always measures/draws with the full stack — so the spaced alias
// silently falls through to a wrong face. Same files either way; browsers
// match both names via quickdraw.css.
const FAMILY = 'QuickdrawHand'

let registered = false

export function fontFiles() {
  const require = createRequire(import.meta.url)
  const coreRoot = dirname(require.resolve('@quickdrawjs/core/package.json'))
  const dir = join(coreRoot, 'src/fonts')
  // One merged TTF covering latin + latin-ext. Two reasons for exactly one
  // file: skia-canvas cannot shape from woff2 (silently renders a fallback
  // face), and for a multi-file family only the LAST registered file serves
  // text — so split files leave one range as .notdef. The browser keeps using
  // the split woff2 files via quickdraw.css — same licensed outlines.
  const merged = join(dir, 'libre-baskerville-500.ttf')
  if (existsSync(merged)) return [merged]
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
