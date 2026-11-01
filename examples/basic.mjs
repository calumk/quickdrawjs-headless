// Example: render a realistic Quickdraw board to PNG, no browser involved.
//
//   npm install            # from the monorepo root (installs workspaces)
//   npm run example --workspace=@quickdrawjs/headless
//
// Reads ./board.json (a real store.getSnapshot() document), renders it with
// renderPng() and writes ./board.png next to it.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderPng } from '../src/index.js'

const dir = dirname(fileURLToPath(import.meta.url))

const snapshot = JSON.parse(await readFile(join(dir, 'board.json'), 'utf8'))

const options = {
  width: 1920,
  height: 1080,
  theme: 'light',
  background: 'transparent',
  fit: 'content',
  padding: 40,
}

let png
try {
  png = await renderPng(snapshot, options)
} catch (e) {
  // installed core predates the server-renderer exports: render through the
  // opt-in compat shims instead (same shapes, released-core paint order)
  if (e?.code !== 'CORE_TOO_OLD') throw e
  console.warn('core lacks server-renderer exports; retrying with compat: \'monkeypatch\'')
  png = await renderPng(snapshot, { ...options, compat: 'monkeypatch' })
}

await writeFile(join(dir, 'board.png'), png)
console.log(`wrote board.png (${png.length} bytes)`)
